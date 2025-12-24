from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from prisma.enums import reportreason, reportstatus


class ReportCreate(BaseModel):
    word: str
    movie_id: Optional[int] = None
    movie_title: Optional[str] = None
    reason: reportreason
    details: Optional[str] = None


class ReportUpdate(BaseModel):
    status: reportstatus
    review_notes: Optional[str] = None


class ReportResponse(BaseModel):
    id: int
    word: str
    movie_id: Optional[int] = None
    movie_title: Optional[str] = None
    reason: reportreason
    details: Optional[str] = None
    status: reportstatus
    reporter_id: int
    reporter_email: Optional[str] = None
    reviewer_id: Optional[int] = None
    reviewer_email: Optional[str] = None
    review_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def from_prisma(cls, report, include_relations=True):
        """Convert Prisma WordReport to ReportResponse"""
        data = {
            'id': report.id,
            'word': report.word,
            'movie_id': report.movieId,
            'movie_title': report.movieTitle,
            'reason': report.reason,
            'details': report.details,
            'status': report.status,
            'reporter_id': report.reporterId,
            'reviewer_id': report.reviewerId,
            'review_notes': report.reviewNotes,
            'created_at': report.createdAt,
            'updated_at': report.updatedAt,
        }

        if include_relations:
            data['reporter_email'] = report.reporter.email if report.reporter else None
            data['reviewer_email'] = report.reviewer.email if report.reviewer else None

        return cls(**data)


class ReportStats(BaseModel):
    pending: int
    reviewed: int
    resolved: int
    dismissed: int
    total: int
