/**
 * MovieRow — v0.7 My Movies list row.
 *
 * 56×84 poster (with corner CEFR badge), title (Source Serif 4, 17pt),
 * meta line (year · director · runtime), thin progress bar +
 * `words known / total · %` in monospace, and a `›` chevron at the
 * right. Tapping the row hands off to the existing MoviePreviewHub via
 * `onPress`.
 *
 * Spec source: `tabs/my-movies.jsx → Row`. All pixel values match 1:1.
 */

import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { cefrColors } from '../../theme/palette';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import type { ReelTile } from '../../services/api';
import { alignEnd } from '../../i18n/rtl';

export interface MovieRowProps {
  tile: ReelTile;
  /** Director, runtime, words-total are NOT on the reel-tile payload
   *  — these come from a richer movie record if the caller has one.
   *  Optional so the row degrades cleanly when those fields are missing. */
  director?: string | null;
  runtime?: string | null;
  totalWords?: number | null;
  knownWords?: number | null;
  onPress: () => void;
}

const SERIF_FAMILY = 'Source Serif 4';
const MONO_FAMILY = 'JetBrains Mono';

function tmdb(path: string | null | undefined): string | null {
  return path ? `https://image.tmdb.org/t/p/w185${path}` : null;
}

export function MovieRow({
  tile,
  director,
  runtime,
  totalWords,
  knownWords,
  onPress,
}: MovieRowProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // The reel-tile payload doesn't carry CEFR today, so the badge is
  // hidden until inferCefrFromTile gains a real signal. Status +
  // comprehensibility are present and drive the progress fill / mastered
  // stamp below.
  const cefrKey = inferCefrFromTile(tile);
  const cefrColor = cefrKey ? cefrColors[cefrKey] : tc.textFaint;

  const progress = Math.max(0, Math.min(100, tile.comprehensibility_percent ?? 0));
  const progressColor = progress >= 100 ? tc.gold : cefrColor;

  // Right-side numeric block. Show "N/T · X%" when totals are known,
  // else just "X%".
  const numeric =
    typeof knownWords === 'number' && typeof totalWords === 'number'
      ? `${knownWords}/${totalWords} · ${Math.round(progress)}%`
      : `${Math.round(progress)}%`;

  const metaParts: string[] = [];
  if (tile.year != null) metaParts.push(String(tile.year));
  if (director) metaParts.push(director);
  if (runtime) metaParts.push(runtime);
  const meta = metaParts.join(' · ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.85 }]}
    >
      {/* poster + CEFR corner badge */}
      <View style={s.posterWrap}>
        {tile.poster_path ? (
          <Image source={{ uri: tmdb(tile.poster_path)! }} style={s.poster} resizeMode="cover" />
        ) : (
          <View style={[s.poster, { backgroundColor: tc.surface }]} />
        )}
        {cefrKey ? (
          <View style={[s.cefrBadge, { backgroundColor: cefrColor }]} pointerEvents="none">
            <Text style={s.cefrText}>{cefrKey}</Text>
          </View>
        ) : null}
        {/* Mastered movies get a small gold stamp in place of the CEFR
            corner — matches the tile-redesign intent without forcing a
            separate icon column. */}
        {tile.status === 'mastered' ? (
          <View style={s.finalCutStamp} pointerEvents="none">
            <Text style={s.finalCutText}>FINAL{'\n'}CUT</Text>
          </View>
        ) : null}
      </View>

      {/* meta column */}
      <View style={s.metaCol}>
        <Text style={s.title} numberOfLines={1}>
          {tile.title}
        </Text>
        {meta ? (
          <Text style={s.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}

        {/* progress + numeric */}
        <View style={s.progressRow}>
          <View style={[s.progressTrack, { backgroundColor: tc.divider }]}>
            <View
              style={[
                s.progressFill,
                { width: `${progress}%`, backgroundColor: progressColor },
              ]}
            />
          </View>
          <Text style={s.progressText}>{numeric}</Text>
        </View>
      </View>

      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

/** Best-effort CEFR inference. v0.7+: the ReelTile payload carries
 *  `cefr_level` from `Movie.difficultyLevel`; null when the user's
 *  added TMDB id has no internal Movie row yet (catalog ingest lag). */
function inferCefrFromTile(tile: ReelTile): keyof typeof cefrColors | null {
  return tile.cefr_level && tile.cefr_level in cefrColors
    ? (tile.cefr_level as keyof typeof cefrColors)
    : null;
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: tc.divider,
    },
    posterWrap: {
      width: 56,
      height: 84,
      borderRadius: 6,
      overflow: 'hidden',
      backgroundColor: tc.surface,
      position: 'relative',
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    poster: {
      width: '100%',
      height: '100%',
    },
    cefrBadge: {
      position: 'absolute',
      top: 4,
      start: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 3,
    },
    cefrText: {
      color: '#fff',
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 0.3,
    },
    finalCutStamp: {
      position: 'absolute',
      top: 4,
      end: 4,
      paddingHorizontal: 4,
      paddingVertical: 2,
      backgroundColor: tc.gold,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: tc.goldDeep,
    },
    finalCutText: {
      fontSize: 7,
      fontWeight: '900',
      color: tc.goldDeep,
      letterSpacing: 0.4,
      textAlign: 'center',
      lineHeight: 8,
    },
    metaCol: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 17,
      fontWeight: '600',
      color: tc.text,
      letterSpacing: -0.3,
      lineHeight: 19,
      marginBottom: 4,
    },
    meta: {
      fontSize: 11.5,
      fontWeight: '600',
      color: tc.textFaint,
      letterSpacing: 0.2,
      marginBottom: 8,
    },
    progressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    progressTrack: {
      flex: 1,
      height: 4,
      borderRadius: 999,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
    },
    progressText: {
      fontFamily: MONO_FAMILY,
      fontSize: 10.5,
      fontWeight: '800',
      color: tc.textSecondary,
      minWidth: 64,
      textAlign: alignEnd,
    },
    chevron: {
      fontSize: 18,
      fontWeight: '300',
      color: tc.textFaint,
    },
  });
