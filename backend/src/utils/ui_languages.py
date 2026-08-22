"""App-UI locales — the server's mirror of `apps/mobile/src/i18n/languages.ts`.

The interface language is a *user* preference (column `users.language_preference`),
not a per-device one, so the server has to know which locales exist: it picks the
transactional email a signup gets, and it rejects a profile update asking for a
locale we don't ship.

Deliberately duplicated rather than shared — the two runtimes are Python and
TypeScript and nothing sensible spans them. What keeps them honest is a test:
`apps/mobile/src/i18n/__tests__/locales.test.ts` parses this file and fails the
mobile suite (pre-push and CI) if the two lists drift.

NOT the same list as `schemas/user.SUPPORTED_LANGUAGES` (30 inert profile codes)
or the 12 languages we translate *words* into. This is the app chrome only.

Arabic is absent on purpose: it ships as `preview: true` (#104) and is excluded
from language resolution, so no client can send it. Un-gating means adding "ar"
here *and* an "ar" block in `services/email_i18n.py`.
"""
from __future__ import annotations

UI_LANGUAGE_CODES: tuple[str, ...] = ("en", "es", "pt", "tr", "ru")

#: Every locale falls back to this one, key by key — same rule as i18next's
#: `fallbackLng` on the client, so a half-translated email renders English
#: sentences rather than blanks.
FALLBACK_UI_LANGUAGE = "en"


def normalize_ui_language(tag: str | None) -> str | None:
    """Narrow an arbitrary locale tag to one we ship, else ``None``.

    Accepts what a client might plausibly send — ``'ES'``, ``'pt-BR'``,
    ``'ru_RU'`` — and drops the region, because we ship one variant per
    language. Mirrors `normalizeToUiLanguage` in `i18n/languages.ts`.
    """
    if not tag:
        return None
    base = tag.strip().lower().replace("_", "-").split("-")[0]
    return base if base in UI_LANGUAGE_CODES else None
