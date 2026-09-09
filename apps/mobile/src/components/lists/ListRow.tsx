/**
 * ListRow — one list on the index.
 *
 * A film row previews with a fan of posters; a word row with a single tile
 * plus its first three words. That asymmetry is deliberate: it is the payoff
 * of a list holding one kind only, and it means the user recognises a list
 * without opening it.
 *
 * Each row is a pill — a face over a darker edge, which sinks under a finger
 * (see `ui/PressablePill`). The same object the film-feed card is, at a
 * different height: these rows grow with their content, which is why they use
 * the shared primitive rather than the card's fixed-height layers.
 *
 * The two pinned lists were marked by a gold hairline border and a gold meta
 * line — no badge, no lock icon, so they read as *yours and always here*
 * rather than as *restricted*. The border half of that no longer distinguishes
 * them: every row wears the gold rim now, so the meta line carries it alone.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, useColorScheme, withAlpha, type ThemeColors } from '../../theme/tokens';
import { FORWARD_ARROW } from '../../i18n/rtl';
import { withTap } from '../../utils/feedback';
import { PosterFan } from './PosterFan';
import {
  METRICS,
  META_SEPARATOR,
  listName,
  metaText,
  previewWords,
} from './listStyles';
import type { ListSummary } from '../../core/types';
import { HeartIcon } from '../ui/icons';
import { PressablePill } from '../ui/PressablePill';

interface Props {
  list: ListSummary;
  onPress: () => void;
  /** Just created. Flashes once and fades, then never again — see `Highlight`. */
  highlighted?: boolean;
}

/** The pinned lists store English defaults in the DB and render from
 *  `lists.system.*`, so their names localise without a write. */
export function useListDisplayName(list: ListSummary): string {
  const { t } = useTranslation('lists');
  if (list.systemKey === 'reel') return t('system.reel');
  if (list.systemKey === 'favourites') return t('system.favourites');
  return list.name;
}

export function ListRow({ list, onPress, highlighted = false }: Props) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const isDark = useColorScheme() === 'dark';
  const s = useMemo(() => makeStyles(tc, isDark), [tc, isDark]);
  const name = useListDisplayName(list);

  const isSystem = list.systemKey !== null;
  const isFilms = list.kind === 'films';
  const isEmpty = list.count === 0;

  const metaColor = isSystem ? tc.goldOnSurface : tc.textFaint;
  const meta = useMemo(() => {
    if (isEmpty && isSystem) return t('meta.nothingSaved');
    const parts: string[] = [];
    if (isFilms) {
      parts.push(t('meta.filmCount', { count: list.count }));
      if (list.totalWords) parts.push(t('meta.wordCount', { count: list.totalWords }));
    } else {
      parts.push(t('meta.wordCount', { count: list.count }));
    }
    return parts.join(META_SEPARATOR);
  }, [isEmpty, isSystem, isFilms, list.count, list.totalWords, t]);

  return (
    <PressablePill
      style={s.slot}
      faceStyle={s.row}
      edge={tc.nodeGoldEdge}
      radius={METRICS.rowRadius}
      edgeDepth={METRICS.rowEdge}
      shadow={s.edgeShadow}
      onPress={withTap(onPress)}
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${meta}`}
    >
      {isFilms ? (
        <PosterFan posters={list.preview.posters ?? []} surface={tc.paper} />
      ) : (
        <WordTile list={list} />
      )}

      <View style={s.body}>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
        <Text style={[s.meta, { color: metaColor }]} numberOfLines={1}>
          {meta}
        </Text>
        {!isFilms && (list.preview.words?.length ?? 0) > 0 ? (
          <Text style={s.preview} numberOfLines={1}>
            {(list.preview.words ?? []).join(META_SEPARATOR)}
          </Text>
        ) : null}
      </View>

      <Text style={s.chevron}>{FORWARD_ARROW}</Text>
      {highlighted ? <Highlight tc={tc} /> : null}
    </PressablePill>
  );
}

/**
 * The one-shot flash on a row that has just been created.
 *
 * Creating a list used to open it, which answered a question nobody asked:
 * the list is empty, so the reader was dropped on an empty screen and had to
 * come back to see the thing they made. Staying put and pointing at the new
 * row keeps them where they were and still shows the result.
 *
 * It fades rather than persisting, because the highlight's whole job is
 * "here, this one" at the moment of arrival — a marker that stayed would be
 * unexplained state a minute later, and there is no obvious gesture to
 * dismiss it. Non-native driver: it animates `backgroundColor`, which the
 * native driver cannot carry.
 */
function Highlight({ tc }: { tc: ThemeColors }) {
  const wash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(wash, { toValue: 1, duration: 180, useNativeDriver: false }),
      Animated.delay(700),
      Animated.timing(wash, { toValue: 0, duration: 600, useNativeDriver: false }),
    ]).start();
  }, [wash]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: METRICS.rowRadius,
          backgroundColor: wash.interpolate({
            inputRange: [0, 1],
            outputRange: [withAlpha(tc.gold, 0), withAlpha(tc.gold, 0.22)],
          }),
        },
      ]}
    />
  );
}

/** Favourites gets the heart; a custom word list gets its first letter, so
 *  two user-made lists are still distinguishable at a glance. */
function WordTile({ list }: { list: ListSummary }) {
  const tc = useThemeColors();
  const isDark = useColorScheme() === 'dark';
  const s = useMemo(() => makeStyles(tc, isDark), [tc, isDark]);
  const isFavourites = list.systemKey === 'favourites';
  const initial = (list.name.trim()[0] ?? '?').toUpperCase();

  return (
    <View
      style={[
        s.wordTile,
        { backgroundColor: isFavourites ? tc.goldWash : tc.chipBg },
      ]}
    >
      {isFavourites ? (
        <HeartIcon size={22} filled color={tc.gold} />
      ) : (
        <Text style={s.initial}>{initial}</Text>
      )}
    </View>
  );
}

const makeStyles = (tc: ThemeColors, isDark: boolean) => StyleSheet.create({
  /** Outer layout only. The gap between rows lives here, not on the face:
   *  the face no longer touches the next row — the edge does. */
  slot: {
    marginBottom: METRICS.rowGap,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: METRICS.rowMinHeight,
    borderRadius: METRICS.rowRadius,
    backgroundColor: tc.paper,
    // The rim the film-feed card and "Knew it" wear. Tokens, so #8B5A00 on
    // cream and #FFD166 on near-black come from the palette rather than from a
    // branch here.
    borderWidth: 1,
    borderColor: tc.goldOnSurface,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: METRICS.rowInnerGap,
    // No shadow — the edge underneath carries it. See PressablePill.
  },
  /**
   * Matches the film-feed card's, so a card and a list row sit at the same
   * height off the page.
   *
   * iOS only, and deliberately no `elevation`: on Android that property also
   * sets z-order, so an elevated edge draws *above* the face it is supposed to
   * sit under. The hard edge is the depth cue there — which is what every
   * other pill in the app relies on. See `ui/PressablePill`.
   */
  edgeShadow: {
    shadowColor: '#000',
    shadowOpacity: isDark ? 0.45 : 0.10,
    shadowRadius: isDark ? 16 : 12,
    shadowOffset: { width: 0, height: isDark ? 6 : 4 },
  },
  body: { flex: 1, gap: 3 },
  name: { ...listName, color: tc.text },
  meta: { ...metaText },
  preview: { ...previewWords, color: tc.textFaint },
  chevron: { fontSize: METRICS.chevron, color: tc.textFaint },
  wordTile: {
    width: METRICS.wordTileW,
    height: METRICS.wordTileH,
    borderRadius: METRICS.wordTileRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: { fontSize: 24 },
  initial: {
    ...listName,
    fontSize: 27,
    color: tc.textSecondary,
  },
});
