import { Box, Typography, ButtonBase } from '@mui/material';
import { useNavigate } from 'react-router-dom';

interface QuickFilter {
  id: string;
  icon: string;
  label: string;
  // TMDB genre id (or pipe-joined ids for OR matching) + display name
  genreId: string;
  genreName: string;
}

const FILTERS: QuickFilter[] = [
  { id: 'drama',     icon: '🎭', label: 'Drama',            genreId: '18',    genreName: 'Drama' },
  { id: 'comedy',    icon: '😂', label: 'Comedy',           genreId: '35',    genreName: 'Comedy' },
  { id: 'crime',     icon: '🔍', label: 'Crime & Thriller', genreId: '80|53', genreName: 'Crime & Thriller' },
  { id: 'family',    icon: '🏠', label: 'Family Friendly',  genreId: '10751', genreName: 'Family' },
  { id: 'romance',   icon: '💞', label: 'Romance',          genreId: '10749', genreName: 'Romance' },
  { id: 'animation', icon: '🎨', label: 'Animation',        genreId: '16',    genreName: 'Animation' },
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
            onClick={() =>
              navigate(
                `/search?genre=${encodeURIComponent(f.genreId)}&name=${encodeURIComponent(f.genreName)}&sort=top_rated`
              )
            }
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
