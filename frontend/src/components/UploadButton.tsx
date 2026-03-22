import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  IconButton,
  CircularProgress,
  LinearProgress,
  Alert,
  Tooltip,
  alpha,
} from '@mui/material';
import { Close, CloudUpload, Description, CheckCircle } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { uploadFile, type FileUploadResponse } from '../services/api';

interface UploadButtonProps {
  variant?: 'hero' | 'compact';
}

const SUPPORTED_EXTENSIONS = ['.srt', '.vtt', '.txt', '.epub', '.pdf'];
const MAX_FILE_SIZE_MB = 10;

export function UploadButton({ variant = 'compact' }: UploadButtonProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<FileUploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state
    setError(null);
    setUploadResult(null);

    // Validate file extension
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      setError(`Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB`);
      return;
    }

    setSelectedFile(file);
    setCustomTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '));
    setDialogOpen(true);

    // Reset input so same file can be selected again
    event.target.value = '';
  }, []);

  const handleClose = useCallback(() => {
    if (isUploading) return;
    setDialogOpen(false);
    setSelectedFile(null);
    setCustomTitle('');
    setError(null);
    setUploadResult(null);
  }, [isUploading]);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);

    try {
      const result = await uploadFile(selectedFile, customTitle.trim() || undefined);
      setUploadResult(result);
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || 'Upload failed';
      setError(message);
    } finally {
      setIsUploading(false);
    }
  }, [selectedFile, customTitle]);

  const handleViewResults = useCallback(() => {
    if (uploadResult) {
      navigate(`/movie/${uploadResult.movie_id}`);
      handleClose();
    }
  }, [uploadResult, navigate, handleClose]);

  const isHero = variant === 'hero';

  return (
    <>
      <Tooltip title="Upload a file (SRT, EPUB, TXT, PDF)" arrow>
        <IconButton
          onClick={handleButtonClick}
          sx={{
            p: isHero ? 1.5 : 1,
            color: isHero ? 'primary.main' : 'text.secondary',
            '&:hover': {
              backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.1),
              color: 'primary.main',
            },
          }}
          aria-label="Upload file for vocabulary analysis"
        >
          <CloudUpload fontSize={isHero ? 'large' : 'medium'} />
        </IconButton>
      </Tooltip>

      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_EXTENSIONS.join(',')}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      <Dialog
        open={dialogOpen}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            bgcolor: 'background.paper',
          },
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pb: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CloudUpload color="primary" />
            <Typography variant="h6" component="span">
              Upload File
            </Typography>
          </Box>
          <IconButton
            onClick={handleClose}
            disabled={isUploading}
            size="small"
            sx={{ color: 'text.secondary' }}
          >
            <Close />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers>
          {/* Success State */}
          {uploadResult && (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <CheckCircle color="success" sx={{ fontSize: 64, mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                Upload Complete!
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                "{uploadResult.title}" has been processed.
              </Typography>
              <Box
                sx={{
                  mt: 2,
                  p: 2,
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  display: 'inline-block',
                }}
              >
                <Typography variant="body2">
                  <strong>{uploadResult.word_count.toLocaleString()}</strong> words analyzed
                </Typography>
                <Typography variant="body2">
                  <strong>{uploadResult.unique_words.toLocaleString()}</strong> unique vocabulary
                </Typography>
              </Box>
            </Box>
          )}

          {/* Upload Form */}
          {!uploadResult && (
            <>
              {/* File Info */}
              {selectedFile && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    p: 2,
                    mb: 2,
                    bgcolor: 'background.default',
                    borderRadius: 1,
                  }}
                >
                  <Description color="primary" sx={{ fontSize: 40 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body1"
                      sx={{
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {selectedFile.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </Typography>
                  </Box>
                </Box>
              )}

              {/* Title Input */}
              <TextField
                fullWidth
                label="Title (optional)"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                disabled={isUploading}
                placeholder="Enter a custom title for this content"
                helperText="Leave blank to use the filename"
                sx={{ mb: 2 }}
              />

              {/* Uploading Progress */}
              {isUploading && (
                <Box sx={{ mb: 2 }}>
                  <LinearProgress sx={{ mb: 1 }} />
                  <Typography variant="body2" color="text.secondary" align="center">
                    Processing file...
                  </Typography>
                </Box>
              )}

              {/* Error */}
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              {/* Supported Formats */}
              <Typography variant="caption" color="text.secondary">
                Supported formats: SRT, VTT, TXT, EPUB, PDF (max {MAX_FILE_SIZE_MB}MB)
              </Typography>
            </>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          {uploadResult ? (
            <>
              <Button onClick={handleClose} color="inherit">
                Close
              </Button>
              <Button
                variant="contained"
                onClick={handleViewResults}
                startIcon={<Description />}
              >
                View Vocabulary
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleClose} disabled={isUploading} color="inherit">
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={handleUpload}
                disabled={!selectedFile || isUploading}
                startIcon={isUploading ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
              >
                {isUploading ? 'Uploading...' : 'Upload & Analyze'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}

export default UploadButton;
