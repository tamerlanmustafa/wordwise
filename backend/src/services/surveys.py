"""Self-reported survey answers (issue #108) — the catalogue and its validation.

WordWise infers everything else from behaviour (SRS outcomes, quiz latency,
word taps). This is the first thing a user *tells* us, and the point of it is
to join those answers against behavioural cohorts later, so the answers have to
survive as stable machine keys rather than as display copy.

Three properties do the work here:

* **Enums, not free text.** `answer_key` is validated against a fixed set, so
  the research dataset can never accumulate a name, an email or anything else a
  free-text box invites (LEARNING_DATA_PLAN.md §5 — free text is the first
  thing the anonymisation pipeline would have to strip).
* **Versioned per survey.** The catalogue is keyed by `survey_key` → version →
  question, and a submission states which version it was answering. Wording and
  options can change without corrupting the analysis, and an old build that
  still renders v1 keeps submitting valid v1 rows after the server has learned
  v2. That is the whole reason the version is client-supplied and validated
  rather than stamped server-side.
* **"Skipped" is an answer.** `SKIPPED` is accepted for any question, so the
  three states an analyst cares about are distinguishable: no rows at all means
  the survey was never shown, a `skipped` row means it was shown and declined,
  and anything else is a real answer.

`survey_definitions.json` sits beside this module rather than inline because
the mobile client has to render the *same* keys and cannot import Python. It is
the single source both sides are checked against — see
`apps/mobile/src/components/onboarding/__tests__/survey.test.ts`, which reads
this very file off disk and fails if the TypeScript catalogue drifts from it.
Without that guard the drift is silent: the client posts an option the server
has never heard of, the server 422s, and the submission is dropped by a
fire-and-forget caller that has nowhere to report it.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Mapping, Sequence

_DEFINITIONS_PATH = Path(__file__).with_name("survey_definitions.json")

#: Accepted for any question, in any survey. See the module docstring.
SKIPPED = "skipped"

#: Upper bound on responses in one request. The unique index already caps how
#: many rows a user can ever own, but the body is parsed before the database is
#: touched, so the cap belongs on the request too.
MAX_RESPONSES = 16


class SurveyValidationError(ValueError):
    """A submission named a survey, version, question or answer we don't define."""


@lru_cache(maxsize=1)
def _catalogue() -> Mapping[str, Mapping[int, Mapping[str, frozenset[str]]]]:
    """Parse the JSON once per process into `{survey: {version: {question: answers}}}`.

    JSON object keys are strings, so the version is cast back to `int` here —
    the wire and the database both carry it as a number.
    """
    raw = json.loads(_DEFINITIONS_PATH.read_text(encoding="utf-8"))
    return {
        survey: {
            int(version): {question: frozenset(answers) for question, answers in questions.items()}
            for version, questions in versions.items()
        }
        for survey, versions in raw.items()
    }


def question_keys(survey_key: str, version: int) -> tuple[str, ...]:
    """Questions defined for one survey version, in catalogue order."""
    versions = _catalogue().get(survey_key)
    if versions is None or version not in versions:
        return ()
    return tuple(versions[version].keys())


def latest_version(survey_key: str) -> int | None:
    """Highest version defined for a survey, or None if the survey is unknown."""
    versions = _catalogue().get(survey_key)
    return max(versions) if versions else None


def validate_submission(
    survey_key: str,
    version: int,
    responses: Sequence[tuple[str, str]] | Iterable[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Check one submission and return its `(question_key, answer_key)` pairs.

    Raises `SurveyValidationError` with a message safe to hand back to the
    client — every failure names a key the client sent, never anything from the
    database.
    """
    versions = _catalogue().get(survey_key)
    if versions is None:
        raise SurveyValidationError(f"Unknown survey: {survey_key!r}")
    questions = versions.get(version)
    if questions is None:
        raise SurveyValidationError(f"Unknown version {version} for survey {survey_key!r}")

    pairs = list(responses)
    if not pairs:
        raise SurveyValidationError("At least one response is required")
    if len(pairs) > MAX_RESPONSES:
        raise SurveyValidationError(f"At most {MAX_RESPONSES} responses per submission")

    seen: set[str] = set()
    for question_key, answer_key in pairs:
        allowed = questions.get(question_key)
        if allowed is None:
            raise SurveyValidationError(
                f"Unknown question {question_key!r} for survey {survey_key!r} v{version}"
            )
        if question_key in seen:
            raise SurveyValidationError(f"Duplicate answer for question {question_key!r}")
        seen.add(question_key)
        if answer_key != SKIPPED and answer_key not in allowed:
            raise SurveyValidationError(
                f"Unknown answer {answer_key!r} for question {question_key!r}"
            )

    return pairs
