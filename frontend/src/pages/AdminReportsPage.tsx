import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tabs,
  Tab,
  CircularProgress,
  Alert,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  CheckCircle,
  Cancel,
  Visibility,
  Delete,
  Refresh,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { getReports, updateReport, deleteReport, getReportStats } from '../services/api';
import type { WordReport, ReportStatus, ReportStats } from '../types/report';
import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS } from '../types/report';

const STATUS_COLORS: Record<ReportStatus, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  PENDING: 'warning',
  REVIEWED: 'info',
  RESOLVED: 'success',
  DISMISSED: 'default',
};

export default function AdminReportsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [reports, setReports] = useState<WordReport[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [selectedReport, setSelectedReport] = useState<WordReport | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [newStatus, setNewStatus] = useState<ReportStatus>('REVIEWED');

  const statusFilters: (ReportStatus | 'all')[] = ['all', 'PENDING', 'REVIEWED', 'RESOLVED', 'DISMISSED'];

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusFilter = tabValue === 0 ? undefined : statusFilters[tabValue];
      const [reportsData, statsData] = await Promise.all([
        getReports(statusFilter === 'all' ? undefined : statusFilter),
        getReportStats(),
      ]);
      setReports(reportsData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reports');
    } finally {
      setLoading(false);
    }
  }, [tabValue]);

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [isAdmin, fetchData]);

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleOpenDetails = (report: WordReport) => {
    setSelectedReport(report);
    setReviewNotes(report.review_notes || '');
    setNewStatus(report.status === 'PENDING' ? 'REVIEWED' : report.status);
    setDetailsOpen(true);
  };

  const handleCloseDetails = () => {
    setDetailsOpen(false);
    setSelectedReport(null);
    setReviewNotes('');
  };

  const handleUpdateReport = async () => {
    if (!selectedReport) return;

    try {
      await updateReport(selectedReport.id, {
        status: newStatus,
        review_notes: reviewNotes || undefined,
      });
      handleCloseDetails();
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update report');
    }
  };

  const handleQuickResolve = async (reportId: number) => {
    try {
      await updateReport(reportId, { status: 'RESOLVED' });
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve report');
    }
  };

  const handleQuickDismiss = async (reportId: number) => {
    try {
      await updateReport(reportId, { status: 'DISMISSED' });
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss report');
    }
  };

  const handleDelete = async (reportId: number) => {
    if (!confirm('Are you sure you want to delete this report?')) return;

    try {
      await deleteReport(reportId);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete report');
    }
  };

  // Redirect non-admins
  if (!authLoading && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (authLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Word Reports
        </Typography>
        <Tooltip title="Refresh">
          <IconButton onClick={fetchData} disabled={loading}>
            <Refresh />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Stats */}
      {stats && (
        <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
          <Paper sx={{ px: 3, py: 2, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold" color="warning.main">
              {stats.pending}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Pending
            </Typography>
          </Paper>
          <Paper sx={{ px: 3, py: 2, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold" color="info.main">
              {stats.reviewed}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Reviewed
            </Typography>
          </Paper>
          <Paper sx={{ px: 3, py: 2, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold" color="success.main">
              {stats.resolved}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Resolved
            </Typography>
          </Paper>
          <Paper sx={{ px: 3, py: 2, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold">
              {stats.total}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total
            </Typography>
          </Paper>
        </Stack>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Tabs */}
      <Paper sx={{ mb: 2 }}>
        <Tabs value={tabValue} onChange={handleTabChange}>
          <Tab label={`All (${stats?.total || 0})`} />
          <Tab label={`Pending (${stats?.pending || 0})`} />
          <Tab label={`Reviewed (${stats?.reviewed || 0})`} />
          <Tab label={`Resolved (${stats?.resolved || 0})`} />
          <Tab label={`Dismissed (${stats?.dismissed || 0})`} />
        </Tabs>
      </Paper>

      {/* Reports Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Word</TableCell>
              <TableCell>Movie</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Reporter</TableCell>
              <TableCell>Date</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <CircularProgress />
                </TableCell>
              </TableRow>
            ) : reports.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No reports found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              reports.map((report) => (
                <TableRow key={report.id} hover>
                  <TableCell>
                    <Typography fontWeight="500">{report.word}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {report.movie_title || 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={REPORT_REASON_LABELS[report.reason]}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={REPORT_STATUS_LABELS[report.status]}
                      size="small"
                      color={STATUS_COLORS[report.status]}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{report.reporter_email}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(report.created_at).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="View Details">
                      <IconButton size="small" onClick={() => handleOpenDetails(report)}>
                        <Visibility fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {report.status === 'PENDING' && (
                      <>
                        <Tooltip title="Resolve">
                          <IconButton
                            size="small"
                            color="success"
                            onClick={() => handleQuickResolve(report.id)}
                          >
                            <CheckCircle fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Dismiss">
                          <IconButton
                            size="small"
                            color="default"
                            onClick={() => handleQuickDismiss(report.id)}
                          >
                            <Cancel fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDelete(report.id)}
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Details Dialog */}
      <Dialog open={detailsOpen} onClose={handleCloseDetails} maxWidth="sm" fullWidth>
        <DialogTitle>Report Details</DialogTitle>
        <DialogContent dividers>
          {selectedReport && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Word
                </Typography>
                <Typography variant="h6">{selectedReport.word}</Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Movie
                </Typography>
                <Typography>{selectedReport.movie_title || 'N/A'}</Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Reason
                </Typography>
                <Chip label={REPORT_REASON_LABELS[selectedReport.reason]} />
              </Box>

              {selectedReport.details && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Reporter's Details
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                    <Typography>{selectedReport.details}</Typography>
                  </Paper>
                </Box>
              )}

              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Reported By
                </Typography>
                <Typography>{selectedReport.reporter_email}</Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Reported At
                </Typography>
                <Typography>
                  {new Date(selectedReport.created_at).toLocaleString()}
                </Typography>
              </Box>

              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={newStatus}
                  label="Status"
                  onChange={(e) => setNewStatus(e.target.value as ReportStatus)}
                >
                  <MenuItem value="PENDING">Pending</MenuItem>
                  <MenuItem value="REVIEWED">Reviewed</MenuItem>
                  <MenuItem value="RESOLVED">Resolved</MenuItem>
                  <MenuItem value="DISMISSED">Dismissed</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label="Review Notes"
                multiline
                rows={3}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add notes about this report..."
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDetails}>Cancel</Button>
          <Button variant="contained" onClick={handleUpdateReport}>
            Update Report
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
