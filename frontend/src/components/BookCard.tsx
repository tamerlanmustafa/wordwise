import { Card, CardMedia, CardContent, Typography, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
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

  const handleClick = () => {
    navigate(`/book/${book.gutenbergId}`);
  };

  return (
    <Card
      onClick={handleClick}
      sx={{
        minWidth: 180,
        maxWidth: 180,
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': {
          transform: 'translateY(-8px)',
          boxShadow: 6
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
