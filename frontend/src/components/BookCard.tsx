import { Card, CardMedia, CardContent, Typography, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import MenuBookIcon from '@mui/icons-material/MenuBook';

export interface BookCardData {
  gutenbergId: number;
  title: string;
  author: string;
  coverUrl?: string;
}

interface BookCardProps {
  book: BookCardData;
}

export default function BookCard({ book }: BookCardProps) {
  const navigate = useNavigate();

  // Track if this was a scroll gesture to prevent click
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const wasScrollingRef = useRef(false);

  const navigateToBook = () => {
    navigate(`/book/${book.gutenbergId}`);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    wasScrollingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
    // If moved more than 10px, it's a scroll
    if (deltaX > 10 || deltaY > 10) {
      wasScrollingRef.current = true;
    }
  };

  const handleClick = () => {
    // Only navigate if we weren't scrolling
    if (!wasScrollingRef.current) {
      navigateToBook();
    }
    // Reset for next interaction
    wasScrollingRef.current = false;
    touchStartRef.current = null;
  };

  return (
    <Card
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      sx={{
        minWidth: 180,
        maxWidth: 180,
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        WebkitTapHighlightColor: 'transparent',
        userSelect: 'none',
        '&:hover': {
          transform: 'translateY(-8px)',
          boxShadow: 6
        },
        '&:active': {
          transform: 'scale(0.98)',
        }
      }}
    >
      {book.coverUrl ? (
        <CardMedia
          component="img"
          height="260"
          image={book.coverUrl}
          alt={book.title}
          sx={{ objectFit: 'cover' }}
        />
      ) : (
        <Box
          sx={{
            height: 260,
            bgcolor: 'primary.light',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <MenuBookIcon sx={{ fontSize: 64, color: 'primary.contrastText', opacity: 0.7 }} />
        </Box>
      )}
      <CardContent sx={{ p: 1.5 }}>
        <Typography
          variant="subtitle2"
          fontWeight="bold"
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            minHeight: '2.5em',
            fontSize: '0.8rem'
          }}
        >
          {book.title}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block'
          }}
        >
          {book.author}
        </Typography>
      </CardContent>
    </Card>
  );
}
