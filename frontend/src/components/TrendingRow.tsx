import { useRef } from 'react';
import { Box, Typography, Skeleton } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { TMDBMovie } from '../services/tmdbService';
import { getImageUrl } from '../services/tmdbService';
import CefrBadge from './CefrBadge';
import { getMovieCefr } from '../utils/homepageDifficulty';

interface TrendingRowProps {
  movies: TMDBMovie[];
  loading: boolean;
}

const CARD_WIDTH = 160;
const CARD_GAP = 14;

export default function TrendingRow({ movies, loading }: TrendingRowProps) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  // Drag-to-scroll on desktop
  const onMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = false;
    startXRef.current = e.pageX - (scrollRef.current?.offsetLeft ?? 0);
    scrollLeftRef.current = scrollRef.current?.scrollLeft ?? 0;
    scrollRef.current?.addEventListener('mousemove', onMouseMove);
    scrollRef.current?.addEventListener('mouseup', onMouseUp);
    scrollRef.current?.addEventListener('mouseleave', onMouseUp);
  };

  const onMouseMove = (e: MouseEvent) => {
    const x = e.pageX - (scrollRef.current?.offsetLeft ?? 0);
    const delta = x - startXRef.current;
    if (Math.abs(delta) > 5) isDraggingRef.current = true;
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollLeftRef.current - delta;
  };

  const onMouseUp = () => {
    scrollRef.current?.removeEventListener('mousemove', onMouseMove);
    scrollRef.current?.removeEventListener('mouseup', onMouseUp);
    scrollRef.current?.removeEventListener('mouseleave', onMouseUp);
  };

  const handleCardClick = (movie: TMDBMovie) => {
    if (isDraggingRef.current) return;
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
      <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
        🔥 Trending Now
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', gap: `${CARD_GAP}px` }}>
          {[...Array(8)].map((_, i) => (
            <Skeleton
              key={i}
              variant="rectangular"
              width={CARD_WIDTH}
              height={CARD_WIDTH * 1.5}
              sx={{ borderRadius: 2, flexShrink: 0 }}
            />
          ))}
        </Box>
      ) : (
        <Box
          ref={scrollRef}
          onMouseDown={onMouseDown}
          sx={{
            display: 'flex',
            gap: `${CARD_GAP}px`,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
            // Snap: each card snaps individually
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            pb: 1,
            // Right-fade to signal more content
            maskImage: 'linear-gradient(to right, black 80%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, black 80%, transparent 100%)',
            cursor: 'grab',
            '&:active': { cursor: 'grabbing' },
          }}
        >
          {movies.map((movie) => {
            const poster = getImageUrl(movie.poster_path, 'w500');
            const cefr = getMovieCefr(movie.id);
            return (
              <Box
                key={movie.id}
                onClick={() => handleCardClick(movie)}
                sx={{
                  flexShrink: 0,
                  width: CARD_WIDTH,
                  scrollSnapAlign: 'start',
                  cursor: 'pointer',
                  transition: 'transform 0.18s',
                  '&:hover': { transform: 'translateY(-6px)' },
                  userSelect: 'none',
                }}
              >
                {/* Poster */}
                <Box
                  sx={{
                    position: 'relative',
                    width: CARD_WIDTH,
                    height: CARD_WIDTH * 1.5,
                    borderRadius: 2,
                    overflow: 'hidden',
                    bgcolor: 'grey.300',
                  }}
                >
                  {poster ? (
                    <Box
                      component="img"
                      src={poster}
                      alt={movie.title}
                      sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        No image
                      </Typography>
                    </Box>
                  )}
                  {/* CEFR badge overlaid on poster bottom-left */}
                  <Box sx={{ position: 'absolute', bottom: 8, left: 8 }}>
                    <CefrBadge level={cefr} size="sm" />
                  </Box>
                </Box>

                {/* Title */}
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{
                    mt: 1,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: 1.35,
                    minHeight: '2.7em',
                  }}
                >
                  {movie.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {movie.release_date?.slice(0, 4)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
