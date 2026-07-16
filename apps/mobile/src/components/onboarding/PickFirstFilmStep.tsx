/**
 * PickFirstFilmStep — onboarding step 5 (prototype §5). A 2-col poster grid,
 * single-select (gold border + check badge), plus a live "Search for another
 * film" field. Suggestions are real, analyzable films from the user's level
 * (wordwiseApi.getMoviesByLevel); search reuses tmdbApi.searchMovies. The
 * chosen film is added to the reel by OnboardingFlow on finish — reusing
 * reelStore + the same add path as Section B.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY } from '../../theme/fonts';
import { tmdbApi, wordwiseApi } from '../../services/api';
import type { CefrLevel } from '../../types';
import { TmdbPoster } from '../movies/TmdbPoster';
import { StepHeader } from './StepHeader';
import { OnboardingCTA } from './OnboardingCTA';

export interface FirstFilm {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
}

export interface PickFirstFilmStepProps {
  startingLevel: CefrLevel;
  selected: FirstFilm | null;
  onSelect: (film: FirstFilm) => void;
  onBack: () => void;
  onContinue: () => void;
}

function yearOf(releaseDate: string | undefined): number | null {
  if (!releaseDate) return null;
  const y = parseInt(releaseDate.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export function PickFirstFilmStep({ startingLevel, selected, onSelect, onBack, onContinue }: PickFirstFilmStepProps) {
  const tc = useThemeColors();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<FirstFilm[]>([]);
  const [results, setResults] = useState<FirstFilm[]>([]);
  const [loading, setLoading] = useState(true);
  const searchSeq = useRef(0);

  // Level-tailored suggestions: real WordWise-processed (English) films.
  useEffect(() => {
    let active = true;
    setLoading(true);
    wordwiseApi
      .getMoviesByLevel(startingLevel, 12)
      .then((res) => {
        if (!active) return;
        const films = res.movies
          .filter((m) => m.tmdb_id != null)
          .map<FirstFilm>((m) => ({ tmdb_id: m.tmdb_id as number, title: m.title, poster_path: null, year: m.year }))
          .slice(0, 6);
        setSuggestions(films);
      })
      .catch(() => {
        if (active) setSuggestions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [startingLevel]);

  // Debounced search (reuses the TMDB search endpoint).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const handle = setTimeout(() => {
      tmdbApi
        .searchMovies(q)
        .then((movies) => {
          if (seq !== searchSeq.current) return;
          setResults(
            movies.slice(0, 8).map<FirstFilm>((m) => ({
              tmdb_id: m.id,
              title: m.title,
              poster_path: m.poster_path,
              year: yearOf(m.release_date),
            })),
          );
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        });
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const grid = query.trim().length >= 2 ? results : suggestions;

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      {/* iOS never resizes for the keyboard; a padding-behavior KAV lifts the
          search box, grid and the Start-learning CTA above it (#82). The KAV
          measures its frame relative to the SafeAreaView content box (below the
          top inset), so keyboardVerticalOffset MUST be insets.top — without it
          the padding is short by that inset and the keyboard clips the CTA.
          Android relies on adjustResize (windowSoftInputMode) instead; a KAV
          there would double-shift, so behavior is left undefined. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
        style={s.kav}
      >
      <StepHeader step={5} total={6} eyebrow="Step 5 of 6" title="Pick your first film" onBack={onBack} />
      <Text style={s.sub}>We'll build a word list from its script — start with one you'd love to understand.</Text>

      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color={tc.textFaint} />
        <TextInput
          style={s.searchInput}
          placeholder="Search for another film"
          placeholderTextColor={tc.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={tc.textFaint} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {loading && grid.length === 0 ? (
          <ActivityIndicator color={tc.gold} style={{ marginTop: 32 }} />
        ) : (
          <View style={s.grid}>
            {grid.map((m) => {
              const on = selected?.tmdb_id === m.tmdb_id;
              return (
                <Pressable
                  key={m.tmdb_id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={m.title}
                  onPress={() => { Keyboard.dismiss(); onSelect(m); }}
                  style={[s.card, { borderColor: on ? tc.gold : tc.border }]}
                >
                  <TmdbPoster tmdbId={m.tmdb_id} style={s.poster} />
                  <View style={s.cardInfo}>
                    <Text style={s.cardTitle} numberOfLines={1}>{m.title}</Text>
                    {m.year ? <Text style={s.cardYear}>{m.year}</Text> : null}
                    {on ? (
                      <View style={s.badge}>
                        <Ionicons name="checkmark" size={14} color={tc.goldDeep} />
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <OnboardingCTA label="Start learning →" onPress={onContinue} disabled={!selected} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    kav: { flex: 1 },
    sub: { paddingHorizontal: 18, paddingTop: 6, fontSize: 13.5, color: tc.textSecondary },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 18,
      marginTop: 14,
      paddingHorizontal: 12,
      height: 42,
      borderRadius: 12,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
    },
    searchInput: { flex: 1, fontSize: 15, color: tc.text, paddingVertical: 0 },
    scroll: { flex: 1 },
    scrollContent: { padding: 18, paddingTop: 14 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    card: {
      width: '47%',
      flexGrow: 1,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: tc.paper,
      borderWidth: 2,
    },
    poster: { width: '100%', height: 150 },
    cardInfo: { padding: 10, position: 'relative' },
    cardTitle: { fontFamily: SERIF_FAMILY, fontSize: 15, fontWeight: '700', letterSpacing: -0.2, color: tc.text },
    cardYear: { fontSize: 12, color: tc.textSecondary, marginTop: 2 },
    badge: {
      position: 'absolute',
      top: -22,
      right: 10,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: tc.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
