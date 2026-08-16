/**
 * The two item renderers inside an open list.
 *
 * They look deliberately unalike. A film is an object you pick — poster,
 * card-ish, with a state button. A word is something you read — no card at
 * all, just a reading column separated by hairlines. Making words look like
 * cards was tried and made a 40-word list feel like a filing cabinet.
 */

import { useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY } from '../../theme/fonts';
import { META_SEPARATOR, metaText } from './listStyles';
import type { ListFilmItem, ListWordItem } from '../../core/types';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w185';

/**
 * A film in an open list. The round button on the end holds a gold check;
 * tapping removes the film and the button becomes an outlined plus — so the
 * removal is reversible in place, and no undo toast is needed.
 */
export function FilmItemRow({
  item,
  inList,
  onToggle,
  onPress,
}: {
  item: ListFilmItem;
  inList: boolean;
  onToggle: () => void;
  onPress: () => void;
}) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const meta = [
    item.rating != null ? `★ ${item.rating.toFixed(1)}` : null,
    item.cefr,
  ].filter(Boolean).join(META_SEPARATOR);

  return (
    <TouchableOpacity style={s.filmRow} onPress={onPress} activeOpacity={0.85}>
      {item.posterPath ? (
        <Image source={{ uri: `${TMDB_IMAGE_BASE}${item.posterPath}` }} style={s.filmPoster} />
      ) : (
        <View style={[s.filmPoster, { backgroundColor: tc.chipBg }]} />
      )}

      <View style={s.filmBody}>
        <Text style={s.filmTitle} numberOfLines={2}>{item.title}</Text>
        {meta ? <Text style={s.filmMeta}>{meta}</Text> : null}
        {item.wordCount != null ? (
          <Text style={s.filmWords}>
            {t('meta.wordCount', { count: item.wordCount })}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        style={[
          s.stateBtn,
          inList
            ? { backgroundColor: tc.goldWash, borderColor: 'transparent' }
            : { borderColor: tc.goldLine },
        ]}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ selected: inList }}
      >
        <Text style={[s.stateGlyph, { color: tc.goldOnSurface }]}>
          {inList ? '✓' : '+'}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

/**
 * A word in an open list. The heart toggles Favourites and is silent — no
 * toast — exactly as it is in Explore, because the fill state is the
 * feedback and a toast per tap would be noise while skimming a list.
 */
export function WordItemRow({
  item,
  favourite,
  onToggleFavourite,
  onPress,
}: {
  item: ListWordItem;
  favourite: boolean;
  onToggleFavourite: () => void;
  onPress: () => void;
}) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const sub = [item.pos, t(`srs.${item.srsState}`)].filter(Boolean).join(META_SEPARATOR);

  return (
    <TouchableOpacity style={s.wordRow} onPress={onPress} activeOpacity={0.7}>
      <View style={s.wordBody}>
        <View style={s.wordHead}>
          <Text style={s.word} numberOfLines={1}>{item.word}</Text>
          {item.cefr ? (
            <View style={s.cefrPill}>
              <Text style={s.cefrText}>{item.cefr}</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.wordSub} numberOfLines={1}>{sub}</Text>
      </View>

      <TouchableOpacity
        style={[s.heartBtn, favourite && { backgroundColor: tc.goldWash }]}
        onPress={onToggleFavourite}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ selected: favourite }}
      >
        <Text style={[s.heart, { color: favourite ? tc.gold : tc.textFaint }]}>
          {favourite ? '♥' : '♡'}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  // ── Films
  filmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  filmPoster: { width: 52, height: 74, borderRadius: 3 },
  filmBody: { flex: 1, gap: 3 },
  filmTitle: { fontFamily: SERIF_FAMILY, fontSize: 15.5, fontWeight: '600', color: tc.text },
  filmMeta: { ...metaText, color: tc.goldOnSurface },
  filmWords: { ...metaText, color: tc.textFaint },
  stateBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateGlyph: { fontSize: 14, fontWeight: '700', lineHeight: 16 },

  // ── Words: a reading column, not cards.
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tc.divider,
  },
  wordBody: { flex: 1, gap: 3 },
  wordHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: { fontFamily: SERIF_FAMILY, fontSize: 20, color: tc.text, flexShrink: 1 },
  cefrPill: {
    borderWidth: 1,
    borderColor: tc.goldLine,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  cefrText: { ...metaText, color: tc.goldOnSurface, fontSize: 9.5 },
  wordSub: { fontFamily: SERIF_FAMILY, fontSize: 13, fontStyle: 'italic', color: tc.textFaint },
  heartBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: { fontSize: 18 },
});
