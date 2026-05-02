import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme/palette';
import { wordwiseApi, tmdbApi } from '../../services/api';
import { styles } from '../../core/styles';
import type { MovieData } from '../../core/types';

interface Props {
  query: string;
  onBack: () => void;
  onMoviePress: (movie: MovieData) => void;
}

// Routing prefixes:
//  - `genre:<id>:<displayName>` → TMDB discover endpoint (legacy quick-start)
//  - `level:<LEVEL>:<displayName>` → our backend `/movies/by-cefr` (CEFR levels)
//    or `/movies/by-level` (old enum), with per-row TMDB enrichment.
//  - anything else → TMDB title text search.
export const SearchResultsScreen = ({ query, onBack, onMoviePress }: Props) => {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const levelMatch = query.match(/^level:([A-Z_\d]+):(.+)$/);
  const genreMatch = query.match(/^genre:([\d|]+):(.+)$/);
  const isLevel = !!levelMatch;
  const isGenre = !isLevel && !!genreMatch;
  const levelValue = levelMatch?.[1] ?? '';
  const isCefrLevel = /^[ABC][12]$/.test(levelValue);
  const genreIds = genreMatch?.[1] ?? '';
  const displayTitle = isLevel
    ? `${levelMatch![2]} movies`
    : isGenre
    ? genreMatch![2]
    : `Results for "${query}"`;

  const searchPage = async (pageNum: number) => {
    try {
      if (isLevel) {
        if (pageNum > 1) return { movies: [], totalPages: 1 };
        const data = isCefrLevel
          ? await wordwiseApi.getMoviesByCefr(levelValue, 100)
          : await wordwiseApi.getMoviesByLevel(levelValue, 100);
        // Enrich each row with TMDB metadata when tmdb_id is known. We don't
        // store poster_path locally, so without TMDB the cards would be blank.
        const enriched = await Promise.all(
          (data.movies || []).map(async (m) => {
            let tmdb: any = null;
            if (m.tmdb_id) {
              try { tmdb = await tmdbApi.getMovieDetails(m.tmdb_id); } catch { tmdb = null; }
            }
            return {
              id: tmdb?.id ?? m.tmdb_id ?? -m.movie_id,
              title: tmdb?.title ?? m.title,
              poster_path: tmdb?.poster_path ?? null,
              release_date: tmdb?.release_date ?? (m.year ? `${m.year}-01-01` : ''),
              overview: tmdb?.overview ?? (m.description ?? ''),
              genre_ids: tmdb?.genre_ids ?? [],
              vote_average: tmdb?.vote_average ?? (m as any).vote_average ?? 0,
              original_language: tmdb?.original_language ?? 'en',
            };
          })
        );
        // Drop non-English films — WordWise can't process their subtitles
        // yet, so surfacing them in Quick Start would be misleading.
        const englishOnly = enriched.filter((m) => (m.original_language || 'en') === 'en');
        return { movies: englishOnly, totalPages: 1 };
      }

      // For genre quick-start: top-rated within genre, restricted to widely
      // rated films (>=5k votes) and English originals only — WordWise can
      // only process English subtitles right now, so foreign titles would
      // just dead-end at script fetch.
      const url = isGenre
        ? `https://api.themoviedb.org/3/discover/movie?api_key=9dece7a38786ac0c58794d6db4af3d51&with_genres=${encodeURIComponent(genreIds)}&with_original_language=en&sort_by=vote_average.desc&vote_count.gte=5000&include_adult=false&page=${pageNum}`
        : `https://api.themoviedb.org/3/search/movie?api_key=9dece7a38786ac0c58794d6db4af3d51&query=${encodeURIComponent(query)}&page=${pageNum}`;
      const res = await fetch(url);
      const data = await res.json();
      return {
        movies: data.results || [],
        totalPages: data.total_pages || 1,
      };
    } catch {
      return { movies: [], totalPages: 1 };
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { movies, totalPages } = await searchPage(1);
      setResults(movies);
      setHasMore(1 < totalPages);
      setPage(1);
      setLoading(false);
    })();
  }, [query]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const { movies, totalPages } = await searchPage(nextPage);
    setResults((prev) => [...prev, ...movies]);
    setPage(nextPage);
    setHasMore(nextPage < totalPages);
    setLoadingMore(false);
  };

  const handlePress = (movie: any) => {
    onMoviePress({
      id: movie.id,
      title: movie.title,
      poster_path: movie.poster_path,
      release_date: movie.release_date,
      overview: movie.overview,
      genre_ids: movie.genre_ids,
      vote_average: movie.vote_average,
      original_language: movie.original_language,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.detailHeaderTitle} numberOfLines={1}>
          {displayTitle}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.searchResultItem}
              onPress={() => handlePress(item)}
              onPressIn={() => {
                if (item.poster_path) Image.prefetch(`https://image.tmdb.org/t/p/w500${item.poster_path}`).catch(() => {});
                if (item.backdrop_path) Image.prefetch(`https://image.tmdb.org/t/p/w780${item.backdrop_path}`).catch(() => {});
              }}
              activeOpacity={0.7}
            >
              {item.poster_path ? (
                <Image
                  source={{ uri: `https://image.tmdb.org/t/p/w92${item.poster_path}` }}
                  style={styles.searchResultPoster}
                />
              ) : (
                <View style={[styles.searchResultPoster, { backgroundColor: colors.border }]} />
              )}
              <View style={styles.searchResultInfo}>
                <Text style={styles.searchResultTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.searchResultYear}>
                  {item.release_date?.slice(0, 4)}
                  {item.vote_average ? `  ⭐ ${item.vote_average.toFixed(1)}` : ''}
                </Text>
                {item.overview ? (
                  <Text style={styles.searchResultOverview} numberOfLines={2}>{item.overview}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ padding: 16 }} />
            ) : hasMore ? (
              <TouchableOpacity style={styles.seeAllButton} onPress={loadMore}>
                <Text style={styles.seeAllText}>Load more</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
};
