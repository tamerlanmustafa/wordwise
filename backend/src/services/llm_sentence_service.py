"""
LLM Example Sentence Service

Generates one example sentence per *lemma*. Sentences are stored globally
(SentenceBank.movieId = NULL, source='llm') and reused across every movie
that contains the lemma — so each word incurs the LLM cost at most once.

The earlier per-movie variant conditioned sentences on movie metadata
(title/genre/etc.) to give them thematic flavor. That cost N× more because
the same word generated a fresh sentence for every movie it appeared in.
We trade flavor for cost; the word itself still comes from the user's
movie, only the example sentence is generic.

Storage matches the existing SentenceBank + SentenceLemmaLink shape. Legacy
per-movie LLM rows (movieId NOT NULL) are left untouched and continue to
serve in their original movies via the read path's OR clause.

Every Anthropic call writes a row to llm_usage_ledger; before each call we
sum the ledger and refuse to fire when cumulative spend reaches
settings.llm_cost_cap_usd.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, List, Optional, Sequence, Tuple

from anthropic import AsyncAnthropic
from prisma import Prisma

from src.config import get_settings
from src.services.sentence_bank_service import hash_sentence

logger = logging.getLogger(__name__)

MIN_WORDS = 6
MAX_WORDS = 22
MAX_CHARS = 140

# Anthropic pricing (USD per million tokens) for the models we may call.
# Update when Anthropic adjusts pricing or when we point at a new model.
_PRICING: Dict[str, Dict[str, float]] = {
    "claude-sonnet-4-6": {
        "input": 3.00,
        "cache_read": 0.30,
        "cache_creation": 3.75,
        "output": 15.00,
    },
    "claude-opus-4-7": {
        "input": 15.00,
        "cache_read": 1.50,
        "cache_creation": 18.75,
        "output": 75.00,
    },
    "claude-haiku-4-5-20251001": {
        "input": 1.00,
        "cache_read": 0.10,
        "cache_creation": 1.25,
        "output": 5.00,
    },
}

SYSTEM_PROMPT = """You write short example sentences for a language-learning app.

Each sentence must:
- Use the target word naturally (an inflected form is fine, but it must be unambiguously the same lemma).
- Be appropriate for the requested CEFR level — vocabulary outside that level should be avoided.
- Be one sentence only, 6 to 22 words, ending with . ! or ?
- Sound like natural modern conversational or narrative English.
- Avoid proper nouns unless they're generic (common first names like "Sam" are fine; specific people, products, or places are not).
- Contain no markdown, no quotes around the whole sentence, no parentheticals, no URLs.

Return ONLY valid JSON in this exact shape, no prose:
{"sentences": [{"word": "<input word>", "sentence": "<the example>"}, ...]}

Include one object per input word, in the same order. If you cannot produce a sentence that satisfies every rule for a given word, return {"word": "<input word>", "sentence": null} for that entry."""


class CostCapExceeded(RuntimeError):
    """Raised when cumulative ledger spend has reached the configured cap."""


@dataclass(frozen=True)
class WordRequest:
    """One word to generate a sentence for."""
    word: str           # surface form the caller knows (e.g. "abandoned")
    lemma: str          # canonical form for matching (e.g. "abandon")
    cefr: Optional[str] # "A1".."C2" or None


class LLMSentenceService:
    """Thin wrapper around the Anthropic client for example-sentence generation."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        settings = get_settings()
        key = api_key or settings.anthropic_api_key
        if not key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set; LLM sentence generation disabled."
            )
        self._client = AsyncAnthropic(api_key=key)
        self._model = model or settings.anthropic_sentence_model
        self._cap_usd: float = settings.llm_cost_cap_usd

    # ─── Public API ─────────────────────────────────────────────────────────

    async def generate_sentences(
        self,
        db: Prisma,
        words: Sequence[WordRequest],
        context: str = "unknown",
    ) -> Dict[str, Optional[str]]:
        """
        Generate one sentence per input word. Returns a dict keyed by the
        word's lemma (lowercased). Missing/invalid entries map to None.

        Raises CostCapExceeded BEFORE making the API call if the cumulative
        spend already meets or exceeds the configured cap. Caller should
        treat this as "skip slow-path"; partial results are not returned.
        """
        if not words:
            return {}

        await self._check_cap(db)

        user_payload = self._build_user_payload(words)
        try:
            raw_text, usage = await self._call_model(user_payload)
        except Exception as e:
            logger.warning(f"[llm-sentence] model call failed: {e}")
            return {w.lemma.lower(): None for w in words}

        # Persist usage even when parsing fails — we still paid for it.
        await self._record_usage(db, usage, context=context)

        parsed = self._parse_response(raw_text)
        out: Dict[str, Optional[str]] = {}
        by_word = {w.word.lower(): w for w in words}
        for entry in parsed:
            requested = (entry.get("word") or "").lower()
            wreq = by_word.get(requested)
            if not wreq:
                continue
            sentence = entry.get("sentence")
            valid = self._validate(sentence, wreq) if isinstance(sentence, str) else None
            out[wreq.lemma.lower()] = valid
        for w in words:
            out.setdefault(w.lemma.lower(), None)
        return out

    async def generate_and_store(
        self,
        db: Prisma,
        words: Sequence[WordRequest],
        lemma_id_map: Dict[str, int],
        context: str = "unknown",
    ) -> Dict[str, dict]:
        """
        Generate sentences and persist them as GLOBAL SentenceBank rows
        (movieId=NULL, source='llm'), with a SentenceLemmaLink per lemma.
        Returns { word: { sentence, word_position, matched_form } }.

        `lemma_id_map` maps lemma_str -> Lemma.id. Lemmas missing from the
        map are skipped (we can't link them). Raises CostCapExceeded if the
        spend cap has been reached.
        """
        if not words:
            return {}

        sentences = await self.generate_sentences(db, words, context=context)
        results: Dict[str, dict] = {}

        for w in words:
            sentence = sentences.get(w.lemma.lower())
            lemma_id = lemma_id_map.get(w.lemma.lower())
            if not sentence or lemma_id is None:
                continue

            matched_form, word_position = self._locate_word(sentence, w)
            try:
                sentence_row = await self._get_or_create_global_sentence(
                    db, sentence
                )
                if sentence_row is None:
                    continue
                # Race-tolerant link insert. Unique (sentenceId, lemmaId)
                # — duplicates are a no-op.
                try:
                    await db.sentencelemmalink.create(
                        data={
                            "sentenceId": sentence_row.id,
                            "lemmaId": lemma_id,
                            "wordPosition": word_position,
                            "matchedForm": matched_form,
                            "score": 1.0,
                            "isRepresentative": True,
                        }
                    )
                except Exception:
                    pass
            except Exception as e:
                logger.warning(
                    f"[llm-sentence] persist failed word='{w.word}': {e}"
                )
                continue

            results[w.word] = {
                "sentence": sentence,
                "word_position": word_position,
                "matched_form": matched_form,
            }
        return results

    # ─── Cost cap & ledger ──────────────────────────────────────────────────

    async def _check_cap(self, db: Prisma) -> None:
        """Raise CostCapExceeded if cumulative ledger spend ≥ cap. Cap of 0 disables."""
        if not self._cap_usd or self._cap_usd <= 0:
            return
        rows = await db.query_raw(
            "SELECT COALESCE(SUM(estimated_cost_usd), 0)::float AS total FROM llm_usage_ledger"
        )
        total = float(rows[0]["total"]) if rows else 0.0
        if total >= self._cap_usd:
            raise CostCapExceeded(
                f"LLM cost cap reached: spent ${total:.4f} ≥ cap ${self._cap_usd:.2f}"
            )

    async def _record_usage(self, db: Prisma, usage: dict, context: str) -> None:
        """Insert a row into llm_usage_ledger from a parsed Anthropic usage block."""
        input_tokens = int(usage.get("input_tokens") or 0)
        cache_read = int(usage.get("cache_read_input_tokens") or 0)
        cache_creation = int(usage.get("cache_creation_input_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or 0)
        cost = self._estimate_cost(input_tokens, cache_read, cache_creation, output_tokens)
        try:
            await db.llmusageledger.create(
                data={
                    "model": self._model,
                    "inputTokens": input_tokens,
                    "cacheReadTokens": cache_read,
                    "cacheCreationTokens": cache_creation,
                    "outputTokens": output_tokens,
                    "estimatedCostUsd": Decimal(f"{cost:.6f}"),
                    "context": context[:64],
                }
            )
        except Exception as e:
            # Never let ledger failure mask the actual response; just log.
            logger.warning(f"[llm-sentence] ledger insert failed: {e}")

    def _estimate_cost(
        self,
        input_tokens: int,
        cache_read_tokens: int,
        cache_creation_tokens: int,
        output_tokens: int,
    ) -> float:
        """USD cost from token counts using the per-million pricing table."""
        rates = _PRICING.get(self._model)
        if rates is None:
            logger.warning(
                f"[llm-sentence] no pricing for model='{self._model}'; cost will be 0"
            )
            return 0.0
        return (
            input_tokens * rates["input"]
            + cache_read_tokens * rates["cache_read"]
            + cache_creation_tokens * rates["cache_creation"]
            + output_tokens * rates["output"]
        ) / 1_000_000.0

    # ─── Internals ──────────────────────────────────────────────────────────

    async def _get_or_create_global_sentence(self, db: Prisma, sentence: str):
        """Race-tolerant upsert of a global SentenceBank row (movieId=NULL, source='llm')."""
        sent_hash = hash_sentence(sentence)
        existing = await db.sentencebank.find_first(
            where={"sentenceHash": sent_hash, "movieId": None}
        )
        if existing:
            return existing
        try:
            return await db.sentencebank.create(
                data={
                    "sentenceHash": sent_hash,
                    "sentence": sentence,
                    "movieId": None,
                    "source": "llm",
                }
            )
        except Exception:
            return await db.sentencebank.find_first(
                where={"sentenceHash": sent_hash, "movieId": None}
            )

    def _build_user_payload(self, words: Sequence[WordRequest]) -> str:
        items = []
        for w in words:
            items.append({
                "word": w.word,
                "lemma": w.lemma,
                "cefr": w.cefr or "B1",
            })
        return json.dumps({"words": items}, ensure_ascii=False)

    async def _call_model(self, user_payload: str) -> Tuple[str, dict]:
        """
        Returns (response_text, usage_dict). The system prompt is cached so
        successive batches only pay for the small per-word user message.
        """
        resp = await self._client.messages.create(
            model=self._model,
            max_tokens=1500,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                },
            ],
            messages=[{"role": "user", "content": user_payload}],
        )
        text = "".join(
            block.text for block in resp.content if getattr(block, "type", "") == "text"
        )
        usage_obj = getattr(resp, "usage", None)
        usage_dict: dict = {}
        if usage_obj is not None:
            # The SDK exposes a pydantic model; model_dump() gives a plain dict.
            try:
                usage_dict = usage_obj.model_dump()
            except Exception:
                usage_dict = {
                    "input_tokens": getattr(usage_obj, "input_tokens", 0),
                    "output_tokens": getattr(usage_obj, "output_tokens", 0),
                    "cache_read_input_tokens": getattr(usage_obj, "cache_read_input_tokens", 0),
                    "cache_creation_input_tokens": getattr(usage_obj, "cache_creation_input_tokens", 0),
                }
        return text, usage_dict

    def _parse_response(self, raw: str) -> List[dict]:
        if not raw:
            return []
        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        try:
            obj = json.loads(text)
            sentences = obj.get("sentences", [])
            if isinstance(sentences, list):
                return [s for s in sentences if isinstance(s, dict)]
        except json.JSONDecodeError:
            logger.warning(f"[llm-sentence] failed to parse JSON: {raw[:200]}")
        return []

    def _validate(self, sentence: str, wreq: WordRequest) -> Optional[str]:
        s = sentence.strip().strip('"').strip("'")
        if not s:
            return None
        if "\n" in s:
            return None
        if len(s) > MAX_CHARS:
            return None
        if not re.search(r"[.!?]$", s):
            return None
        words = s.split()
        if not (MIN_WORDS <= len(words) <= MAX_WORDS):
            return None
        stem = wreq.lemma.lower()[:4]
        if not stem:
            return None
        lowered = s.lower()
        if stem not in lowered:
            return None
        return s

    def _locate_word(self, sentence: str, wreq: WordRequest) -> Tuple[str, int]:
        """
        Find the surface form and zero-based word-index of the target word
        in the sentence. Falls back to the lemma + position 0 if no obvious
        match is found (the read path can still highlight via the lemma).
        """
        tokens = re.findall(r"\b[\w'-]+\b", sentence)
        stem = wreq.lemma.lower()[:4]
        for idx, tok in enumerate(tokens):
            if tok.lower().startswith(stem):
                return tok, idx
        return wreq.lemma, 0
