"""Onboarding welcome survey — catalogue validation + the submit route (#108).

Same strategy as test_app_language.py: call the route function directly against
a fake Prisma surface. No DB, no network.

What these tests are actually protecting: this is the only place in the schema
where the client chooses the *values*, not just the rows. Every other user table
stores words the user typed or ids the server issued. Here a typo in a mobile
constant would write `answer_key = 'rembering'` into a research dataset and
nothing downstream would notice — a GROUP BY would just show two cohorts where
there is one. So the validator is the schema, and it is tested as such.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.routes.surveys import SubmitSurveyRequest, SurveyAnswer, submit_survey
from src.services.surveys import (
    MAX_RESPONSES,
    SKIPPED,
    SurveyValidationError,
    latest_version,
    question_keys,
    validate_submission,
)


class _FakeSurveyTable:
    """Records what `create_many` was handed, and whether dedup was requested."""

    def __init__(self):
        self.calls: list[dict] = []

    async def create_many(self, data, skip_duplicates=False):
        self.calls.append({"data": data, "skip_duplicates": skip_duplicates})
        return len(data)


def _db() -> SimpleNamespace:
    return SimpleNamespace(usersurveyresponse=_FakeSurveyTable())


def _submit(**answers) -> SubmitSurveyRequest:
    return SubmitSurveyRequest(
        version=1,
        responses=[SurveyAnswer(question_key=q, answer_key=a) for q, a in answers.items()],
    )


# --- the catalogue --------------------------------------------------------

def test_welcome_v1_defines_the_four_questions_the_issue_specifies():
    assert question_keys("welcome", 1) == (
        "vocab_pain",
        "subtitle_pain",
        "frustration",
        "motivation",
    )


def test_welcome_survey_is_at_most_four_questions():
    """#108's acceptance criterion — more than four measurably costs completion."""
    assert len(question_keys("welcome", 1)) <= 4


def test_latest_version_is_reported_for_a_known_survey_and_none_otherwise():
    assert latest_version("welcome") == 1
    assert latest_version("nope") is None


def test_unknown_survey_and_unknown_version_are_distinguishable_failures():
    with pytest.raises(SurveyValidationError, match="Unknown survey"):
        validate_submission("pulse", 1, [("vocab_pain", "remembering")])
    with pytest.raises(SurveyValidationError, match="Unknown version"):
        validate_submission("welcome", 99, [("vocab_pain", "remembering")])
    assert question_keys("welcome", 99) == ()


# --- validation -----------------------------------------------------------

def test_valid_answers_pass_through_in_the_order_they_were_sent():
    pairs = validate_submission(
        "welcome",
        1,
        [("frustration", "sometimes"), ("vocab_pain", "context")],
    )
    assert pairs == [("frustration", "sometimes"), ("vocab_pain", "context")]


def test_skipped_is_accepted_for_every_question():
    pairs = validate_submission("welcome", 1, [(q, SKIPPED) for q in question_keys("welcome", 1)])
    assert {a for _, a in pairs} == {SKIPPED}


def test_unknown_question_is_rejected():
    with pytest.raises(SurveyValidationError, match="Unknown question"):
        validate_submission("welcome", 1, [("favourite_colour", "blue")])


def test_unknown_answer_is_rejected():
    """A near-miss, which is what a client-side typo actually looks like."""
    with pytest.raises(SurveyValidationError, match="Unknown answer"):
        validate_submission("welcome", 1, [("vocab_pain", "rembering")])


def test_free_text_masquerading_as_an_answer_is_rejected():
    """The PII guard: no path exists for an arbitrary string to reach the table."""
    with pytest.raises(SurveyValidationError, match="Unknown answer"):
        validate_submission("welcome", 1, [("motivation", "jane@example.com")])


def test_an_answer_from_another_question_is_rejected():
    """Options are scoped per question, not pooled across the survey."""
    with pytest.raises(SurveyValidationError, match="Unknown answer"):
        validate_submission("welcome", 1, [("frustration", "travel")])


def test_duplicate_question_in_one_submission_is_rejected():
    with pytest.raises(SurveyValidationError, match="Duplicate answer"):
        validate_submission(
            "welcome",
            1,
            [("frustration", "rarely"), ("frustration", "never")],
        )


def test_empty_and_oversized_submissions_are_rejected():
    with pytest.raises(SurveyValidationError, match="At least one"):
        validate_submission("welcome", 1, [])
    with pytest.raises(SurveyValidationError, match="At most"):
        validate_submission("welcome", 1, [("vocab_pain", "context")] * (MAX_RESPONSES + 1))


# --- the route ------------------------------------------------------------

@pytest.mark.asyncio
async def test_submit_stores_one_row_per_answer_with_the_version(test_user):
    db = _db()
    result = await submit_survey(
        "welcome",
        _submit(vocab_pain="remembering", frustration="sometimes"),
        current_user=test_user,
        db=db,
        _=None,
    )

    assert result == {"ok": True, "stored": 2}
    (call,) = db.usersurveyresponse.calls
    assert call["data"] == [
        {
            "userId": test_user.id,
            "surveyKey": "welcome",
            "surveyVersion": 1,
            "questionKey": "vocab_pain",
            "answerKey": "remembering",
        },
        {
            "userId": test_user.id,
            "surveyKey": "welcome",
            "surveyVersion": 1,
            "questionKey": "frustration",
            "answerKey": "sometimes",
        },
    ]


@pytest.mark.asyncio
async def test_submit_is_idempotent_by_constraint_not_by_read(test_user):
    """A retried submission must not double-count, and must not cost a SELECT.

    The client posts fire-and-forget from onboarding, so retries are normal.
    Dedup rides the unique index (ON CONFLICT DO NOTHING) rather than a
    read-then-write, which would race two in-flight retries anyway.
    """
    db = _db()
    await submit_survey("welcome", _submit(vocab_pain="context"), current_user=test_user, db=db, _=None)

    (call,) = db.usersurveyresponse.calls
    assert call["skip_duplicates"] is True


@pytest.mark.asyncio
async def test_submit_writes_every_answer_in_one_round_trip(test_user):
    """Four answers, one statement — not one statement per answer."""
    db = _db()
    await submit_survey(
        "welcome",
        _submit(
            vocab_pain="which_words",
            subtitle_pain="too_fast",
            frustration="rarely",
            motivation="films_tv",
        ),
        current_user=test_user,
        db=db,
        _=None,
    )

    assert len(db.usersurveyresponse.calls) == 1
    assert len(db.usersurveyresponse.calls[0]["data"]) == 4


@pytest.mark.asyncio
async def test_submit_records_a_skip_rather_than_writing_nothing(test_user):
    """"Declined" and "never shown" have to stay distinguishable in the data."""
    db = _db()
    await submit_survey(
        "welcome",
        _submit(**{q: SKIPPED for q in question_keys("welcome", 1)}),
        current_user=test_user,
        db=db,
        _=None,
    )

    (call,) = db.usersurveyresponse.calls
    assert [row["answerKey"] for row in call["data"]] == [SKIPPED] * 4


@pytest.mark.asyncio
async def test_submit_rejects_an_invalid_answer_without_touching_the_table(test_user):
    db = _db()
    with pytest.raises(HTTPException) as exc:
        await submit_survey(
            "welcome",
            _submit(vocab_pain="whatever_the_client_felt_like"),
            current_user=test_user,
            db=db,
            _=None,
        )

    assert exc.value.status_code == 422
    assert db.usersurveyresponse.calls == []


@pytest.mark.asyncio
async def test_submit_rejects_an_unknown_survey_key_from_the_path(test_user):
    db = _db()
    with pytest.raises(HTTPException) as exc:
        await submit_survey(
            "../../etc/passwd",
            _submit(vocab_pain="context"),
            current_user=test_user,
            db=db,
            _=None,
        )

    assert exc.value.status_code == 422
    assert db.usersurveyresponse.calls == []
