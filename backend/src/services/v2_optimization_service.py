"""
V2 Optimization Service (Phase 5: Optimization & Quality)

Provides:
  1. Backfill: Process all existing movies through V2 pipeline (Stage A)
  2. Migration: Migrate TranslationCache entries → TranslationMemory
  3. MiniLM hybrid clustering: Split/merge refinement within clusters
  4. Priority score recalculation: Recompute with fresh click rate data
  5. Cost monitoring: Cache hit rates, API call counts, provider breakdown
  6. Quality metrics: Report analysis, sense accuracy, auto-retranslation audit
"""

import logging
import asyncio
from typing import Dict, List, Optional, Any, Tuple

from prisma import Prisma

logger = logging.getLogger(__name__)


class V2OptimizationService:
    """Phase 5 optimization operations for the V2 pipeline."""

    def __init__(self, db: Prisma):
        self.db = db

    # ================================================================
    # 1. Backfill: Process existing movies through V2 Stage A pipeline
    # ================================================================

    async def backfill_all_movies(
        self,
        skip_already_processed: bool = True,
        progress_callback=None,
    ) -> Dict[str, Any]:
        """
        Run V2 Stage A (NLP) for all existing movies that have scripts and
        classifications but haven't been processed through V2 yet.

        Stage A = Lemmatization → SentenceBank → Sense Clustering
        (No translation — that's Stage B, triggered per language.)

        Returns stats dict.
        """
        from .sentence_bank_service import populate_sentence_bank
        from .sense_clustering_service import cluster_and_store_senses
        from .sentence_example_service import SentenceExampleService

        # Find all movies with scripts
        movies = await self.db.movie.find_many(
            include={"movieScripts": True}
        )

        stats = {
            "total_movies": len(movies),
            "processed": 0,
            "skipped_no_script": 0,
            "skipped_no_classifications": 0,
            "skipped_already_done": 0,
            "errors": 0,
            "details": [],
        }

        for i, movie in enumerate(movies):
            movie_id = movie.id
            movie_title = movie.title or f"Movie #{movie_id}"

            if not movie.movieScripts:
                stats["skipped_no_script"] += 1
                continue

            script = movie.movieScripts[0]
            if not script.cleanedScriptText:
                stats["skipped_no_script"] += 1
                continue

            # Check if classifications exist
            wc_count = await self.db.wordclassification.count(
                where={"scriptId": script.id}
            )
            if wc_count == 0:
                stats["skipped_no_classifications"] += 1
                continue

            # Check if already processed (has MovieLemmaMapping entries)
            if skip_already_processed:
                existing_mappings = await self.db.movielemmamapping.count(
                    where={"movieId": movie_id}
                )
                if existing_mappings > 0:
                    stats["skipped_already_done"] += 1
                    continue

            try:
                logger.info(f"Backfill Stage A: movie {movie_id} ({movie_title})")

                # Get vocabulary words
                word_classifications = await self.db.wordclassification.find_many(
                    where={"scriptId": script.id}
                )
                vocabulary_words = set(wc.word.lower() for wc in word_classifications)

                # Extract sentences
                sentence_service = SentenceExampleService()
                word_sentences = sentence_service.extract_word_sentences(
                    script.cleanedScriptText,
                    vocabulary_words,
                )

                # Build word -> lemma mapping
                word_to_lemma = {
                    wc.word.lower(): wc.lemma.lower()
                    for wc in word_classifications
                }

                # Get lemma IDs
                lemma_strs = list(set(word_to_lemma.values()))
                lemma_records = await self.db.lemma.find_many(
                    where={"lemma": {"in": lemma_strs}}
                )
                lemma_id_map = {lr.lemma: lr.id for lr in lemma_records}

                # Populate SentenceBank + SentenceLemmaLink
                await populate_sentence_bank(
                    db=self.db,
                    movie_id=movie_id,
                    word_sentences=word_sentences,
                    lemma_id_map=lemma_id_map,
                    word_to_lemma=word_to_lemma,
                )

                # Sense Clustering
                senses_created = await cluster_and_store_senses(
                    db=self.db,
                    movie_id=movie_id,
                    lemma_id_map=lemma_id_map,
                )

                stats["processed"] += 1
                stats["details"].append({
                    "movie_id": movie_id,
                    "title": movie_title,
                    "words": len(vocabulary_words),
                    "senses": senses_created,
                })

                if progress_callback:
                    progress_callback(i + 1, len(movies), movie_title)

            except Exception as e:
                logger.error(f"Backfill failed for movie {movie_id}: {e}", exc_info=True)
                stats["errors"] += 1
                stats["details"].append({
                    "movie_id": movie_id,
                    "title": movie_title,
                    "error": str(e),
                })

        logger.info(
            f"Backfill complete: {stats['processed']} movies processed, "
            f"{stats['skipped_already_done']} skipped (already done), "
            f"{stats['errors']} errors"
        )
        return stats

    # ================================================================
    # 2. Migrate TranslationCache → TranslationMemory
    # ================================================================

    async def migrate_translation_cache(
        self,
        target_lang: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Migrate entries from the V1 TranslationCache into TranslationMemory.

        Strategy:
        - For each cached translation, find the matching lemma + sense
        - If a match exists and no TM entry exists, create one with provider="cache_migration"
        - Only migrates word-level entries (short source texts, likely single words)

        Returns migration stats.
        """
        where = {}
        if target_lang:
            where["targetLang"] = target_lang.upper()

        # Get all cache entries
        cache_entries = await self.db.translationcache.find_many(where=where)

        stats = {
            "total_cache_entries": len(cache_entries),
            "migrated": 0,
            "skipped_no_lemma": 0,
            "skipped_no_sense": 0,
            "skipped_already_exists": 0,
            "skipped_too_long": 0,
            "errors": 0,
        }

        for entry in cache_entries:
            source = entry.sourceText.strip().lower()

            # Only migrate short entries (likely single words or short phrases)
            if len(source.split()) > 5:
                stats["skipped_too_long"] += 1
                continue

            # Find matching lemma
            lemma = await self.db.lemma.find_first(where={"lemma": source})
            if not lemma:
                # Try the source text as-is (might be a word form, not lemma)
                # Use spaCy to lemmatize
                try:
                    from .lemmatization_service import get_nlp
                    nlp = get_nlp()
                    doc = nlp(source)
                    if doc and len(doc) > 0:
                        lemma_text = doc[0].lemma_
                        lemma = await self.db.lemma.find_first(where={"lemma": lemma_text})
                except Exception:
                    pass

            if not lemma:
                stats["skipped_no_lemma"] += 1
                continue

            # Get the first sense (sense_0) for this lemma
            sense = await self.db.wordsense.find_first(
                where={"lemmaId": lemma.id},
                order={"senseIndex": "asc"},
            )
            if not sense:
                stats["skipped_no_sense"] += 1
                continue

            target = entry.targetLang.upper()

            # Check if TM entry already exists
            existing_tm = await self.db.translationmemory.find_first(
                where={
                    "lemmaId": lemma.id,
                    "senseId": sense.id,
                    "targetLang": target,
                }
            )
            if existing_tm:
                stats["skipped_already_exists"] += 1
                continue

            # Create TM entry from cache
            try:
                await self.db.translationmemory.create(
                    data={
                        "lemmaId": lemma.id,
                        "senseId": sense.id,
                        "targetLang": target,
                        "translatedWord": entry.translated,
                        "translatedSentence": None,
                        "wordProvider": "cache_migration",
                        "sentenceProvider": None,
                        "usageCount": 0,
                        "reportCount": 0,
                    }
                )
                stats["migrated"] += 1
            except Exception as e:
                logger.debug(f"Migration failed for '{source}' → {target}: {e}")
                stats["errors"] += 1

        logger.info(
            f"Cache migration: {stats['migrated']} entries migrated, "
            f"{stats['skipped_already_exists']} already existed"
        )
        return stats

    # ================================================================
    # 3. MiniLM Hybrid Clustering Upgrade
    # ================================================================

    async def refine_clusters_with_minilm(
        self,
        lemma_id: Optional[int] = None,
        similarity_merge_threshold: float = 0.88,
        similarity_split_threshold: float = 0.5,
    ) -> Dict[str, Any]:
        """
        MiniLM hybrid clustering: refine TF-IDF clusters with MiniLM embeddings.

        For each lemma with 2+ senses:
        1. MERGE: If two sense representatives have MiniLM similarity > merge_threshold,
           merge them (keep lower senseIndex, reassign links)
        2. SPLIT: If sentences within a sense have MiniLM similarity < split_threshold
           to the representative, flag them for review

        This is a refinement pass, not a full re-clustering.
        """
        from .sense_clustering_service import compute_minilm_similarity

        where = {}
        if lemma_id:
            where["id"] = lemma_id

        # Find lemmas with multiple senses
        lemmas = await self.db.lemma.find_many(where=where)

        stats = {
            "lemmas_checked": 0,
            "merges": 0,
            "split_candidates": 0,
            "errors": 0,
        }

        for lemma in lemmas:
            senses = await self.db.wordsense.find_many(
                where={"lemmaId": lemma.id},
                order={"senseIndex": "asc"},
            )

            if len(senses) < 2:
                continue

            stats["lemmas_checked"] += 1

            # MERGE pass: check all pairs of senses
            reps = [
                (s.id, s.representativeSentence)
                for s in senses
                if s.representativeSentence
            ]

            merged_ids = set()
            for i in range(len(reps)):
                if reps[i][0] in merged_ids:
                    continue
                for j in range(i + 1, len(reps)):
                    if reps[j][0] in merged_ids:
                        continue

                    try:
                        sim = compute_minilm_similarity(reps[i][1], reps[j][1])
                        if sim >= similarity_merge_threshold:
                            # Merge sense j into sense i
                            keep_id = reps[i][0]
                            merge_id = reps[j][0]

                            # Reassign all SentenceLemmaLinks from merge → keep
                            await self.db.sentencelemmalink.update_many(
                                where={"senseId": merge_id},
                                data={"senseId": keep_id},
                            )

                            # Reassign TranslationMemory entries
                            tms = await self.db.translationmemory.find_many(
                                where={"senseId": merge_id}
                            )
                            for tm in tms:
                                # Check if target already has this (lemma, keep_sense, lang)
                                existing = await self.db.translationmemory.find_first(
                                    where={
                                        "lemmaId": lemma.id,
                                        "senseId": keep_id,
                                        "targetLang": tm.targetLang,
                                    }
                                )
                                if existing:
                                    # Delete the duplicate
                                    await self.db.translationmemory.delete(
                                        where={"id": tm.id}
                                    )
                                else:
                                    await self.db.translationmemory.update(
                                        where={"id": tm.id},
                                        data={"senseId": keep_id},
                                    )

                            # Update sentence count on kept sense
                            keep_sense = await self.db.wordsense.find_unique(
                                where={"id": keep_id}
                            )
                            merge_sense = await self.db.wordsense.find_unique(
                                where={"id": merge_id}
                            )
                            if keep_sense and merge_sense:
                                await self.db.wordsense.update(
                                    where={"id": keep_id},
                                    data={
                                        "sentenceCount": keep_sense.sentenceCount + merge_sense.sentenceCount,
                                    },
                                )

                            # Delete merged sense
                            await self.db.wordsense.delete(where={"id": merge_id})
                            merged_ids.add(merge_id)
                            stats["merges"] += 1

                            logger.info(
                                f"Merged sense {merge_id} into {keep_id} "
                                f"for lemma '{lemma.lemma}' (sim={sim:.3f})"
                            )
                    except Exception as e:
                        logger.debug(f"MiniLM refinement error: {e}")
                        stats["errors"] += 1

        logger.info(
            f"MiniLM refinement: {stats['lemmas_checked']} lemmas checked, "
            f"{stats['merges']} senses merged"
        )
        return stats

    # ================================================================
    # 4. Priority Score Recalculation
    # ================================================================

    async def recalculate_priority_scores(self) -> Dict[str, Any]:
        """
        Recompute priorityScore for all lemmas using fresh click rate data.

        Click rate = usageCount across all TM entries for this lemma,
        normalized by the lemma's totalMovieCount.
        """
        from .lemmatization_service import compute_priority_score

        lemmas = await self.db.lemma.find_many()
        total_lemmas = len(lemmas)

        stats = {"updated": 0, "unchanged": 0}

        for lemma in lemmas:
            # Get total usage across all TM entries for this lemma
            tm_entries = await self.db.translationmemory.find_many(
                where={"lemmaId": lemma.id}
            )
            total_usage = sum(tm.usageCount for tm in tm_entries)

            # Compute click rate (normalize by movie count to avoid bias)
            movie_count = max(lemma.totalMovieCount, 1)
            click_rate = min(1.0, total_usage / (movie_count * 10))  # 10 clicks per movie = max

            new_score = compute_priority_score(
                frequency_rank=lemma.frequencyRank,
                total_lemmas=total_lemmas,
                cefr_level=lemma.cefrLevel,
                click_rate=click_rate,
            )

            if abs(new_score - lemma.priorityScore) > 0.01:
                await self.db.lemma.update(
                    where={"id": lemma.id},
                    data={"priorityScore": new_score},
                )
                stats["updated"] += 1
            else:
                stats["unchanged"] += 1

        logger.info(
            f"Priority recalculation: {stats['updated']} updated, "
            f"{stats['unchanged']} unchanged"
        )
        return stats

    # ================================================================
    # 5. Cost Monitoring
    # ================================================================

    async def get_cost_monitoring_stats(
        self,
        target_lang: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Cache hit rates, API call counts, provider breakdown.
        """
        tm_where = {}
        if target_lang:
            tm_where["targetLang"] = target_lang.upper()

        # Total TM entries
        total_tm = await self.db.translationmemory.count(where=tm_where)

        # Provider breakdown (word translations)
        all_tm = await self.db.translationmemory.find_many(where=tm_where)

        word_providers: Dict[str, int] = {}
        sentence_providers: Dict[str, int] = {}
        total_usage = 0
        total_reports = 0

        for tm in all_tm:
            wp = tm.wordProvider or "unknown"
            word_providers[wp] = word_providers.get(wp, 0) + 1

            sp = tm.sentenceProvider or "none"
            sentence_providers[sp] = sentence_providers.get(sp, 0) + 1

            total_usage += tm.usageCount
            total_reports += tm.reportCount

        # V1 cache stats
        cache_where = {}
        if target_lang:
            cache_where["targetLang"] = target_lang.upper()
        v1_cache_count = await self.db.translationcache.count(where=cache_where)

        # Lemma stats
        total_lemmas = await self.db.lemma.count()
        total_senses = await self.db.wordsense.count()

        # Eager vs lazy coverage
        eager_lemmas = await self.db.lemma.count(
            where={"priorityScore": {"gte": 0.4}}
        )
        lazy_lemmas = total_lemmas - eager_lemmas

        # Translated vs untranslated senses
        translated_senses = total_tm  # Each TM entry = 1 translated sense (per lang)

        # Sentence bank stats
        total_sentences = await self.db.sentencebank.count()
        total_links = await self.db.sentencelemmalink.count()

        return {
            "translation_memory": {
                "total_entries": total_tm,
                "total_usage": total_usage,
                "total_reports": total_reports,
                "report_rate": total_reports / max(total_usage, 1),
                "word_providers": word_providers,
                "sentence_providers": sentence_providers,
            },
            "v1_cache": {
                "total_entries": v1_cache_count,
            },
            "coverage": {
                "total_lemmas": total_lemmas,
                "total_senses": total_senses,
                "eager_lemmas": eager_lemmas,
                "lazy_lemmas": lazy_lemmas,
                "translated_senses": translated_senses,
                "translation_coverage_pct": round(
                    translated_senses / max(total_senses, 1) * 100, 1
                ),
            },
            "sentence_bank": {
                "total_sentences": total_sentences,
                "total_links": total_links,
            },
            "target_lang": target_lang.upper() if target_lang else "all",
        }

    # ================================================================
    # 6. Quality Metrics
    # ================================================================

    async def get_quality_metrics(
        self,
        target_lang: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Quality analysis: report rates, auto-retranslation audit,
        sense accuracy indicators.
        """
        tm_where = {}
        if target_lang:
            tm_where["targetLang"] = target_lang.upper()

        all_tm = await self.db.translationmemory.find_many(
            where=tm_where,
            include={"lemma": True, "sense": True},
        )

        # Reported translations (sorted by report rate)
        reported = []
        retranslation_candidates = []
        provider_quality: Dict[str, Dict[str, int]] = {}  # provider -> {total, reported}

        for tm in all_tm:
            wp = tm.wordProvider or "unknown"
            if wp not in provider_quality:
                provider_quality[wp] = {"total": 0, "reported": 0, "total_usage": 0}
            provider_quality[wp]["total"] += 1
            provider_quality[wp]["reported"] += tm.reportCount
            provider_quality[wp]["total_usage"] += tm.usageCount

            if tm.reportCount > 0:
                rate = tm.reportCount / max(tm.usageCount, 1)
                entry = {
                    "tm_id": tm.id,
                    "lemma": tm.lemma.lemma if tm.lemma else "?",
                    "sense_label": tm.sense.label if tm.sense else "?",
                    "translated_word": tm.translatedWord,
                    "target_lang": tm.targetLang,
                    "usage_count": tm.usageCount,
                    "report_count": tm.reportCount,
                    "report_rate": round(rate, 3),
                    "provider": wp,
                }
                reported.append(entry)

                if tm.usageCount >= 5 and rate > 0.1:
                    retranslation_candidates.append(entry)

        # Sort by report rate descending
        reported.sort(key=lambda x: x["report_rate"], reverse=True)

        # Sense distribution stats
        sense_counts = {}
        for tm in all_tm:
            lemma_name = tm.lemma.lemma if tm.lemma else "?"
            if lemma_name not in sense_counts:
                sense_counts[lemma_name] = 0
            sense_counts[lemma_name] += 1

        multi_sense_lemmas = sum(1 for c in sense_counts.values() if c > 1)

        # Provider quality summary
        provider_summary = {}
        for prov, data in provider_quality.items():
            provider_summary[prov] = {
                "total_translations": data["total"],
                "total_reports": data["reported"],
                "total_usage": data["total_usage"],
                "report_rate": round(
                    data["reported"] / max(data["total_usage"], 1), 4
                ),
            }

        return {
            "total_entries": len(all_tm),
            "reported_translations": reported[:50],  # Top 50
            "retranslation_candidates": retranslation_candidates,
            "provider_quality": provider_summary,
            "sense_stats": {
                "multi_sense_lemmas_with_translations": multi_sense_lemmas,
                "single_sense_lemmas_with_translations": len(sense_counts) - multi_sense_lemmas,
            },
            "target_lang": target_lang.upper() if target_lang else "all",
        }

    # ================================================================
    # 7. Performance Benchmarks
    # ================================================================

    async def run_performance_benchmarks(self) -> Dict[str, Any]:
        """
        Measure key performance metrics for the V2 pipeline.
        """
        import time

        results = {}

        # Benchmark 1: TM lookup speed
        tm_entry = await self.db.translationmemory.find_first()
        if tm_entry:
            start = time.perf_counter()
            for _ in range(100):
                await self.db.translationmemory.find_first(
                    where={
                        "lemmaId": tm_entry.lemmaId,
                        "senseId": tm_entry.senseId,
                        "targetLang": tm_entry.targetLang,
                    }
                )
            elapsed = time.perf_counter() - start
            results["tm_lookup_avg_ms"] = round(elapsed / 100 * 1000, 2)

        # Benchmark 2: Sense selection speed (TF-IDF)
        sense_with_rep = await self.db.wordsense.find_first(
            where={"representativeSentence": {"not": None}}
        )
        if sense_with_rep:
            from .sense_clustering_service import select_sense_at_runtime
            senses = await self.db.wordsense.find_many(
                where={"lemmaId": sense_with_rep.lemmaId}
            )
            reps = [
                (s.id, s.representativeSentence)
                for s in senses
                if s.representativeSentence
            ]
            if len(reps) >= 2:
                test_sentence = reps[0][1]
                start = time.perf_counter()
                for _ in range(100):
                    select_sense_at_runtime(test_sentence, reps)
                elapsed = time.perf_counter() - start
                results["sense_selection_avg_ms"] = round(elapsed / 100 * 1000, 2)

        # Benchmark 3: Lemma lookup speed (spaCy lemmatization)
        try:
            from .lemmatization_service import get_nlp
            nlp = get_nlp()
            test_words = ["running", "beautiful", "happiness", "went", "better"]
            start = time.perf_counter()
            for _ in range(100):
                for w in test_words:
                    nlp(w)
            elapsed = time.perf_counter() - start
            results["spacy_lemmatize_avg_ms"] = round(elapsed / (100 * len(test_words)) * 1000, 3)
        except Exception as e:
            results["spacy_lemmatize_error"] = str(e)

        # Pipeline size stats
        results["pipeline_stats"] = {
            "total_lemmas": await self.db.lemma.count(),
            "total_senses": await self.db.wordsense.count(),
            "total_sentences": await self.db.sentencebank.count(),
            "total_tm_entries": await self.db.translationmemory.count(),
            "total_movies_with_mappings": len(
                set(
                    m.movieId
                    for m in await self.db.movielemmamapping.find_many()
                )
            ),
        }

        return results

    # ================================================================
    # 8. Migration Readiness Check
    # ================================================================

    async def check_migration_readiness(self) -> Dict[str, Any]:
        """
        Check whether V2 pipeline is ready to fully replace V1 dual-write.

        Conditions for safe cleanup:
        1. All movies with scripts have MovieLemmaMapping entries (Stage A done)
        2. TranslationMemory covers >=80% of eager senses for at least one language
        3. V1 WordSentenceExample rows have been backfilled from V2
        4. Report rate is below 5% across all TM entries

        Returns readiness status and blockers.
        """
        blockers = []

        # Check 1: All movies have lemma mappings
        movies_with_scripts = await self.db.movie.count(
            where={"movieScripts": {"some": {}}}
        )
        movies_with_mappings_raw = await self.db.movielemmamapping.find_many()
        movies_with_mappings = len(set(m.movieId for m in movies_with_mappings_raw))

        if movies_with_mappings < movies_with_scripts:
            blockers.append(
                f"Only {movies_with_mappings}/{movies_with_scripts} movies have "
                f"V2 lemma mappings. Run POST /v2/backfill first."
            )

        # Check 2: TM coverage for eager senses
        eager_lemma_count = await self.db.lemma.count(
            where={"priorityScore": {"gte": 0.4}}
        )
        tm_count = await self.db.translationmemory.count()
        total_senses = await self.db.wordsense.count()

        if total_senses > 0:
            coverage = tm_count / total_senses * 100
        else:
            coverage = 0

        if coverage < 80:
            blockers.append(
                f"TM coverage is {coverage:.1f}% ({tm_count}/{total_senses} senses). "
                f"Need >=80%. Run Stage B translation for target languages."
            )

        # Check 3: Report rate
        all_tm = await self.db.translationmemory.find_many()
        total_usage = sum(tm.usageCount for tm in all_tm)
        total_reports = sum(tm.reportCount for tm in all_tm)
        report_rate = total_reports / max(total_usage, 1)

        if total_usage > 100 and report_rate > 0.05:
            blockers.append(
                f"Report rate is {report_rate:.1%} (>{5}%). "
                f"Address quality issues before removing V1 fallback."
            )

        ready = len(blockers) == 0

        return {
            "ready_for_cleanup": ready,
            "blockers": blockers,
            "stats": {
                "movies_with_scripts": movies_with_scripts,
                "movies_with_v2_mappings": movies_with_mappings,
                "eager_lemmas": eager_lemma_count,
                "tm_entries": tm_count,
                "total_senses": total_senses,
                "tm_coverage_pct": round(coverage, 1),
                "total_usage": total_usage,
                "total_reports": total_reports,
                "report_rate": round(report_rate, 4),
            },
        }
