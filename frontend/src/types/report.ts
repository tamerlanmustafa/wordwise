export type ReportReason =
  | 'WRONG_TRANSLATION'
  | 'WRONG_CONTEXT'
  | 'WRONG_SPELLING'
  | 'INAPPROPRIATE_CONTENT'
  | 'OTHER';

export type ReportStatus = 'PENDING' | 'REVIEWED' | 'RESOLVED' | 'DISMISSED';

export interface WordReport {
  id: number;
  word: string;
  movie_id?: number;
  movie_title?: string;
  reason: ReportReason;
  details?: string;
  status: ReportStatus;
  reporter_id: number;
  reporter_email?: string;
  reviewer_id?: number;
  reviewer_email?: string;
  review_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ReportStats {
  pending: number;
  reviewed: number;
  resolved: number;
  dismissed: number;
  total: number;
}

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  WRONG_TRANSLATION: 'Wrong translation',
  WRONG_CONTEXT: "Doesn't match context",
  WRONG_SPELLING: 'Wrong spelling',
  INAPPROPRIATE_CONTENT: 'Inappropriate content',
  OTHER: 'Other issue',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  PENDING: 'Pending',
  REVIEWED: 'Reviewed',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};
