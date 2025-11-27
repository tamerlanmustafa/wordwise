import axios from 'axios';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '9dece7a38786ac0c58794d6db4af3d51';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

export interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  overview: string;
  vote_average: number;
  genre_ids: number[];
}

export interface TMDBGenre {
  id: number;
  name: string;
}

export interface TMDBMoviesResponse {
  page: number;
  results: TMDBMovie[];
  total_pages: number;
  total_results: number;
}

export interface TMDBGenresResponse {
  genres: TMDBGenre[];
}

// Helper to get full image URL
export function getImageUrl(path: string | null, size: 'w200' | 'w500' | 'w780' | 'original' = 'w500'): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

// Fetch top rated movies
export async function fetchTopRatedMovies(page: number = 1): Promise<TMDBMoviesResponse> {
  const response = await axios.get<TMDBMoviesResponse>(`${TMDB_BASE_URL}/movie/top_rated`, {
    params: {
      api_key: TMDB_API_KEY,
      language: 'en-US',
      page
    }
  });
  return response.data;
}

// Fetch trending movies
export async function fetchTrendingMovies(timeWindow: 'day' | 'week' = 'day'): Promise<TMDBMoviesResponse> {
  const response = await axios.get<TMDBMoviesResponse>(`${TMDB_BASE_URL}/trending/movie/${timeWindow}`, {
    params: {
      api_key: TMDB_API_KEY
    }
  });
  return response.data;
}

// Fetch movie genres
export async function fetchGenres(): Promise<TMDBGenresResponse> {
  const response = await axios.get<TMDBGenresResponse>(`${TMDB_BASE_URL}/genre/movie/list`, {
    params: {
      api_key: TMDB_API_KEY,
      language: 'en-US'
    }
  });
  return response.data;
}

// Fetch movies by genre
export async function fetchMoviesByGenre(genreId: number, page: number = 1): Promise<TMDBMoviesResponse> {
  const response = await axios.get<TMDBMoviesResponse>(`${TMDB_BASE_URL}/discover/movie`, {
    params: {
      api_key: TMDB_API_KEY,
      language: 'en-US',
      with_genres: genreId,
      page,
      sort_by: 'popularity.desc'
    }
  });
  return response.data;
}

// Search movies
export async function searchTMDBMovies(query: string, page: number = 1): Promise<TMDBMoviesResponse> {
  const response = await axios.get<TMDBMoviesResponse>(`${TMDB_BASE_URL}/search/movie`, {
    params: {
      api_key: TMDB_API_KEY,
      language: 'en-US',
      query,
      page
    }
  });
  return response.data;
}
