import { Box, Typography, Skeleton } from '@mui/material';
import BookCard, { type BookCardData } from './BookCard';
import { useAutoScroll } from '../hooks/useAutoScroll';

interface BookCarouselProps {
  title: string;
  books: BookCardData[];
  loading?: boolean;
  index: number;
}

export default function BookCarousel({
  title,
  books,
  loading,
  index
}: BookCarouselProps) {
  const direction: 'left' | 'right' = index % 2 === 0 ? 'right' : 'left';

  const { containerRef: scrollRef, setSpeed } = useAutoScroll({
    speed: 25,
    direction
  });

  const handleCardHover = (paused: boolean) => {
    setSpeed(paused ? 0 : 25);
  };

  if (loading) {
    return (
      <Box sx={{ mb: 6 }}>
        <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {[...Array(8)].map((_, i) => (
            <Skeleton
              key={i}
              variant="rectangular"
              width={180}
              height={320}
              sx={{ borderRadius: 1 }}
            />
          ))}
        </Box>
      </Box>
    );
  }

  if (!books || books.length === 0) return null;

  // Duplicate for infinite scroll
  const duplicated = [...books, ...books];

  return (
    <Box sx={{ mb: 6 }}>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
        {title}
      </Typography>

      <div
        ref={scrollRef}
        className="book-carousel-scroll"
        style={{
          display: 'flex',
          gap: '16px',
          overflowX: 'auto',
          overflowY: 'hidden',
          padding: '8px 0',
          scrollbarWidth: 'none',
          cursor: 'default'
        }}
      >
        {duplicated.map((book, idx) => (
          <div
            key={`${book.gutenbergId}-${idx}`}
            style={{ flexShrink: 0, cursor: 'pointer' }}
            onMouseEnter={() => handleCardHover(true)}
            onMouseLeave={() => handleCardHover(false)}
          >
            <BookCard book={book} />
          </div>
        ))}
      </div>
      <style>{`
        .book-carousel-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </Box>
  );
}
