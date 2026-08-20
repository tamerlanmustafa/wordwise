"""
Which provider a target language is routed to, and how Google is configured.

Two changes are pinned here:

  1. DEEPL_SUPPORTED_TARGET_LANGS is a routing table that goes stale whenever
     DeepL ships languages. It was written "as of 2025" and had missed
     Vietnamese, Thai and Hebrew — three large English-learning markets that
     were silently being routed to a Google fallback which is not even
     configured, so those users got no translation at all.

  2. The Google client used to accept credentials ONLY as a filesystem path.
     Railway has nowhere durable to put a key file and baking one into the
     image would commit a secret, so the fallback could never actually be
     turned on in prod. It now also reads the key inline from an env var.
"""
from __future__ import annotations

import json

import pytest

from src.services.translation_service import DEEPL_SUPPORTED_TARGET_LANGS
from src.utils.google_translate_client import GoogleTranslateClient, GoogleTranslateError


class TestDeepLLanguageRouting:
    @pytest.mark.parametrize("code", ["VI", "TH", "HE"])
    def test_languages_deepl_added_are_routed_to_deepl(self, code):
        assert code in DEEPL_SUPPORTED_TARGET_LANGS

    @pytest.mark.parametrize("code", ["KO", "AR", "ID", "HI", "UK"])
    def test_high_demand_markets_stay_on_deepl(self, code):
        # These were already correct; the parametrize guards against someone
        # "tidying" the set and dropping a market.
        assert code in DEEPL_SUPPORTED_TARGET_LANGS

    def test_azerbaijani_is_not_claimed(self):
        # AZ has never been a DeepL language. Listing it would route AZ users
        # to DeepL, which raises, instead of straight to the Google fallback.
        assert "AZ" not in DEEPL_SUPPORTED_TARGET_LANGS

    def test_codes_are_upper_case(self):
        # get_translation looks up `target_lang.upper()`, so a lower-case entry
        # here would be dead weight that silently routes its language away.
        assert all(c == c.upper() for c in DEEPL_SUPPORTED_TARGET_LANGS)


class TestGoogleCredentialSources:
    def test_inline_json_is_read_from_the_environment(self, monkeypatch):
        monkeypatch.setenv("GOOGLE_TRANSLATE_ENABLED", "true")
        monkeypatch.setenv("GOOGLE_CREDENTIALS_JSON", json.dumps({"project_id": "wordwise"}))
        monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)

        client = GoogleTranslateClient()

        assert client.enabled
        assert client.credentials_json is not None

    def test_malformed_json_says_what_to_fix(self, monkeypatch):
        # The realistic failure: a key pasted into a dashboard field loses its
        # newlines or gains quotes. The error has to name the variable, not
        # surface "Expecting value: line 1 column 1".
        monkeypatch.setenv("GOOGLE_TRANSLATE_ENABLED", "true")
        monkeypatch.setenv("GOOGLE_CREDENTIALS_JSON", "{not json")
        GoogleTranslateClient._init_warning_logged = False

        client = GoogleTranslateClient()
        with pytest.raises(GoogleTranslateError) as exc:
            client._get_client()

        assert "GOOGLE_CREDENTIALS_JSON" in str(exc.value)

    def test_no_credentials_names_both_options(self, monkeypatch):
        monkeypatch.setenv("GOOGLE_TRANSLATE_ENABLED", "true")
        monkeypatch.delenv("GOOGLE_CREDENTIALS_JSON", raising=False)
        monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
        GoogleTranslateClient._init_warning_logged = False

        client = GoogleTranslateClient()
        with pytest.raises(GoogleTranslateError) as exc:
            client._get_client()

        message = str(exc.value)
        assert "GOOGLE_CREDENTIALS_JSON" in message
        assert "GOOGLE_APPLICATION_CREDENTIALS" in message

    def test_a_config_error_is_reported_even_without_the_sdk_installed(self, monkeypatch):
        """
        Credential checks must not sit behind the `google.cloud` import.

        They used to: `_get_client` imported the SDK first, so an operator who
        had misconfigured the env was told "google-cloud-translate package not
        installed" — true on that box, but not the thing they had to fix. It
        also made these tests unrunnable anywhere the SDK is absent, which is
        every CI run (requirements-dev.txt deliberately stays lean), so CI sat
        red. Simulated here by making the import fail even when it's present.
        """
        import builtins

        real_import = builtins.__import__

        def no_sdk(name, *args, **kwargs):
            if name.startswith("google.cloud"):
                raise ImportError("No module named 'google.cloud'")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", no_sdk)
        monkeypatch.setenv("GOOGLE_TRANSLATE_ENABLED", "true")
        monkeypatch.delenv("GOOGLE_CREDENTIALS_JSON", raising=False)
        monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
        GoogleTranslateClient._init_warning_logged = False

        with pytest.raises(GoogleTranslateError) as exc:
            GoogleTranslateClient()._get_client()

        assert "GOOGLE_CREDENTIALS_JSON" in str(exc.value)

    def test_a_missing_sdk_is_still_reported_when_the_config_is_fine(self, monkeypatch):
        """The SDK error must survive — it's the right answer once env is OK."""
        import builtins

        real_import = builtins.__import__

        def no_sdk(name, *args, **kwargs):
            if name.startswith("google.cloud"):
                raise ImportError("No module named 'google.cloud'")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", no_sdk)
        monkeypatch.setenv("GOOGLE_TRANSLATE_ENABLED", "true")
        monkeypatch.delenv("GOOGLE_CREDENTIALS_JSON", raising=False)
        monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", __file__)  # exists
        GoogleTranslateClient._init_warning_logged = False

        with pytest.raises(GoogleTranslateError) as exc:
            GoogleTranslateClient()._get_client()

        assert "not installed" in str(exc.value)

    def test_disabled_by_default(self, monkeypatch):
        # The fallback must stay off unless explicitly enabled — an accidental
        # enable with no key turns every DeepL miss into a slower failure.
        monkeypatch.delenv("GOOGLE_TRANSLATE_ENABLED", raising=False)
        assert GoogleTranslateClient().enabled is False
