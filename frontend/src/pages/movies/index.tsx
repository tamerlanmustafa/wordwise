import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import Link from 'next/link';
import Card from '@/components/common/Card';
import Button from '@/components/common/Button';
import { apiService } from '@/services/api';
import { setMovies, setLoading, setError } from '@/store/slices/moviesSlice';
import { clearUser } from '@/store/slices/authSlice';
import { RootState } from '@/store';
import { Movie } from '@/types';

export default function Movies() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { movies, isLoading, error } = useSelector((state: RootState) => state.movies);
  const [filter, setFilter] = useState<string>('');

  useEffect(() => {
    loadMovies();
  }, [filter]);

  const loadMovies = async () => {
    try {
      dispatch(setLoading(true));
      const params = filter ? { difficulty: filter } : {};
      const response = await apiService.getMovies(params);
      dispatch(setMovies(response.movies));
    } catch (err: any) {
      dispatch(setError(err.message || 'Failed to load movies'));
    } finally {
      dispatch(setLoading(false));
    }
  };

  const handleLogout = () => {
    apiService.logout();
    dispatch(clearUser());
    router.push('/');
  };

  const difficultyColors = {
    A1: 'bg-green-100 text-green-800',
    A2: 'bg-blue-100 text-blue-800',
    B1: 'bg-yellow-100 text-yellow-800',
    B2: 'bg-orange-100 text-orange-800',
    C1: 'bg-red-100 text-red-800',
    C2: 'bg-purple-100 text-purple-800',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/">
                <h1 className="text-2xl font-bold text-primary-600 cursor-pointer">WordWise</h1>
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="outline" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Movies</h1>
          
          {/* Filter */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={filter === '' ? 'primary' : 'secondary'}
              onClick={() => setFilter('')}
              size="sm"
            >
              All
            </Button>
            {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => (
              <Button
                key={level}
                variant={filter === level ? 'primary' : 'secondary'}
                onClick={() => setFilter(level)}
                size="sm"
              >
                {level}
              </Button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        )}

        {/* Movies Grid */}
        {!isLoading && !error && (
          <>
            {movies.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-600 text-lg">No movies found.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {movies.map((movie: Movie) => (
                  <Card key={movie.id} hover className="flex flex-col">
                    <div className="flex-grow">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-xl font-semibold text-gray-900">{movie.title}</h3>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${difficultyColors[movie.difficulty_level]}`}>
                          {movie.difficulty_level}
                        </span>
                      </div>
                      <p className="text-gray-600 text-sm mb-2">Year: {movie.year}</p>
                      {movie.genre && (
                        <p className="text-gray-600 text-sm mb-2">Genre: {movie.genre}</p>
                      )}
                      <p className="text-gray-600 text-sm mb-4">
                        {movie.word_count} words
                      </p>
                      {movie.description && (
                        <p className="text-gray-700 text-sm line-clamp-3">{movie.description}</p>
                      )}
                    </div>
                    <div className="mt-4">
                      <Link href={`/movies/${movie.id}`}>
                        <Button className="w-full">View Details</Button>
                      </Link>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


