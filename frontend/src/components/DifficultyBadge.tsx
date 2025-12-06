import { Chip, Tooltip, Box, Typography } from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import type { MovieDifficultyResult } from '../utils/computeMovieDifficulty';

interface DifficultyBadgeProps {
  difficulty: MovieDifficultyResult;
  size?: 'small' | 'medium';
  isMock?: boolean;
}

const LEVEL_COLORS: Record<string, string> = {
  A1: '#4caf50',
  A2: '#8bc34a',
  B1: '#ffc107',
  B2: '#ff9800',
  C1: '#f44336',
  C2: '#9c27b0'
};

const LEVEL_LABELS: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper Intermediate',
  C1: 'Advanced',
  C2: 'Proficient'
};

export function DifficultyBadge({ difficulty, size = 'medium', isMock = false }: DifficultyBadgeProps) {
  const color = LEVEL_COLORS[difficulty.level] || '#757575';
  const label = LEVEL_LABELS[difficulty.level] || difficulty.level;

  const tooltipContent = (
    <Box sx={{ p: 1 }}>
      {isMock && (
        <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 'bold', mb: 1, display: 'block' }}>
          ⚠️ MOCK DATA - For UI Testing
        </Typography>
      )}
      <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
        {difficulty.level} - {label}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Difficulty Score: {difficulty.score.toFixed(2)}
      </Typography>
      {Object.keys(difficulty.breakdown).length > 0 && (
        <>
          <Typography variant="body2" fontWeight="medium" sx={{ mt: 1, mb: 0.5 }}>
            Vocabulary Breakdown:
          </Typography>
          {Object.entries(difficulty.breakdown)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([level, percentage]) => (
              <Typography key={level} variant="body2" sx={{ fontSize: '0.75rem' }}>
                {level}: {(percentage * 100).toFixed(1)}%
              </Typography>
            ))}
        </>
      )}
    </Box>
  );

  return (
    <Tooltip title={tooltipContent} arrow placement="top">
      <Box sx={{ width: '100%' }}>
        <Chip
          icon={<SchoolIcon />}
          label={`${difficulty.level} - ${label}`}
          size={size}
          sx={{
            backgroundColor: color,
            color: '#fff',
            fontWeight: 'bold',
            width: '100%',
            display: 'flex',
            justifyContent: 'flex-start',
            borderRadius: 0,
            '& .MuiChip-icon': {
              color: '#fff'
            }
          }}
        />
      </Box>
    </Tooltip>
  );
}
