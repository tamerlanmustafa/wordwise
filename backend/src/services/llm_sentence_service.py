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
read cumulative spend and refuse to fire once it reaches
settings.llm_cost_cap_usd. That read goes through
services/llm_cost_ledger.py, which answers it without scanning the whole
ledger — see issue #126.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, List, Optional, Sequence, Tuple

from prisma import Prisma

from src.config import get_settings
from src.services.llm_cost_ledger import LedgerSpendTracker, spend_tracker
from src.services.sentence_bank_service import hash_sentence

logger = logging.getLogger(__name__)

MIN_WORDS = 6
MAX_WORDS = 22
MAX_CHARS = 140

# Bump whenever SYSTEM_PROMPT or the _validate rules change in a way that could
# make the model succeed on a word it previously declined. The sentence worker
# stores "<model>|<this>" on every refusal (#153) and only skips a lemma while
# that string matches its own; changing either half re-admits the whole backlog
# without a cleanup pass.
SENTENCE_PROMPT_VERSION = "1"

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


ALIGN_SYSTEM_PROMPT = """You align a single word's translation to how it is used in a sentence, for a language-learning vocabulary card.

You are given: a target_lang code, an English `word`, an English `sentence` containing it, and `sentence_translation` (that sentence already translated into target_lang).

Return the target_lang translation of `word` AS USED IN THIS SENTENCE — the same sense/meaning the sentence_translation conveys, so the card's word gloss agrees with the sentence. Rules:
- Give the dictionary / base (citation) form in target_lang, not the exact inflected surface form (e.g. base adjective, verb infinitive), but it MUST be the sense used here.
- One or a few words only — never a whole phrase or explanation.
- Lowercase unless the language requires otherwise. No quotes, no punctuation, no parentheticals, no romanization.

Return ONLY valid JSON, no prose: {"translation": "<target_lang word>"}
If you cannot determine it, return {"translation": null}."""


class CostCapExceeded(RuntimeError):
    """Raised when cumulative ledger spend has reached the configured cap."""


class ModelCallFailed(RuntimeError):
    """The Anthropic call did not complete — network, timeout, 4xx or 5xx.

    Deliberately distinct from the model *declining* a word. Nothing came back
    and nothing was billed, so every word in the batch is still unanswered;
    a caller must not record any of them as a durable fact about the word.

    Before #153 this was swallowed here and returned as an all-None result,
    which is indistinguishable from "the model looked at these words and had
    nothing for any of them". That was harmless while the sentence worker's
    skip list lived in memory and died with the process. It stopped being
    harmless the moment the skip list moved onto `lemmas`: on 2026-08-22 the
    Anthropic credit balance ran out and every call started returning 400, so
    the old shape would have written the entire 2,072-lemma backlog off as
    permanently refused inside about fourteen cycles.
    """


@dataclass(frozen=True)
class WordRequest:
    """One word to generate a sentence for."""
    word: str           # surface form the caller knows (e.g. "abandoned")
    lemma: str          # canonical form for matching (e.g. "abandon")
    cefr: Optional[str] # "A1".."C2" or None


class LLMSentenceService:
    """Thin wrapper around the Anthropic client for example-sentence generation."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        *,
        spend: Optional[LedgerSpendTracker] = None,
    ):
        settings = get_settings()
        key = api_key or settings.anthropic_api_key
        if not key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set; LLM sentence generation disabled."
            )
        # Lazy import: CI installs requirements-dev.txt, which omits the
        # anthropic SDK, but consumers (worker, tests) still import this
        # module for WordRequest / CostCapExceeded.
        from anthropic import AsyncAnthropic

        self._client = AsyncAnthropic(api_key=key)
        self._model = model or settings.anthropic_sentence_model
        self._cap_usd: float = settings.llm_cost_cap_usd
        # Shared by default: the ledger is process-wide, and the batch endpoint
        # builds a service per request, so a private tracker would be cold every
        # time. Tests pass their own to stay isolated from each other.
        self._spend: LedgerSpendTracker = spend or spend_tracker

    # ─── Public API ─────────────────────────────────────────────────────────

    @property
    def skip_version(self) -> str:
        """Signature for "what would decline a word right now" (#153).

        The sentence worker stores this on a refused lemma and excludes the
        lemma only while the stored value still equals this one, so changing
        the model or the prompt is itself the revocation.
        """
        return f"{self._model}|{SENTENCE_PROMPT_VERSION}"

    async def generate_sentences(
        self,
        db: Prisma,
        words: Sequence[WordRequest],
        context: str = "unknown",
    ) -> Dict[str, Optional[str]]:
        """
        Generate one sentence per input word. Returns a dict keyed by the
        word's lemma (lowercased). Missing/invalid entries map to None.

        A None here means "the model answered and had nothing usable for this
        word" — a fact about the word. If the call itself fails we raise
        ModelCallFailed instead of returning all-None, so a caller can never
        mistake an outage for 15 refusals (#153).

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
            raise ModelCallFailed(str(e)) from e

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
        spend cap has been reached, and ModelCallFailed if the API call itself
        did not complete — a word absent from the result is only a refusal
        when this returns normally.
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
                #
                # `isGlobal` is deliberately absent: a trigger derives it from
                # the sentence row (#120). Setting it here would create a
                # second source of truth for the flag every study surface
                # filters on, and the drift would be silent.
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

    async def align_word_translation(
        self,
        db: Prisma,
        word: str,
        sentence: str,
        sentence_translation: str,
        target_lang: str,
        context: str = "gloss_align",
    ) -> Optional[str]:
        """
        Return the target-language translation of `word` AS USED IN
        `sentence`, consistent with `sentence_translation`, so a vocab card's
        word gloss matches the sentence it sits next to. Base/citation form.

        Returns None (caller falls back to a plain word translation) when the
        cost cap is hit, the API errors, or the model can't align. Raises
        CostCapExceeded — callers treat it as "skip, use the fallback".
        """
        if not word.strip() or not sentence.strip() or not sentence_translation.strip():
            return None

        await self._check_cap(db)

        user_payload = json.dumps(
            {
                "target_lang": target_lang.upper(),
                "word": word,
                "sentence": sentence,
                "sentence_translation": sentence_translation,
            },
            ensure_ascii=False,
        )
        try:
            raw_text, usage = await self._call_model(
                user_payload, system=ALIGN_SYSTEM_PROMPT, max_tokens=120
            )
        except Exception as e:
            logger.warning(f"[llm-align] model call failed word='{word}': {e}")
            return None

        # We paid for the call regardless of whether parsing succeeds.
        await self._record_usage(db, usage, context=context)

        return self._parse_gloss(raw_text)

    @staticmethod
    def _parse_gloss(raw: str) -> Optional[str]:
        """Extract {"translation": "..."} from the align model's reply."""
        if not raw:
            return None
        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            logger.warning(f"[llm-align] failed to parse JSON: {raw[:120]}")
            return None
        val = obj.get("translation") if isinstance(obj, dict) else None
        if not isinstance(val, str):
            return None
        val = val.strip().strip('"').strip("'")
        # Guard against the model echoing an explanation instead of a gloss.
        if not val or "\n" in val or len(val) > 60:
            return None
        return val

    # ─── Cost cap & ledger ──────────────────────────────────────────────────

    async def _check_cap(self, db: Prisma) -> None:
        """Raise CostCapExceeded if cumulative ledger spend ≥ cap. Cap of 0 disables."""
        if not self._cap_usd or self._cap_usd <= 0:
            return
        total = await self._spend.total_usd(db)
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

    async def _call_model(
        self,
        user_payload: str,
        system: str = SYSTEM_PROMPT,
        max_tokens: int = 1500,
    ) -> Tuple[str, dict]:
        """
        Returns (response_text, usage_dict). The system prompt is cached so
        successive batches only pay for the small per-word user message.
        Defaults drive sentence generation; the align path passes its own
        system prompt and a small token budget.
        """
        resp = await self._client.messages.create(
            model=self._model,
            max_tokens=max_tokens,
            system=[
                {
                    "type": "text",
                    "text": system,
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
