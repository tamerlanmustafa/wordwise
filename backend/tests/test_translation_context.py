"""
Unit tests for context-biased word translation.

When a user taps a word on a movie card, the word is translated on its own
but shown next to a full-sentence translation. Without context the isolated
word can resolve to a different sense than the one used in the sentence
("run" → "correr" vs. "dirigen" inside "They run a business"), which reads as
a mismatch. Passing the sentence as a DeepL `context` hint fixes the sense.

Because that result is specific to its sentence — and the shared
TranslationCache is keyed by the word alone — a context-biased translation
must never read from or write to that cache, or it would poison plain-word
lookups. These tests pin both behaviours with fakes: no DB, no network.
"""
from types import SimpleNamespace

from src.services.translation_service import TranslationService


class _RecordingDeepL:
    """Fake DeepL client that records the context it was called with."""

    def __init__(self, translated="dirigir"):
        self.translated = translated
        self.calls = []

    async def translate(self, text, target_lang, source_lang="auto", context=None):
        self.calls.append({"text": text, "context": context})
        return {"translated": self.translated, "detected_source_lang": "EN"}


class _ExplodingCache:
    """Any cache access is a test failure — context mode must not touch it."""

    async def find_first(self, *args, **kwargs):
        raise AssertionError("context-mode translation read the word cache")

    async def upsert(self, *args, **kwargs):
        raise AssertionError("context-mode translation wrote the word cache")


def _service(deepl):
    # google_client unused (ES is DeepL-supported); db exposes only the cache
    # namespace, which must stay untouched in context mode.
    db = SimpleNamespace(translationcache=_ExplodingCache())
    return TranslationService(db=db, deepl_client=deepl, google_client=object())


async def test_context_is_forwarded_to_deepl():
    deepl = _RecordingDeepL(translated="dirigir")
    service = _service(deepl)

    result = await service.get_translation(
        text="run",
        target_lang="ES",
        context="They run a small business.",
    )

    assert result["translated"] == "dirigir"
    assert result["provider"] == "deepl"
    assert deepl.calls == [{"text": "run", "context": "They run a small business."}]


async def test_context_mode_bypasses_word_cache():
    # _ExplodingCache raises on any read/write; reaching DeepL without an
    # AssertionError proves the cache was skipped on both sides.
    deepl = _RecordingDeepL()
    service = _service(deepl)

    await service.get_translation(text="run", target_lang="ES", context="a b c")

    assert len(deepl.calls) == 1


async def test_blank_context_still_uses_cache():
    # An empty/whitespace context is not a real hint — the normal cached path
    # must remain in force (so we don't turn every plain lookup into a miss).
    deepl = _RecordingDeepL(translated="correr")

    class _Cache:
        def __init__(self):
            self.reads = 0

        async def find_first(self, *args, **kwargs):
            self.reads += 1
            return None  # miss → proceed to provider

        async def upsert(self, *args, **kwargs):
            return None

    cache = _Cache()
    db = SimpleNamespace(translationcache=cache)
    service = TranslationService(db=db, deepl_client=deepl, google_client=object())

    await service.get_translation(text="run", target_lang="ES", context="   ")

    assert cache.reads == 1  # cache was consulted, i.e. not in context mode
    assert deepl.calls[0]["context"] == "   "
