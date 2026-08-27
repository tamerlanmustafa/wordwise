"""Self-reported survey answers (issue #108).

One endpoint: the client posts the answers it collected for a survey version,
and the rows land on `user_survey_responses` for later cohort joins. The
catalogue and every validation rule live in `services/surveys.py`.

Two decisions worth knowing before editing this:

* **Idempotent by constraint, not by check.** The table has a unique index on
  `(user_id, survey_key, survey_version, question_key)` and the insert is
  `skip_duplicates=True` (`ON CONFLICT DO NOTHING`). A retried submission — a
  flaky network on the onboarding screen, a reinstall that reruns onboarding —
  is a no-op instead of a second row, so `GROUP BY answer_key` counts users
  rather than attempts. First answer wins on purpose: what the user told us the
  first time is the cleaner research fact.
* **One round trip.** `create_many` sends all four rows in a single statement.
  A per-answer `upsert` loop would be four round trips on a path that already
  runs while a first-run user is waiting (see CLAUDE.md's round-trip note).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..services.surveys import MAX_RESPONSES, SurveyValidationError, validate_submission
from ..utils.rate_limit import rate_limit

router = APIRouter(prefix="/user/surveys", tags=["surveys"])

# The unique index bounds how many rows a user can ever own, so this exists to
# bound the *writes*, not the data: without it a loop could re-post a settled
# survey forever and buy a `ON CONFLICT DO NOTHING` round trip every time.
_submit_throttle = rate_limit(20, 60.0, scope="survey-submit")


class SurveyAnswer(BaseModel):
    question_key: str = Field(max_length=40)
    answer_key: str = Field(max_length=40)


class SubmitSurveyRequest(BaseModel):
    """`version` is what the *client* was rendering, not what the server thinks
    is current — an old build answering v1 after v2 ships is valid data, and
    mislabelling it as v2 is the one thing that would corrupt the analysis."""

    version: int = Field(ge=1)
    responses: list[SurveyAnswer] = Field(min_length=1, max_length=MAX_RESPONSES)


@router.post("/{survey_key}", status_code=status.HTTP_201_CREATED)
async def submit_survey(
    survey_key: str,
    request: SubmitSurveyRequest,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
    _: None = Depends(_submit_throttle),
):
    try:
        pairs = validate_submission(
            survey_key,
            request.version,
            [(r.question_key, r.answer_key) for r in request.responses],
        )
    except SurveyValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    await db.usersurveyresponse.create_many(
        data=[
            {
                "userId": current_user.id,
                "surveyKey": survey_key,
                "surveyVersion": request.version,
                "questionKey": question_key,
                "answerKey": answer_key,
            }
            for question_key, answer_key in pairs
        ],
        skip_duplicates=True,
    )

    return {"ok": True, "stored": len(pairs)}
