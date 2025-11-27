import { Box, Typography, Skeleton } from "@mui/material";
import type { TMDBMovie } from "../services/tmdbService";
import MovieCard from "./MovieCard";
import { useAutoScroll } from "../hooks/useAutoScroll";

interface MovieCarouselProps {
  title: string;
  movies: TMDBMovie[];
  loading?: boolean;
  index: number;
}

export default function MovieCarousel({
  title,
  movies,
  loading,
  index,
}: MovieCarouselProps) {
  const direction: "left" | "right" = index % 2 === 0 ? "right" : "left";

  const { containerRef: scrollRef, setSpeed } = useAutoScroll({
    speed: 10,
    direction,
  });

  const handleCardHover = (paused: boolean) => {
    setSpeed(paused ? 0 : 30);
  };

  if (loading) {
    return (
      <Box sx={{ mb: 6 }}>
        <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
          {title}
        </Typography>
        <Box sx={{ display: "flex", gap: 2 }}>
          {[...Array(10)].map((_, i) => (
            <Skeleton
              key={i}
              variant="rectangular"
              width={200}
              height={350}
              sx={{ borderRadius: 1 }}
            />
          ))}
        </Box>
      </Box>
    );
  }

  if (!movies || movies.length === 0) return null;

  // Duplicate list for perfect infinite loop
  const duplicated = [...movies, ...movies];

  return (
    <Box sx={{ mb: 6 }}>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
        {title}
      </Typography>

      {/* THIS ONE is the real scroll container */}
      <div
        ref={scrollRef}
        className="carousel-scroll"
        style={{
          display: "flex",
          gap: "16px",
          overflowX: "auto",
          overflowY: "hidden",
          padding: "8px 0",
          scrollbarWidth: "none",
          cursor: "default",
        }}
      >
        {duplicated.map((movie, idx) => (
          <div
            key={`${movie.id}-${idx}`}
            style={{ flexShrink: 0, cursor: "pointer" }}
            onMouseEnter={() => handleCardHover(true)}
            onMouseLeave={() => handleCardHover(false)}
          >
            <MovieCard movie={movie} />
          </div>
        ))}
      </div>
      <style>{`
        .carousel-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </Box>
  );
}
