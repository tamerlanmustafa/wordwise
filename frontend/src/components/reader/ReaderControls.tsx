import { memo } from 'react';
import { Box, IconButton, Typography, Slider, Tooltip } from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

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
    if (currentPage > 1) onPageChange(currentPage - 1);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  };

  const handleSliderChange = (_: Event, value: number | number[]) => {
    onPageChange(value as number);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 0.75,
        bgcolor: 'background.paper',
        borderRadius: 1.5,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
      }}
    >
      {/* Font Size */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title="Smaller text">
          <span>
            <IconButton
              size="small"
              onClick={() => fontSize > 50 && onFontSizeChange(fontSize - 10)}
              disabled={disabled || fontSize <= 50}
              sx={{ p: 0.5 }}
            >
              <RemoveIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{
            minWidth: 32,
            textAlign: 'center',
            color: 'text.secondary',
            fontWeight: 500
          }}
        >
          {fontSize}%
        </Typography>
        <Tooltip title="Larger text">
          <span>
            <IconButton
              size="small"
              onClick={() => fontSize < 200 && onFontSizeChange(fontSize + 10)}
              disabled={disabled || fontSize >= 200}
              sx={{ p: 0.5 }}
            >
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Divider */}
      <Box sx={{ width: 1, height: 20, bgcolor: 'divider' }} />

      {/* Navigation */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
        <IconButton
          onClick={handlePrevPage}
          disabled={disabled || currentPage <= 1}
          size="small"
        >
          <NavigateBeforeIcon />
        </IconButton>

        <Slider
          value={currentPage}
          min={1}
          max={totalPages || 1}
          onChange={handleSliderChange}
          disabled={disabled || totalPages <= 1}
          size="small"
          sx={{
            flex: 1,
            mx: 1,
            '& .MuiSlider-thumb': {
              width: 14,
              height: 14
            }
          }}
        />

        <IconButton
          onClick={handleNextPage}
          disabled={disabled || currentPage >= totalPages}
          size="small"
        >
          <NavigateNextIcon />
        </IconButton>

        <Typography
          variant="body2"
          sx={{
            minWidth: 80,
            textAlign: 'right',
            color: 'text.secondary',
            fontSize: '0.8rem'
          }}
        >
          {currentPage} / {totalPages || '–'}
        </Typography>
      </Box>
    </Box>
  );
}

export default memo(ReaderControlsBase);
