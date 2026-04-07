import { Box, Typography, ButtonBase } from '@mui/material';
import { useNavigate } from 'react-router-dom';

interface QuickFilter {
  id: string;
  icon: string;
  label: string;
  search: string; // query string appended to /search
}

const FILTERS: QuickFilter[] = [
  { id: 'easy',      icon: '🟢', label: 'Easy  (B1)',       search: '?difficulty=B1' },
  { id: 'dialogue',  icon: '💬', label: 'Dialogue-Heavy',   search: '?q=dialogue+drama' },
  { id: 'classic',   icon: '🎬', label: 'Classic Cinema',   search: '?q=classic+film' },
  { id: 'crime',     icon: '🔍', label: 'Crime & Thriller', search: '?q=crime+thriller' },
  { id: 'family',    icon: '🏠', label: 'Family Friendly',  search: '?q=family+adventure' },
];

export default function QuickStartRow() {
  const navigate = useNavigate();

  return (
    <Box sx={{ mb: 6 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
        Quick Start
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Jump straight in with a curated filter
      </Typography>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1.5,
        }}
      >
        {FILTERS.map((f) => (
          <ButtonBase
            key={f.id}
            onClick={() => navigate(`/search${f.search}`)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1.25,
              borderRadius: '999px',
              border: '1.5px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              transition: 'all 0.15s',
              fontFamily: 'inherit',
              '&:hover': {
                borderColor: 'primary.main',
                bgcolor: 'primary.50',
                transform: 'translateY(-2px)',
                boxShadow: 2,
              },
            }}
          >
            <Box component="span" sx={{ fontSize: '1.1rem', lineHeight: 1 }}>
              {f.icon}
            </Box>
            <Typography variant="body2" fontWeight={600}>
              {f.label}
            </Typography>
          </ButtonBase>
        ))}
      </Box>
    </Box>
  );
}
