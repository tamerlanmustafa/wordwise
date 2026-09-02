import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '../../theme/palette';
import { wordwiseApi, tmdbApi } from '../../services/api';
import { styles } from '../../core/styles';
import type { MovieData } from '../../core/types';
import { useReelStore } from '../../stores/reelStore';
import { requestAddFilm } from '../../stores/addFilmStore';
import { Skeleton } from '../ui/Skeleton';
import { StarIcon } from '../ui/icons';

interface Props {
  query: string;
  onBack: () => void;
  onMoviePress: (movie: MovieData) => void;
  /** When 'addToReel', tapping a row adds the movie to the user's reel
      instead of opening movie detail. The row shows a checkmark once
      added; tapping again removes it. */
  mode?: 'open' | 'addToReel';
}

// Routing prefixes:
//  - `genre:<id>:<displayName>` → TMDB discover endpoint (legacy quick-start)
//  - `level:<LEVEL>:<displayName>` → our backend `/movies/by-cefr` (CEFR levels)
//    or `/movies/by-level` (old enum), with per-row TMDB enrichment.
//  - anything else → TMDB title text search.
export const SearchResultsScreen = ({ query, onBack, onMoviePress, mode = 'open' }: Props) => {
  const { t } = useTranslation();
  // In addToReel mode the user types into an inline search box; we
  // re-run the query whenever `liveQuery` changes (debounced).
  const [liveQuery, setLiveQuery] = useState(query);
  const effectiveQuery = mode === 'addToReel' ? liveQuery : query;

  const reelTiles = useReelStore((s) => s.tiles);
  const reelRemove = useReelStore((s) => s.remove);
  // Only user-source rows count as "in your reel" — suggested tiles
  // are server-curated, not user-picked, so the + button stays active.
  const isInReel = (id: number) =>
    reelTiles.some((t) => t.tmdb_id === id && t.source === 'user');

  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const levelMatch = effectiveQuery.match(/^level:([A-Z_\d]+):(.+)$/);
  const genreMatch = effectiveQuery.match(/^genre:([\d|]+):(.+)$/);
  const isLevel = !!levelMatch;
  const isGenre = !isLevel && !!genreMatch;
  const levelValue = levelMatch?.[1] ?? '';
  const isCefrLevel = /^[ABC][12]$/.test(levelValue);
  const genreIds = genreMatch?.[1] ?? '';
  const displayTitle = isLevel
    ? `${levelMatch![2]} movies`
    : isGenre
    ? genreMatch![2]
    : mode === 'addToReel'
    ? 'Add Movies'
    : `Results for "${effectiveQuery}"`;

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
      // just dead-end at script fetch. Those filters now live in the backend
      // proxy (services/tmdb_proxy.discover_by_genre), not in this URL.
      const data = isGenre
        ? await tmdbApi.discoverByGenre(genreIds, pageNum)
        : await tmdbApi.searchMoviesPaged(effectiveQuery, pageNum);
      return {
        movies: data.results,
        totalPages: data.total_pages,
      };
    } catch {
      return { movies: [], totalPages: 1 };
    }
  };

  useEffect(() => {
    if (mode === 'addToReel' && !effectiveQuery.trim()) {
      // No query yet — just clear and wait for user input.
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Tiny debounce so each keystroke doesn't spam TMDB.
    const t = setTimeout(async () => {
      const { movies, totalPages } = await searchPage(1);
      if (cancelled) return;
      setResults(movies);
      setHasMore(1 < totalPages);
      setPage(1);
      setLoading(false);
    }, mode === 'addToReel' ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [effectiveQuery, mode]);

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
    if (mode === 'addToReel') {
      if (isInReel(movie.id)) {
        reelRemove(movie.id);
      } else {
        const year = movie.release_date ? Number(movie.release_date.slice(0, 4)) || null : null;
        // Route through the branded analyzing → reel-ready overlay (§B)
        // instead of an instant add. The overlay owns reelStore.add.
        requestAddFilm({
          tmdb_id: movie.id,
          title: movie.title,
          poster_path: movie.poster_path ?? null,
          year,
        });
      }
      return;
    }
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

      {mode === 'addToReel' ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <TextInput
            value={liveQuery}
            onChangeText={setLiveQuery}
            placeholder={t('movies:search.placeholder')}
            placeholderTextColor="#9aa"
            autoFocus
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: '#E0D4F7',
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 15,
              backgroundColor: '#fff',
            }}
          />
        </View>
      ) : null}

      {loading ? (
        /* Rows at the real result row's measurements — 46x69 poster, 8pt
           padding, hairline divider — rather than the full-screen spinner
           this used to be. A spinner in the middle of an empty screen says
           "wait"; a list of the right shape says what is arriving. */
        <View>
          {Array.from({ length: 8 }).map((_, i) => (
            <View key={i} style={styles.searchResultItem}>
              <Skeleton width={46} height={69} radius={4} sheen delay={i * 60} />
              <View style={styles.searchResultInfo}>
                <Skeleton width="66%" height={15} radius={4} sheen delay={i * 60 + 40} />
                <Skeleton
                  width="30%"
                  height={11}
                  radius={4}
                  sheen
                  delay={i * 60 + 70}
                  style={styles.searchSkeletonMeta}
                />
              </View>
            </View>
          ))}
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
                <View style={styles.searchResultMetaRow}>
                  <Text style={styles.searchResultYear}>{item.release_date?.slice(0, 4)}</Text>
                  {item.vote_average ? (
                    <>
                      <StarIcon size={11} filled animate={false} />
                      <Text style={styles.searchResultYear}>{item.vote_average.toFixed(1)}</Text>
                    </>
                  ) : null}
                </View>
                {item.overview ? (
                  <Text style={styles.searchResultOverview} numberOfLines={2}>{item.overview}</Text>
                ) : null}
              </View>
              {mode === 'addToReel' ? (
                <Text style={{ fontSize: 22, color: isInReel(item.id) ? colors.primary : '#C5C5D0', marginStart: 8 }}>
                  {isInReel(item.id) ? '✓' : '+'}
                </Text>
              ) : null}
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
                <Text style={styles.seeAllText}>{t('movies:search.loadMore')}</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
};
