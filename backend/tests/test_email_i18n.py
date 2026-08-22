"""Localized transactional email (#98).

Two failure modes are worth a test here, and both are silent in production:

  • A locale drifts from English — a missing key renders a blank line in a
    stranger's inbox, and a stray/renamed `{placeholder}` raises KeyError
    inside a BackgroundTask, i.e. an email that is simply never sent and never
    logged as a failure.
  • The language a user is actually in never reaches the builder, so everyone
    gets English regardless of what they picked.

No DB and no network: the builders are pure and `send_email` is a no-op with
no RESEND_API_KEY.
"""
from __future__ import annotations

import string

import pytest

from src.services.email_i18n import EMAIL_COPY, email_copy
from src.services.email_service import (
    build_password_reset_email,
    build_welcome_email,
    build_worker_alert_email,
)
from src.utils.ui_languages import UI_LANGUAGE_CODES, normalize_ui_language

TRANSLATIONS = [c for c in UI_LANGUAGE_CODES if c != "en"]


def _placeholders(s: str) -> set[str]:
    """`{username}` etc. in a format string, ignoring literal text."""
    return {name for _, name, _, _ in string.Formatter().parse(s) if name}


class TestCopyParity:
    def test_every_shipped_locale_has_a_copy_block(self):
        # The app offers a language picker; the server decides email language.
        # A locale the picker offers but this dict lacks is a user in a Turkish
        # app receiving English mail.
        assert set(EMAIL_COPY) == set(UI_LANGUAGE_CODES)

    @pytest.mark.parametrize("code", TRANSLATIONS)
    def test_locale_has_the_same_keys_as_english(self, code):
        assert set(EMAIL_COPY[code]) == set(EMAIL_COPY["en"])

    @pytest.mark.parametrize("code", TRANSLATIONS)
    def test_placeholders_survive_translation(self, code):
        # A translator writing "{usuario}" or dropping "{app}" turns a send into
        # a KeyError swallowed by the BackgroundTask.
        for key, english in EMAIL_COPY["en"].items():
            assert _placeholders(EMAIL_COPY[code][key]) == _placeholders(english), key

    @pytest.mark.parametrize("code", TRANSLATIONS)
    def test_translation_is_not_just_the_english_string(self, code):
        # Subjects are the one line every recipient sees before opening.
        assert EMAIL_COPY[code]["welcome.subject"] != EMAIL_COPY["en"]["welcome.subject"]
        assert EMAIL_COPY[code]["reset.subject"] != EMAIL_COPY["en"]["reset.subject"]


class TestFallback:
    def test_missing_key_falls_back_to_english(self, monkeypatch):
        # Key-by-key, like i18next's fallbackLng — a half-translated locale
        # renders English sentences, never blanks.
        monkeypatch.setitem(EMAIL_COPY, "es", {"welcome.subject": "Hola"})
        copy = email_copy("es")
        assert copy["welcome.subject"] == "Hola"
        assert copy["reset.button"] == EMAIL_COPY["en"]["reset.button"]

    @pytest.mark.parametrize("value", [None, "", "xx", "klingon", "de"])
    def test_unknown_language_renders_english(self, value):
        assert email_copy(value)["welcome.subject"] == EMAIL_COPY["en"]["welcome.subject"]

    def test_region_tags_resolve_to_the_base_locale(self):
        # A client may send what the platform gave it: 'pt-BR', 'RU', 'es_419'.
        assert normalize_ui_language("pt-BR") == "pt"
        assert normalize_ui_language("RU") == "ru"
        assert normalize_ui_language("es_419") == "es"
        assert normalize_ui_language("zh-Hans") is None


class TestBuilders:
    @pytest.mark.parametrize("code", UI_LANGUAGE_CODES)
    def test_welcome_renders_in_every_locale(self, code):
        subject, html, text = build_welcome_email("cinephile42", code)
        assert subject == EMAIL_COPY[code]["welcome.subject"]
        assert "cinephile42" in html and "cinephile42" in text
        # No unresolved placeholder reached the recipient.
        assert "{" not in text
        assert EMAIL_COPY[code]["layout.footer"] in html

    @pytest.mark.parametrize("code", UI_LANGUAGE_CODES)
    def test_reset_renders_in_every_locale(self, code):
        url = "https://api.getwordwise.us/auth/reset-password?token=abc"
        subject, html, text = build_password_reset_email("cinephile42", url, code)
        assert subject == EMAIL_COPY[code]["reset.subject"]
        assert url in html and url in text
        assert "{" not in text

    def test_no_language_argument_is_english(self):
        assert build_welcome_email("a")[0] == EMAIL_COPY["en"]["welcome.subject"]
        assert build_password_reset_email("a", "u")[0] == EMAIL_COPY["en"]["reset.subject"]

    def test_product_name_is_bold_in_html_and_plain_in_text(self):
        # One sentence, two bodies — `{app}` carries the markup so no locale
        # has to repeat a <strong> tag.
        _, html, text = build_welcome_email("a", "en")
        assert "<strong>WordWise</strong>" in html
        assert "<strong>" not in text

    def test_username_is_html_escaped(self):
        # The only user-controlled string in the markup. A '<' in a display
        # name would otherwise break the layout out of its card.
        _, html, text = build_welcome_email("<script>x</script>", "en")
        assert "<script>" not in html
        assert "&lt;script&gt;" in html
        assert "<script>" in text  # plain-text body needs no escaping

    def test_ops_alert_stays_english(self):
        # Admin mail is deliberately not localized; it must still render a
        # footer now that the layout takes one.
        subject, html, _ = build_worker_alert_email("sentence-worker", "stuck", "3 failures")
        assert subject.startswith("[WordWise ops]")
        assert "{footer}" not in html
        assert "You're receiving this because" in html
