/**
 * Book Service
 *
 * Handles API calls for book search, details, and analysis.
 * Uses Open Library for metadata and Gutenberg for public domain texts.
 */

import apiClient from './api';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface BookSearchResult {
  id?: number;
  gutenberg_id: number;
  title: string;
  author: string | null;
  authors: string[];
  author_birth_year?: number | null;
  author_death_year?: number | null;
  first_publish_year?: number | null;
  subjects: string[];
  languages: string[];
  is_public_domain: boolean;
  download_count?: number;
  cover_small: string | null;
  cover_medium: string | null;
  cover_large: string | null;
  plain_text_url?: string | null;
  open_library_key?: string | null;
  open_library_work_id?: string | null;
  match_score?: number;
}

interface BookSearchResponse {
  query: string;
  books: BookSearchResult[];
  total: number;
  has_text: boolean;
  source: string;
}

interface BookDetails {
  id: number;
  title: string;
  author: string | null;
  year: number;
  description: string | null;
  poster_url: string | null;
  difficulty_level: string | null;
  difficulty_score: number | null;
  word_count: number | null;
  gutenberg_id: number | null;
  open_library_key: string | null;
  content_type: string;
}

interface BookAnalysisResult {
  book_id: number;
  title: string;
  author: string | null;
  word_count: number;
  unique_words: number;
  cefr_distribution: Record<string, number>;
  difficulty_level?: string;
  difficulty_score?: number;
  already_exists: boolean;
  warning?: string;
}

/**
 * Search for public domain books
 * @param query Search query (title, author, or general)
 * @param limit Maximum number of results
 */
export async function searchBooks(
  query: string,
  limit: number = 20
): Promise<BookSearchResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/books/search?q=${encodeURIComponent(query)}&limit=${limit}`
  );

  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get details for a specific Gutenberg book (before analysis)
 * @param gutenbergId The Gutenberg book ID
 */
export async function getGutenbergBook(
  gutenbergId: number
): Promise<BookSearchResult> {
  const response = await fetch(
    `${API_BASE_URL}/api/books/gutenberg/${gutenbergId}`
  );

  if (!response.ok) {
    throw new Error(`Failed to get book: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Analyze a book from Gutenberg
 * Downloads the text and runs CEFR classification
 * Requires authentication
 *
 * @param gutenbergId The Gutenberg book ID
 */
export async function analyzeBook(
  gutenbergId: number
): Promise<BookAnalysisResult> {
  const response = await apiClient.post(`/api/books/analyze/${gutenbergId}`);
  return response.data;
}

/**
 * Get book details by WordWise book ID (after analysis)
 * @param bookId The WordWise book ID
 */
export async function getBook(bookId: number): Promise<BookDetails> {
  const response = await fetch(`${API_BASE_URL}/api/books/${bookId}`);

  if (!response.ok) {
    throw new Error(`Failed to get book: ${response.statusText}`);
  }

  return response.json();
}

