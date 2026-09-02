/**
 * ListRow — one list on the index.
 *
 * A film row previews with a fan of posters; a word row with a single tile
 * plus its first three words. That asymmetry is deliberate: it is the payoff
 * of a list holding one kind only, and it means the user recognises a list
 * without opening it.
 *
 * The two pinned lists are marked by the gold hairline border and a gold
 * meta line — nothing else. No badge, no lock icon: they read as *yours and
 * always here*, not as *restricted*.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { FORWARD_ARROW } from '../../i18n/rtl';
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

interface Props {
  list: ListSummary;
  onPress: () => void;
}

/** The pinned lists store English defaults in the DB and render from
 *  `lists.system.*`, so their names localise without a write. */
export function useListDisplayName(list: ListSummary): string {
  const { t } = useTranslation('lists');
  if (list.systemKey === 'reel') return t('system.reel');
  if (list.systemKey === 'favourites') return t('system.favourites');
  return list.name;
}

export function ListRow({ list, onPress }: Props) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
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
      if (list.dueCount) parts.push(t('meta.dueCount', { count: list.dueCount }));
    }
    return parts.join(META_SEPARATOR);
  }, [isEmpty, isSystem, isFilms, list.count, list.totalWords, list.dueCount, t]);

  return (
    <TouchableOpacity
      style={[s.row, isSystem && { borderColor: tc.goldLine }]}
      onPress={onPress}
      activeOpacity={0.85}
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
    </TouchableOpacity>
  );
}

/** Favourites gets the heart; a custom word list gets its first letter, so
 *  two user-made lists are still distinguishable at a glance. */
function WordTile({ list }: { list: ListSummary }) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
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

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: METRICS.rowMinHeight,
    borderRadius: METRICS.rowRadius,
    backgroundColor: tc.paper,
    borderWidth: 1,
    borderColor: tc.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: METRICS.rowInnerGap,
    marginBottom: METRICS.rowGap,
    shadowColor: tc.cardShadowColor,
    shadowOpacity: 1,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
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
