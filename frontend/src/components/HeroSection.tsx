import { Box, Typography, Button, Skeleton } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useNavigate } from 'react-router-dom';
import type { TMDBMovie } from '../services/tmdbService';
import { getImageUrl } from '../services/tmdbService';
import CefrBadge from './CefrBadge';
import { getMovieCefr, CEFR_LABEL, getUnderstandablePct } from '../utils/homepageDifficulty';

interface HeroSectionProps {
  movie: TMDBMovie | null;
  loading: boolean;
}

export default function HeroSection({ movie, loading }: HeroSectionProps) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <Skeleton
        variant="rectangular"
        sx={{ width: '100%', height: { xs: 340, md: 480 }, borderRadius: 0 }}
      />
    );
  }

  if (!movie) return null;

  const backdrop = getImageUrl(movie.backdrop_path, 'original');
  const year = movie.release_date?.slice(0, 4);
  const cefr = getMovieCefr(movie.id);
  const pct = getUnderstandablePct(movie.id);

  const handleStart = () => {
    navigate(`/movie/${movie.id}`, {
      state: { title: movie.title, year, tmdbId: movie.id, movieTitle: movie.title },
    });
  };

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: { xs: 340, md: 480 },
        overflow: 'hidden',
        bgcolor: 'grey.900',
      }}
    >
      {/* Backdrop */}
      {backdrop && (
        <Box
          component="img"
          src={backdrop}
          alt=""
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 20%',
          }}
        />
      )}

      {/* Gradient overlay — bottom-heavy so text is always readable */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.15) 100%)',
        }}
      />

      {/* Content */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          px: { xs: 3, md: 6 },
          pb: { xs: 4, md: 5 },
          maxWidth: 720,
        }}
      >
        {/* CEFR + level label */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <CefrBadge level={cefr} size="md" />
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>
            {CEFR_LABEL[cefr]} · {pct}% within your level
          </Typography>
        </Box>

        {/* Title */}
        <Typography
          variant="h3"
          fontWeight={800}
          sx={{
            color: '#fff',
            lineHeight: 1.1,
            mb: 1.5,
            fontSize: { xs: '1.75rem', md: '2.5rem' },
            textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}
        >
          {movie.title}
        </Typography>

        {/* One-line hook */}
        <Typography
          variant="body1"
          sx={{
            color: 'rgba(255,255,255,0.80)',
            mb: 3,
            maxWidth: 560,
            lineHeight: 1.5,
            display: { xs: 'none', sm: 'block' },
          }}
        >
          {movie.overview
            ? movie.overview.slice(0, 110).trimEnd() + '…'
            : `A great pick to build ${CEFR_LABEL[cefr].toLowerCase()} vocabulary.`}
        </Typography>

        {/* CTA */}
        <Button
          variant="contained"
          size="large"
          startIcon={<PlayArrowIcon />}
          onClick={handleStart}
          sx={{
            bgcolor: 'primary.main',
            color: '#fff',
            fontWeight: 700,
            px: 3.5,
            py: 1.25,
            borderRadius: 2,
            textTransform: 'none',
            fontSize: '1rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            '&:hover': { bgcolor: 'primary.dark', transform: 'translateY(-1px)' },
            transition: 'all 0.15s',
          }}
        >
          Start Learning
        </Button>
      </Box>

      {/* Year badge top-right */}
      {year && (
        <Box
          sx={{
            position: 'absolute',
            top: 20,
            right: 24,
            bgcolor: 'rgba(0,0,0,0.55)',
            color: '#fff',
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            fontSize: '0.8rem',
            fontWeight: 600,
          }}
        >
          {year}
        </Box>
      )}
    </Box>
  );
}
