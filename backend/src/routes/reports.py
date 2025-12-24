from fastapi import APIRouter, Depends, HTTPException, status, Query
from prisma import Prisma
from prisma.enums import reportstatus
from typing import List, Optional
from ..database import get_db
from ..middleware.auth import get_current_active_user, get_admin_user
from ..schemas.report import ReportCreate, ReportUpdate, ReportResponse, ReportStats

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.post("/", response_model=dict)
async def create_report(
    report: ReportCreate,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """Submit a word report"""
    created = await db.wordreport.create(
        data={
            "word": report.word,
            "movieId": report.movie_id,
            "movieTitle": report.movie_title,
            "reason": report.reason,
            "details": report.details,
            "reporterId": current_user.id,
        }
    )
    return {"success": True, "report_id": created.id}


@router.get("/admin", response_model=List[ReportResponse])
async def get_all_reports(
    status_filter: Optional[reportstatus] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db)
):
    """Get all reports (admin only)"""
    where = {}
    if status_filter:
        where["status"] = status_filter

    reports = await db.wordreport.find_many(
        where=where,
        include={"reporter": True, "reviewer": True},
        order={"createdAt": "desc"},
        take=limit,
        skip=offset
    )

    return [ReportResponse.from_prisma(r) for r in reports]


@router.patch("/admin/{report_id}", response_model=dict)
async def update_report(
    report_id: int,
    update: ReportUpdate,
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db)
):
    """Update report status (admin only)"""
    # Check if report exists
    existing = await db.wordreport.find_unique(where={"id": report_id})
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )

    updated = await db.wordreport.update(
        where={"id": report_id},
        data={
            "status": update.status,
            "reviewNotes": update.review_notes,
            "reviewerId": admin_user.id,
        }
    )
    return {"success": True, "report_id": updated.id, "status": updated.status}


@router.get("/admin/stats", response_model=ReportStats)
async def get_report_stats(
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db)
):
    """Get report statistics (admin only)"""
    pending = await db.wordreport.count(where={"status": reportstatus.PENDING})
    reviewed = await db.wordreport.count(where={"status": reportstatus.REVIEWED})
    resolved = await db.wordreport.count(where={"status": reportstatus.RESOLVED})
    dismissed = await db.wordreport.count(where={"status": reportstatus.DISMISSED})

    return ReportStats(
        pending=pending,
        reviewed=reviewed,
        resolved=resolved,
        dismissed=dismissed,
        total=pending + reviewed + resolved + dismissed
    )


@router.delete("/admin/{report_id}", response_model=dict)
async def delete_report(
    report_id: int,
    admin_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db)
):
    """Delete a report (admin only)"""
    existing = await db.wordreport.find_unique(where={"id": report_id})
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )

    await db.wordreport.delete(where={"id": report_id})
    return {"success": True, "deleted_id": report_id}
