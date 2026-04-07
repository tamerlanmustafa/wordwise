import { Box, Typography } from '@mui/material';
import { CEFR_COLOR, CEFR_TEXT_COLOR, CEFR_LABEL, type CefrLevel } from '../utils/homepageDifficulty';

interface CefrBadgeProps {
  level: CefrLevel;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export default function CefrBadge({ level, size = 'md', showLabel = false }: CefrBadgeProps) {
  const bg = CEFR_COLOR[level];
  const text = CEFR_TEXT_COLOR[level];

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box
        sx={{
          bgcolor: bg,
          color: text,
          borderRadius: '4px',
          px: size === 'sm' ? 0.75 : 1,
          py: size === 'sm' ? 0.25 : 0.5,
          fontWeight: 800,
          fontSize: size === 'sm' ? '0.65rem' : '0.78rem',
          letterSpacing: '0.05em',
          lineHeight: 1,
        }}
      >
        {level}
      </Box>
      {showLabel && (
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontWeight: 500, lineHeight: 1 }}
        >
          {CEFR_LABEL[level]}
        </Typography>
      )}
    </Box>
  );
}
