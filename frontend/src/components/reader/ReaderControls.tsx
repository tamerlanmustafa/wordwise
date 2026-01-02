import { memo } from 'react';
import {
  Box,
  IconButton,
  Typography,
  Slider,
  Tooltip,
  Paper
} from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import LastPageIcon from '@mui/icons-material/LastPage';

interface ReaderControlsProps {
  currentPage: number;
  totalPages: number;
  fontSize: number;
  onPageChange: (page: number) => void;
  onFontSizeChange: (size: number) => void;
  disabled?: boolean;
}

function ReaderControlsBase({
  currentPage,
  totalPages,
  fontSize,
  onPageChange,
  onFontSizeChange,
  disabled = false
}: ReaderControlsProps) {
  const handlePrevPage = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const handleFirstPage = () => {
    onPageChange(1);
  };

  const handleLastPage = () => {
    onPageChange(totalPages);
  };

  const handleSliderChange = (_: Event, value: number | number[]) => {
    onPageChange(value as number);
  };

  const handleFontIncrease = () => {
    if (fontSize < 200) {
      onFontSizeChange(fontSize + 10);
    }
  };

  const handleFontDecrease = () => {
    if (fontSize > 50) {
      onFontSizeChange(fontSize - 10);
    }
  };

  return (
    <Paper
      elevation={2}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 1,
        borderRadius: 2
      }}
    >
      {/* Font Size Controls */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title="Decrease font size">
          <span>
            <IconButton
              size="small"
              onClick={handleFontDecrease}
              disabled={disabled || fontSize <= 50}
            >
              <TextDecreaseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'center' }}>
          {fontSize}%
        </Typography>
        <Tooltip title="Increase font size">
          <span>
            <IconButton
              size="small"
              onClick={handleFontIncrease}
              disabled={disabled || fontSize >= 200}
            >
              <TextIncreaseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Divider */}
      <Box sx={{ height: 24, width: 1, bgcolor: 'divider' }} />

      {/* Page Navigation */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
        <Tooltip title="First page">
          <span>
            <IconButton
              size="small"
              onClick={handleFirstPage}
              disabled={disabled || currentPage <= 1}
            >
              <FirstPageIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Previous page">
          <span>
            <IconButton
              onClick={handlePrevPage}
              disabled={disabled || currentPage <= 1}
            >
              <NavigateBeforeIcon />
            </IconButton>
          </span>
        </Tooltip>

        {/* Page Slider */}
        <Box sx={{ flex: 1, mx: 2 }}>
          <Slider
            value={currentPage}
            min={1}
            max={totalPages || 1}
            onChange={handleSliderChange}
            disabled={disabled || totalPages <= 1}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => `Page ${value}`}
            size="small"
          />
        </Box>

        <Tooltip title="Next page">
          <span>
            <IconButton
              onClick={handleNextPage}
              disabled={disabled || currentPage >= totalPages}
            >
              <NavigateNextIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Last page">
          <span>
            <IconButton
              size="small"
              onClick={handleLastPage}
              disabled={disabled || currentPage >= totalPages}
            >
              <LastPageIcon />
            </IconButton>
          </span>
        </Tooltip>

        {/* Page Counter */}
        <Typography
          variant="body2"
          sx={{ minWidth: 100, textAlign: 'right', color: 'text.secondary' }}
        >
          Page {currentPage} of {totalPages}
        </Typography>
      </Box>
    </Paper>
  );
}

export default memo(ReaderControlsBase);
