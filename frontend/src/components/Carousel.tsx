import type { ReactNode } from 'react';
import { Box, Typography, Skeleton } from '@mui/material';
import { useAutoScroll } from '../hooks/useAutoScroll';

interface CarouselProps<T> {
  title: string;
  items: T[];
  loading?: boolean;
  index: number;
  renderItem: (item: T, index: number) => ReactNode;
  getItemKey: (item: T, index: number) => string | number;
  skeletonWidth?: number;
  skeletonHeight?: number;
  skeletonCount?: number;
  speed?: number;
}

export default function Carousel<T>({
  title,
  items,
  loading,
  index,
  renderItem,
  getItemKey,
  skeletonWidth = 200,
  skeletonHeight = 350,
  skeletonCount = 10,
  speed = 0.5,
}: CarouselProps<T>) {
  const direction: 'left' | 'right' = index % 2 === 0 ? 'right' : 'left';

  const { containerRef, pause, resume } = useAutoScroll({
    speed,
    direction,
  });

  if (loading) {
    return (
      <Box sx={{ mb: 6 }}>
        <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {[...Array(skeletonCount)].map((_, i) => (
            <Skeleton
              key={i}
              variant="rectangular"
              width={skeletonWidth}
              height={skeletonHeight}
              sx={{ borderRadius: 1, flexShrink: 0 }}
            />
          ))}
        </Box>
      </Box>
    );
  }

  if (!items || items.length === 0) return null;

  // Duplicate list for infinite loop
  const duplicated = [...items, ...items];

  return (
    <Box sx={{ mb: 6 }}>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
        {title}
      </Typography>

      <Box
        ref={containerRef}
        onPointerEnter={pause}
        onPointerLeave={resume}
        sx={{
          display: 'flex',
          gap: 2,
          overflowX: 'auto',
          overflowY: 'hidden',
          py: 1,
          // Hide scrollbar
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none',
          // iOS smooth scrolling
          WebkitOverflowScrolling: 'touch',
          // Prevent vertical scroll hijack
          touchAction: 'pan-x',
        }}
      >
        {duplicated.map((item, idx) => (
          <Box key={`${getItemKey(item, idx)}-${idx}`} sx={{ flexShrink: 0 }}>
            {renderItem(item, idx)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
