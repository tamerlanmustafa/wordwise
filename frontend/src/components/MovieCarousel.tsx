import type { TMDBMovie } from '../services/tmdbService';
import MovieCard from './MovieCard';
import Carousel from './Carousel';

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
  return (
    <Carousel
      title={title}
      items={movies}
      loading={loading}
      index={index}
      renderItem={(movie) => <MovieCard movie={movie} />}
      getItemKey={(movie) => movie.id}
      skeletonWidth={200}
      skeletonHeight={350}
      skeletonCount={10}
      speed={30}
    />
  );
}
