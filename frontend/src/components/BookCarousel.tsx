import BookCard, { type BookCardData } from './BookCard';
import Carousel from './Carousel';

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
  index,
}: BookCarouselProps) {
  return (
    <Carousel
      title={title}
      items={books}
      loading={loading}
      index={index}
      renderItem={(book) => <BookCard book={book} />}
      getItemKey={(book) => book.gutenbergId}
      skeletonWidth={180}
      skeletonHeight={320}
      skeletonCount={8}
      speed={25}
    />
  );
}
