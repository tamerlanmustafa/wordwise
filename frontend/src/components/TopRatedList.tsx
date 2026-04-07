import { Box, Typography, Skeleton, Divider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { TMDBMovie } from '../services/tmdbService';
import { getImageUrl } from '../services/tmdbService';
import CefrBadge from './CefrBadge';
import { getMovieCefr, getUnderstandablePct, CEFR_LABEL } from '../utils/homepageDifficulty';

interface TopRatedListProps {
  movies: TMDBMovie[];
  loading: boolean;
}

function UnderstandableBar({ pct }: { pct: number }) {
  const color = pct >= 75 ? '#43a047' : pct >= 55 ? '#fb8c00' : '#e53935';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
      <Box
        sx={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          bgcolor: 'grey.200',
          overflow: 'hidden',
          maxWidth: 120,
        }}
      >
        <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: color, borderRadius: 2 }} />
      </Box>
      <Typography variant="caption" sx={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {pct}% understandable
      </Typography>
    </Box>
  );
}

export default function TopRatedList({ movies, loading }: TopRatedListProps) {
  const navigate = useNavigate();

  const handleClick = (movie: TMDBMovie) => {
    navigate(`/movie/${movie.id}`, {
      state: {
        title: movie.title,
        year: movie.release_date?.slice(0, 4) || null,
        tmdbId: movie.id,
        movieTitle: movie.title,
      },
    });
  };

  return (
    <Box sx={{ mb: 6 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
        ⭐ Top Rated for Learning
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Ranked by vocabulary richness and dialogue clarity
      </Typography>

      <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        {loading
          ? [...Array(8)].map((_, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
                <Skeleton variant="text" width={28} height={36} />
                <Skeleton variant="rectangular" width={52} height={78} sx={{ borderRadius: 1 }} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="40%" />
                </Box>
              </Box>
            ))
          : movies.slice(0, 8).map((movie, i) => {
              const poster = getImageUrl(movie.poster_path, 'w200');
              const cefr = getMovieCefr(movie.id);
              const pct = getUnderstandablePct(movie.id);
              const isTop3 = i < 3;

              return (
                <Box key={movie.id}>
                  <Box
                    onClick={() => handleClick(movie)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      p: 2,
                      cursor: 'pointer',
                      bgcolor: 'background.paper',
                      transition: 'bgcolor 0.15s',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    {/* Rank */}
                    <Typography
                      sx={{
                        width: 28,
                        textAlign: 'center',
                        fontWeight: 800,
                        fontSize: isTop3 ? '1.4rem' : '1.1rem',
                        color: isTop3 ? 'primary.main' : 'text.disabled',
                        flexShrink: 0,
                        lineHeight: 1,
                      }}
                    >
                      {i + 1}
                    </Typography>

                    {/* Poster */}
                    <Box
                      sx={{
                        width: 52,
                        height: 78,
                        borderRadius: 1,
                        overflow: 'hidden',
                        flexShrink: 0,
                        bgcolor: 'grey.200',
                      }}
                    >
                      {poster ? (
                        <Box
                          component="img"
                          src={poster}
                          alt={movie.title}
                          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : null}
                    </Box>

                    {/* Info */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="body1"
                        fontWeight={600}
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {movie.title}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                        <CefrBadge level={cefr} size="sm" />
                        <Typography variant="caption" color="text.secondary">
                          {CEFR_LABEL[cefr]}
                        </Typography>
                      </Box>
                      <UnderstandableBar pct={pct} />
                    </Box>

                    {/* Rating */}
                    {movie.vote_average > 0 && (
                      <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          sx={{ color: '#f5a623' }}
                        >
                          ★ {movie.vote_average.toFixed(1)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {movie.release_date?.slice(0, 4)}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                  {i < 7 && <Divider />}
                </Box>
              );
            })}
      </Box>
    </Box>
  );
}
