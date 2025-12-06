/**
 * DifficultyBadge Component
 *
 * Displays a color-coded CEFR difficulty badge with optional tooltip showing
 * the difficulty breakdown.
 */

import { Chip, Tooltip, Box, Typography, LinearProgress, Stack } from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import { getLevelColor, getLevelDescription, type CEFRLevel } from '../utils/computeMovieDifficulty';

export interface DifficultyBadgeProps {
  level: CEFRLevel;
  score?: number;
  breakdown?: Record<CEFRLevel, number>;
  size?: 'small' | 'medium' | 'large';
  showTooltip?: boolean;
  variant?: 'default' | 'outlined' | 'filled';
}

/**
 * DifficultyBadge - Visual indicator of movie difficulty level
 *
 * @example
 * ```tsx
 * <DifficultyBadge
 *   level="B2"
 *   score={3.52}
 *   breakdown={{ A1: 18, A2: 15, B1: 22, B2: 25, C1: 14, C2: 6 }}
 *   showTooltip
 * />
 * ```
 */
export function DifficultyBadge({
  level,
  score,
  breakdown,
  size = 'medium',
  showTooltip = true,
  variant = 'default'
}: DifficultyBadgeProps) {
  const color = getLevelColor(level);
  const description = getLevelDescription(level);

  const chipSizes = {
    small: { fontSize: '0.75rem', height: 24 },
    medium: { fontSize: '0.875rem', height: 32 },
    large: { fontSize: '1rem', height: 40 }
  };

  const chipStyle = chipSizes[size];

  const badge = (
    <Chip
      icon={<SchoolIcon sx={{ fontSize: chipStyle.fontSize }} />}
      label={level}
      sx={{
        bgcolor: variant === 'filled' ? color : `${color}15`,
        color: variant === 'filled' ? '#fff' : color,
        fontWeight: 700,
        fontSize: chipStyle.fontSize,
        height: chipStyle.height,
        border: variant === 'outlined' ? `2px solid ${color}` : 'none',
        borderRadius: 2,
        px: 1,
        '& .MuiChip-icon': {
          color: variant === 'filled' ? '#fff' : color
        }
      }}
    />
  );

  if (!showTooltip || !breakdown) {
    return badge;
  }

  return (
    <Tooltip
      title={<DifficultyTooltipContent level={level} score={score} breakdown={breakdown} />}
      arrow
      placement="top"
    >
      {badge}
    </Tooltip>
  );
}

/**
 * Tooltip content showing detailed difficulty breakdown
 */
function DifficultyTooltipContent({
  level,
  score,
  breakdown
}: {
  level: CEFRLevel;
  score?: number;
  breakdown: Record<CEFRLevel, number>;
}) {
  const description = getLevelDescription(level);

  // Group levels for display
  const levelGroups = [
    { levels: ['A1', 'A2'], label: 'Basic/Elementary', emoji: '✅', threshold: 40 },
    { levels: ['B1', 'B2'], label: 'Intermediate', emoji: '⚠️', threshold: 30 },
    { levels: ['C1', 'C2'], label: 'Advanced/Proficient', emoji: '🔴', threshold: 20 }
  ];

  return (
    <Box sx={{ p: 1, minWidth: 280 }}>
      {/* Header */}
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Difficulty: {level} - {description}
      </Typography>

      {score !== undefined && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          Difficulty Score: {score.toFixed(2)}
        </Typography>
      )}

      {/* Breakdown by group */}
      <Stack spacing={1.5}>
        {levelGroups.map(group => {
          const total = group.levels.reduce((sum, l) => sum + (breakdown[l as CEFRLevel] || 0), 0);
          const isSignificant = total >= group.threshold;

          return (
            <Box key={group.label}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="caption" fontWeight={500}>
                  {group.emoji} {group.label}
                </Typography>
                <Typography variant="caption" fontWeight={700}>
                  {Math.round(total)}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={total}
                sx={{
                  height: 6,
                  borderRadius: 1,
                  bgcolor: 'rgba(255,255,255,0.2)',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: isSignificant ? group.emoji === '✅' ? '#4caf50' : group.emoji === '⚠️' ? '#ff9800' : '#f44336' : 'rgba(255,255,255,0.4)',
                    borderRadius: 1
                  }
                }}
              />

              {/* Individual levels */}
              <Stack direction="row" spacing={1} sx={{ mt: 0.5, pl: 1 }}>
                {group.levels.map(l => {
                  const value = breakdown[l as CEFRLevel] || 0;
                  const levelColor = getLevelColor(l as CEFRLevel);
                  return (
                    <Box key={l} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: levelColor
                        }}
                      />
                      <Typography variant="caption" fontSize="0.7rem">
                        {l}: {Math.round(value)}%
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          );
        })}
      </Stack>

      {/* Recommendation */}
      <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
        <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
          📚 Recommended For:
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {getRecommendation(level)}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * Get learning recommendation based on difficulty level
 */
function getRecommendation(level: CEFRLevel): string {
  const recommendations: Record<CEFRLevel, string> = {
    A1: 'Absolute beginners starting their language journey',
    A2: 'Elementary learners with basic vocabulary foundation',
    B1: 'Intermediate learners comfortable with everyday topics',
    B2: 'Upper intermediate learners ready for complex content',
    C1: 'Advanced learners seeking challenging material',
    C2: 'Proficient learners approaching native fluency'
  };
  return recommendations[level];
}

/**
 * Compact difficulty indicator for lists/cards
 */
export function DifficultyIndicator({ level }: { level: CEFRLevel }) {
  const color = getLevelColor(level);

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.5,
        borderRadius: 1,
        bgcolor: `${color}20`,
        border: `1px solid ${color}40`
      }}
    >
      <SchoolIcon sx={{ fontSize: 14, color }} />
      <Typography variant="caption" fontWeight={700} sx={{ color, fontSize: '0.7rem' }}>
        {level}
      </Typography>
    </Box>
  );
}
