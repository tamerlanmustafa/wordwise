"""
Translation Memory Service (V2 Context-Aware Translation Pipeline — Phase 4)

Sense-aware translation cache with tiered provider routing:
  Tier 0: TranslationMemory (lemma + sense + lang)
  Tier 1: Existing TranslationCache (sentence-level)
  Tier 2: Google Translate (A1/A2 words, free)
  Tier 3: DeepL (B2+ words, paid, highest quality)

Also handles:
  - Eager translation (background, high-priority lemmas)
  - On-demand translation (user clicks, lazy path)
  - Usage/report tracking
  - Auto-retranslation on high report rate
  - Backward-compatible propagation to WordSentenceExample
"""

import logging
from typing import Dict, List, Optional, Tuple, Any

from prisma import Prisma
from ..utils.deepl_client import DeepLClient, DeepLError
from ..utils.google_translate_client import GoogleTranslateClient, GoogleTranslateError
from .sense_clustering_service import select_sense_at_runtime

logger = logging.getLogger(__name__)

# Tiered provider thresholds
PRIORITY_THRESHOLD = 0.4  # Eager vs lazy translation
REPORT_THRESHOLD = 0.1    # 10% report rate triggers retranslation
MIN_USAGE_FOR_EVAL = 5    # Minimum usage before evaluating report rate

# CEFR levels that route to Google (cheap) vs DeepL (quality)
GOOGLE_CEFR_LEVELS = {"A1", "A2"}

# DeepL supported languages (same as in translation_service.py)
DEEPL_SUPPORTED_LANGS = {
    "EN", "DE", "FR", "ES", "IT", "NL", "PL", "PT", "RU",
    "JA", "ZH", "TR", "KO", "SV", "DA", "FI", "NB",
    "BG", "CS", "EL", "ET", "HU", "LT", "LV", "RO",
    "SK", "SL", "UK", "ID", "AR", "HI"
}


class TranslationMemoryService:
    """Sense-aware translation with tiered providers and caching."""

    def __init__(
        self,
        db: Prisma,
        deepl_client: Optional[DeepLClient] = None,
        google_client: Optional[GoogleTranslateClient] = None
    ):
        self.db = db
        self.deepl_client = deepl_client or DeepLClient()
        self.google_client = google_client or GoogleTranslateClient()

    # ----------------------------------------------------------------
    # Tier 0: Translation Memory lookup
    # ----------------------------------------------------------------

    async def lookup(
        self,
        lemma_id: int,
        sense_id: int,
        target_lang: str
    ) -> Optional[dict]:
        """Look up translation in TranslationMemory. Returns None on miss."""
        tm = await self.db.translationmemory.find_first(
            where={
                "lemmaId": lemma_id,
                "senseId": sense_id,
                "targetLang": target_lang.upper()
            }
        )
        if tm:
            return {
                "id": tm.id,
                "lemma_id": tm.lemmaId,
                "sense_id": tm.senseId,
                "target_lang": tm.targetLang,
                "translated_word": tm.translatedWord,
                "translated_sentence": tm.translatedSentence,
                "word_provider": tm.wordProvider,
                "sentence_provider": tm.sentenceProvider,
                "usage_count": tm.usageCount,
                "report_count": tm.reportCount,
            }
        return None

    # ----------------------------------------------------------------
    # Tier 1: Existing TranslationCache fallback
    # ----------------------------------------------------------------

    async def _check_old_cache(
        self,
        sentence: str,
        target_lang: str
    ) -> Optional[str]:
        """Check the V1 TranslationCache for an existing sentence translation."""
        import re
        normalized = sentence.lower().strip()
        normalized = re.sub(r'[.,!?;:]+$', '', normalized)
        cached = await self.db.translationcache.find_first(
            where={"sourceText": normalized, "targetLang": target_lang.upper()}
        )
        return cached.translated if cached else None

    # ----------------------------------------------------------------
    # Tier 2/3: Provider routing
    # ----------------------------------------------------------------

    def _select_provider(self, cefr_level: str, confidence: float) -> str:
        """
        Determine which provider to use based on CEFR level and confidence.
        A1/A2 or high confidence → Google (free/cheap)
        B1+ or low confidence → DeepL (quality)
        """
        if cefr_level in GOOGLE_CEFR_LEVELS or confidence > 0.8:
            return "google"
        return "deepl"

    async def _translate_with_provider(
        self,
        text: str,
        target_lang: str,
        provider: str,
        context: Optional[str] = None
    ) -> Tuple[str, str]:
        """
        Translate text using the specified provider with fallback.
        Returns (translated_text, actual_provider_used).
        """
        target = target_lang.upper()

        # If provider is DeepL, try it first
        if provider == "deepl" and target in DEEPL_SUPPORTED_LANGS:
            try:
                result = await self.deepl_client.translate(
                    text=text, target_lang=target, source_lang="EN"
                )
                return result["translated"], "deepl"
            except DeepLError as e:
                logger.warning(f"DeepL failed, falling back to Google: {e}")

        # Google fallback (or primary for A1/A2)
        try:
            result = await self.google_client.translate(
                text=text, target_lang=target, source_lang="EN"
            )
            return result["translated"], "google"
        except GoogleTranslateError as e:
            logger.error(f"Google Translate also failed: {e}")
            raise

    async def _translate_word_with_context(
        self,
        word: str,
        context_sentence: str,
        target_lang: str,
        provider: str
    ) -> Tuple[str, str]:
        """
        Translate a word using its context sentence as a hint.
        Strategy: translate "word" but prepend context for the API.
        For simplicity, we translate just the word — the sense is already
        disambiguated by which representative sentence we chose.
        """
        return await self._translate_with_provider(word, target_lang, provider)

    async def _translate_sentence(
        self,
        sentence: str,
        target_lang: str,
        provider: str
    ) -> Tuple[str, str]:
        """Translate a full sentence."""
        return await self._translate_with_provider(sentence, target_lang, provider)

    # ----------------------------------------------------------------
    # Core: translate a single (lemma, sense) pair
    # ----------------------------------------------------------------

    async def translate_sense(
        self,
        lemma_id: int,
        sense_id: int,
        target_lang: str,
        word: str,
        representative_sentence: str,
        cefr_level: str,
        confidence: float = 0.5,
    ) -> dict:
        """
        Translate a (lemma, sense) pair through the tiered pipeline.

        Tier 0: TranslationMemory → hit = done
        Tier 1: Old TranslationCache (sentence) → migrate to TM
        Tier 2/3: API call (Google or DeepL) → store in TM

        Returns the TranslationMemory entry dict.
        """
        target = target_lang.upper()

        # Tier 0: Check TranslationMemory
        existing = await self.lookup(lemma_id, sense_id, target)
        if existing:
            return existing

        # Tier 1: Check old TranslationCache for the representative sentence
        old_sentence_translation = await self._check_old_cache(representative_sentence, target)

        provider = self._select_provider(cefr_level, confidence)

        # Translate word (always fresh API call — word translations are short/cheap)
        translated_word, word_provider = await self._translate_word_with_context(
            word, representative_sentence, target, provider
        )

        # Translate sentence (use old cache if available, otherwise API)
        if old_sentence_translation:
            translated_sentence = old_sentence_translation
            sentence_provider = "cache"
        else:
            translated_sentence, sentence_provider = await self._translate_sentence(
                representative_sentence, target, provider
            )

        # Store in TranslationMemory
        tm = await self.db.translationmemory.create(
            data={
                "lemmaId": lemma_id,
                "senseId": sense_id,
                "targetLang": target,
                "translatedWord": translated_word,
                "translatedSentence": translated_sentence,
                "wordProvider": word_provider,
                "sentenceProvider": sentence_provider,
                "usageCount": 0,
                "reportCount": 0,
            }
        )

        return {
            "id": tm.id,
            "lemma_id": tm.lemmaId,
            "sense_id": tm.senseId,
            "target_lang": tm.targetLang,
            "translated_word": tm.translatedWord,
            "translated_sentence": tm.translatedSentence,
            "word_provider": tm.wordProvider,
            "sentence_provider": tm.sentenceProvider,
            "usage_count": 0,
            "report_count": 0,
        }

    # ----------------------------------------------------------------
    # Eager translation: background pipeline (Stage B)
    # ----------------------------------------------------------------

    async def translate_movie_eager(
        self,
        movie_id: int,
        target_lang: str,
        batch_delay_ms: int = 100
    ) -> Dict[str, Any]:
        """
        Stage B of the V2 pipeline: translate all EAGER senses for a movie.

        Only translates senses where:
        - The lemma's priorityScore >= PRIORITY_THRESHOLD (0.4)
        - No TranslationMemory entry exists yet for (lemma, sense, target_lang)

        Returns translation stats.
        """
        import asyncio
        target = target_lang.upper()

        # Get all lemma mappings for this movie with their lemma data
        mappings = await self.db.movielemmamapping.find_many(
            where={"movieId": movie_id},
            include={"lemma": True}
        )

        if not mappings:
            logger.info(f"No lemma mappings found for movie {movie_id}")
            return {"translated": 0, "skipped": 0, "cached": 0, "errors": 0}

        # Filter to eager lemmas (priorityScore >= threshold)
        eager_mappings = [
            m for m in mappings
            if m.lemma and m.lemma.priorityScore >= PRIORITY_THRESHOLD
        ]

        logger.info(
            f"Stage B: movie {movie_id}, lang {target} — "
            f"{len(eager_mappings)}/{len(mappings)} lemmas are eager (score >= {PRIORITY_THRESHOLD})"
        )

        stats = {"translated": 0, "skipped": 0, "cached": 0, "errors": 0}

        for i, mapping in enumerate(eager_mappings):
            lemma = mapping.lemma

            # Get all senses for this lemma
            senses = await self.db.wordsense.find_many(
                where={"lemmaId": lemma.id}
            )

            if not senses:
                stats["skipped"] += 1
                continue

            for sense in senses:
                # Check if already translated
                existing = await self.lookup(lemma.id, sense.id, target)
                if existing:
                    stats["cached"] += 1
                    continue

                if not sense.representativeSentence:
                    stats["skipped"] += 1
                    continue

                try:
                    await self.translate_sense(
                        lemma_id=lemma.id,
                        sense_id=sense.id,
                        target_lang=target,
                        word=lemma.lemma,
                        representative_sentence=sense.representativeSentence,
                        cefr_level=lemma.cefrLevel,
                        confidence=lemma.confidence,
                    )
                    stats["translated"] += 1
                except Exception as e:
                    logger.error(f"Failed to translate {lemma.lemma} sense {sense.senseIndex}: {e}")
                    stats["errors"] += 1

            # Rate limit: small delay between lemmas
            if i > 0 and i % 10 == 0:
                await asyncio.sleep(batch_delay_ms / 1000)

        logger.info(f"Stage B complete: {stats}")
        return stats

    # ----------------------------------------------------------------
    # On-demand translation: runtime (user clicks a word)
    # ----------------------------------------------------------------

    async def translate_on_demand(
        self,
        word: str,
        clicked_sentence: Optional[str],
        target_lang: str,
        movie_id: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Handle a user word click — find sense, check TM, translate if needed.

        Flow:
        1. Lemmatize the word (spaCy, <1ms with LRU)
        2. Fetch senses for the lemma
        3. Select the right sense (TF-IDF vs representative sentences)
        4. Check TranslationMemory
        5. If miss → translate on-demand → store in TM
        6. Increment usageCount
        7. Return translation

        Returns None if the word has no lemma in our registry.
        """
        from .lemmatization_service import get_nlp

        target = target_lang.upper()
        nlp = get_nlp()

        # Step 1: Lemmatize
        doc = nlp(word.lower().strip())
        if not doc or len(doc) == 0:
            return None
        lemma_text = doc[0].lemma_

        # Step 2: Find lemma in registry
        lemma = await self.db.lemma.find_first(where={"lemma": lemma_text})
        if not lemma:
            return None

        # Step 3: Get senses
        senses = await self.db.wordsense.find_many(where={"lemmaId": lemma.id})
        if not senses:
            return None

        # Step 4: Select the right sense
        if len(senses) == 1:
            sense = senses[0]
        elif clicked_sentence:
            # TF-IDF comparison for multi-sense lemmas
            sense_reps = {
                s.id: s.representativeSentence
                for s in senses
                if s.representativeSentence
            }
            if sense_reps:
                best_sense_id = select_sense_at_runtime(clicked_sentence, sense_reps)
                sense = next((s for s in senses if s.id == best_sense_id), senses[0])
            else:
                sense = senses[0]
        elif movie_id:
            # Fallback: dominant sense for this movie
            mapping = await self.db.movielemmamapping.find_first(
                where={"movieId": movie_id, "lemmaId": lemma.id}
            )
            if mapping and mapping.dominantSenseId:
                sense = next(
                    (s for s in senses if s.id == mapping.dominantSenseId),
                    senses[0]
                )
            else:
                sense = senses[0]
        else:
            # Ultimate fallback: sense_0
            sense = sorted(senses, key=lambda s: s.senseIndex)[0]

        # Step 5: Check TranslationMemory
        tm = await self.lookup(lemma.id, sense.id, target)

        # Step 6: If miss → translate on-demand
        if not tm:
            if not sense.representativeSentence:
                return None

            try:
                tm = await self.translate_sense(
                    lemma_id=lemma.id,
                    sense_id=sense.id,
                    target_lang=target,
                    word=lemma.lemma,
                    representative_sentence=sense.representativeSentence,
                    cefr_level=lemma.cefrLevel,
                    confidence=lemma.confidence,
                )
            except Exception as e:
                logger.error(f"On-demand translation failed for {word}: {e}")
                return None

        # Step 7: Increment usageCount
        try:
            await self.db.translationmemory.update(
                where={"id": tm["id"]},
                data={"usageCount": {"increment": 1}}
            )
        except Exception:
            pass  # Non-critical

        return {
            "lemma": lemma.lemma,
            "sense_id": sense.id,
            "sense_label": sense.label,
            "sense_index": sense.senseIndex,
            "translated_word": tm["translated_word"],
            "translated_sentence": tm.get("translated_sentence"),
            "representative_sentence": sense.representativeSentence,
            "target_lang": target,
            "cefr_level": lemma.cefrLevel,
            "provider": tm["word_provider"],
        }

    # ----------------------------------------------------------------
    # Propagation: write back to WordSentenceExample (backward compat)
    # ----------------------------------------------------------------

    async def propagate_to_word_sentence_examples(
        self,
        movie_id: int,
        target_lang: str
    ) -> int:
        """
        Step B3: For each SentenceLemmaLink for this movie, look up the
        TranslationMemory entry and write to WordSentenceExample.

        This keeps the V1 read path working while V2 is the write path.
        Returns count of examples written.
        """
        target = target_lang.upper()

        # Get all sentence bank entries for this movie
        sentences = await self.db.sentencebank.find_many(
            where={"movieId": movie_id},
            include={"lemmaLinks": {"include": {"lemma": True, "sense": True}}}
        )

        count = 0
        for sb in sentences:
            for link in sb.lemmaLinks:
                if not link.senseId or not link.lemma:
                    continue

                # Look up translation
                tm = await self.db.translationmemory.find_first(
                    where={
                        "lemmaId": link.lemmaId,
                        "senseId": link.senseId,
                        "targetLang": target
                    }
                )
                if not tm:
                    continue

                # Get CEFR level from lemma
                cefr_level = link.lemma.cefrLevel if link.lemma else "B1"

                # Get word forms to find which surface form to use
                word = link.lemma.lemma if link.lemma else "unknown"

                # Upsert into WordSentenceExample
                try:
                    existing = await self.db.wordsentenceexample.find_first(
                        where={
                            "movieId": movie_id,
                            "word": word,
                            "sentence": sb.sentence,
                            "targetLang": target,
                        }
                    )
                    if not existing:
                        await self.db.wordsentenceexample.create(
                            data={
                                "movieId": movie_id,
                                "word": word,
                                "lemma": word,
                                "sentence": sb.sentence,
                                "translation": tm.translatedSentence or "",
                                "targetLang": target,
                                "cefrLevel": cefr_level,
                                "wordPosition": link.wordPosition or 0,
                            }
                        )
                        count += 1
                except Exception as e:
                    logger.debug(f"Propagation skipped for {word}: {e}")

        return count

    # ----------------------------------------------------------------
    # Usage tracking: report bad translation + auto-retranslation
    # ----------------------------------------------------------------

    async def report_translation(self, tm_id: int) -> Dict[str, Any]:
        """
        Report a bad translation. Increments reportCount and triggers
        auto-retranslation if report rate exceeds threshold.
        """
        tm = await self.db.translationmemory.update(
            where={"id": tm_id},
            data={"reportCount": {"increment": 1}},
            include={"sense": True, "lemma": True}
        )

        result = {"reported": True, "retranslated": False}

        # Check if we should auto-retranslate
        if tm.usageCount >= MIN_USAGE_FOR_EVAL:
            report_rate = tm.reportCount / tm.usageCount
            if report_rate > REPORT_THRESHOLD:
                try:
                    await self._retranslate_with_deepl(tm)
                    result["retranslated"] = True
                    logger.info(
                        f"Auto-retranslated TM {tm_id} (report rate: {report_rate:.2f})"
                    )
                except Exception as e:
                    logger.error(f"Auto-retranslation failed for TM {tm_id}: {e}")

        return result

    async def _retranslate_with_deepl(self, tm) -> None:
        """Force retranslate with DeepL (highest quality provider)."""
        sense = tm.sense
        if not sense or not sense.representativeSentence:
            return

        word = tm.lemma.lemma if tm.lemma else "unknown"

        translated_word, _ = await self._translate_with_provider(
            word, tm.targetLang, "deepl"
        )
        translated_sentence, _ = await self._translate_with_provider(
            sense.representativeSentence, tm.targetLang, "deepl"
        )

        await self.db.translationmemory.update(
            where={"id": tm.id},
            data={
                "translatedWord": translated_word,
                "translatedSentence": translated_sentence,
                "wordProvider": "deepl",
                "sentenceProvider": "deepl",
                "reportCount": 0,  # Reset after retranslation
            }
        )

    # ----------------------------------------------------------------
    # Stats
    # ----------------------------------------------------------------

    async def get_translation_memory_stats(
        self,
        target_lang: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get TranslationMemory stats."""
        where = {}
        if target_lang:
            where["targetLang"] = target_lang.upper()

        total = await self.db.translationmemory.count(where=where)
        lemma_count = await self.db.lemma.count()
        sense_count = await self.db.wordsense.count()

        return {
            "total_entries": total,
            "total_lemmas": lemma_count,
            "total_senses": sense_count,
            "target_lang": target_lang.upper() if target_lang else "all",
        }
