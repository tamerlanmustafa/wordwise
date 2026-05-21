/**
 * ReadyToWatchShelf — v0.6 discovery surface anchored to the top of the
 * Journey Reel. Lists 3–5 movies the user has built enough vocabulary
 * to understand but hasn't added to their reel yet (sourced from
 * GET /movies/ready-to-watch, ranked by comprehensibility % desc).
 *
 * UX rules:
 *   • Hidden entirely when the response is empty (no "we couldn't find
 *     anything" copy — early-days users would always see that).
 *   • Hidden if the user dismissed the shelf today (AsyncStorage key,
 *     date-bucketed so it reappears tomorrow).
 *   • Each card → "+ Add" pulls it into the reel via `reelApi.add`,
 *     then disappears from the shelf in-place.
 *
 * No persistent ordering: the backend already returns highest-comprehensibility
 * first, so we render in array order.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readyToWatchApi, reelApi, type ReadyToWatchMovie } from '../../services/api';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

const DISMISS_KEY = 'journey.rtwShelf.dismissedDate';

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface ReadyToWatchShelfProps {
  /** Called after a movie is successfully added so the parent can
   *  refresh its reel data (poster + reel ordering). */
  onAdded?: (movie: ReadyToWatchMovie) => void;
}

type Phase = 'idle' | 'loading' | 'ready' | 'empty' | 'dismissed';

export function ReadyToWatchShelf({ onAdded }: ReadyToWatchShelfProps) {
  const tc = useThemeColors();
  const s = makeStyles(tc);

  const [phase, setPhase] = useState<Phase>('idle');
  const [movies, setMovies] = useState<ReadyToWatchMovie[]>([]);
  const [adding, setAdding] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase('loading');
      try {
        const dismissed = await AsyncStorage.getItem(DISMISS_KEY);
        if (dismissed === todayLocal()) {
          if (!cancelled) setPhase('dismissed');
          return;
        }
        const res = await readyToWatchApi.list();
        if (cancelled) return;
        if (res.movies.length === 0) {
          setPhase('empty');
        } else {
          setMovies(res.movies);
          setPhase('ready');
        }
      } catch (e) {
        // Network errors are non-fatal — discovery shelf is optional.
        // Log and hide rather than blocking the reel.
        console.warn('[ReadyToWatchShelf] load failed:', (e as Error)?.message);
        if (!cancelled) setPhase('empty');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissForToday = async () => {
    try {
      await AsyncStorage.setItem(DISMISS_KEY, todayLocal());
    } catch {
      /* best-effort */
    }
    setPhase('dismissed');
  };

  const handleAdd = async (movie: ReadyToWatchMovie) => {
    if (movie.tmdb_id == null) return;
    setAdding(movie.movie_id);
    try {
      await reelApi.add({
        tmdb_id: movie.tmdb_id,
        title: movie.title,
        // The Movie row may not carry poster_url; that's fine — the reel
        // tile falls back to a placeholder until TMDB hydrates.
        poster_path: movie.poster_url,
        year: movie.year,
      });
      setMovies((prev) => prev.filter((m) => m.movie_id !== movie.movie_id));
      onAdded?.(movie);
    } catch (e) {
      console.warn('[ReadyToWatchShelf] add failed:', (e as Error)?.message);
    } finally {
      setAdding(null);
    }
  };

  if (phase === 'idle' || phase === 'loading') {
    // Brief loading state — keep slim so we don't reserve a big strip on a
    // user who'll end up with no results.
    return (
      <View style={s.loadingRow}>
        <ActivityIndicator size="small" color={tc.textSecondary} />
      </View>
    );
  }

  if (phase === 'empty' || phase === 'dismissed' || movies.length === 0) {
    return null;
  }

  return (
    <View style={s.wrap} pointerEvents="box-none">
      <View style={s.header}>
        <Text style={s.eyebrow}>Ready to watch</Text>
        <TouchableOpacity onPress={dismissForToday} hitSlop={10}>
          <Text style={s.dismissText}>×</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
      >
        {movies.map((m) => {
          const isAdding = adding === m.movie_id;
          return (
            <View key={m.movie_id} style={s.card}>
              <Text style={s.cardTitle} numberOfLines={2}>
                {m.title}
              </Text>
              <Text style={s.cardYear}>
                {m.year ?? '—'} · {m.comprehensibility_percent}%
              </Text>
              <Pressable
                onPress={() => handleAdd(m)}
                disabled={isAdding || m.tmdb_id == null}
                style={({ pressed }) => [
                  s.addBtn,
                  pressed && { opacity: 0.85 },
                  (isAdding || m.tmdb_id == null) && { opacity: 0.6 },
                ]}
              >
                <Text style={s.addBtnText}>
                  {isAdding ? '…' : '+ Add'}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    loadingRow: {
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wrap: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: 'rgba(0,0,0,0.32)',
      borderRadius: 12,
      marginHorizontal: 12,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
      paddingHorizontal: 4,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: '900',
      color: tc.gold,
      letterSpacing: 1.6,
      textTransform: 'uppercase',
    },
    dismissText: {
      fontSize: 20,
      color: '#fff',
      opacity: 0.75,
      lineHeight: 20,
      paddingHorizontal: 6,
    },
    row: {
      paddingHorizontal: 4,
      gap: 8,
    },
    card: {
      width: 128,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
      gap: 6,
    },
    cardTitle: {
      fontSize: 12,
      fontWeight: '800',
      color: tc.text,
      lineHeight: 14,
    },
    cardYear: {
      fontSize: 10,
      fontWeight: '700',
      color: tc.textSecondary,
      letterSpacing: 0.2,
    },
    addBtn: {
      marginTop: 4,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: tc.gold,
      alignItems: 'center',
    },
    addBtnText: {
      fontSize: 11,
      fontWeight: '900',
      color: tc.goldDeep,
      letterSpacing: 0.4,
    },
  });
