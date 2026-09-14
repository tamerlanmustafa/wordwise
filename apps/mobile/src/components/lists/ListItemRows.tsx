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
import { Skeleton } from '../ui/Skeleton';
import { HeartIcon, StarIcon } from '../ui/icons';
import { withTap } from '../../utils/feedback';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w185';

/**
 * Enough invisible slop to make a small round control a 44pt target.
 *
 * The check is 28pt and the heart 34pt — both sat at the edge of a row whose
 * body is itself pressable (a film row opens the film), so a thumb aiming at
 * the film and landing a few points right removed it instead.
 */
const hitSlopFor = (size: number) => {
  const pad = Math.max(0, Math.ceil((44 - size) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
};

/**
 * A film in an open list. The round button on the end holds a gold check, and
 * tapping it removes the film from the list — with an Undo in the toast.
 *
 * This comment used to promise that the button "becomes an outlined plus — so
 * the removal is reversible in place, and no undo toast is needed". Nothing
 * ever drew that plus: the screen hid the item the moment it was removed, so
 * the row simply vanished and there was no way back. The reversibility now
 * lives in the toast, where it actually exists.
 */
export function FilmItemRow({
  item,
  onRemove,
  onPress,
}: {
  item: ListFilmItem;
  /** Bare — the row wraps it, so the parent must not. */
  onRemove: () => void;
  onPress: () => void;
}) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // The rating's star is drawn beside the line rather than prefixed into it —
  // it was `★ 7.4`, a glyph inside the text run, so it took the meta line's
  // colour and size and sat on its baseline.
  const meta = [item.cefr].filter(Boolean).join(META_SEPARATOR);

  return (
    <TouchableOpacity style={s.filmRow} onPress={onPress} activeOpacity={0.85}>
      {item.posterPath ? (
        <Image source={{ uri: `${TMDB_IMAGE_BASE}${item.posterPath}` }} style={s.filmPoster} />
      ) : (
        <View style={[s.filmPoster, { backgroundColor: tc.chipBg }]} />
      )}

      <View style={s.filmBody}>
        <Text style={s.filmTitle} numberOfLines={2}>{item.title}</Text>
        <View style={s.filmMetaRow}>
          {item.rating != null ? (
            <>
              <StarIcon size={11} filled animate={false} />
              <Text style={s.filmMeta}>{item.rating.toFixed(1)}</Text>
            </>
          ) : null}
          {meta ? <Text style={s.filmMeta}>{meta}</Text> : null}
        </View>
        {item.wordCount != null ? (
          <Text style={s.filmWords}>
            {t('meta.wordCount', { count: item.wordCount })}
          </Text>
        ) : null}
      </View>

      <RemoveCheck
        onPress={onRemove}
        label={t('a11y.removeFromList', { item: item.title })}
        tc={tc}
        s={s}
      />
    </TouchableOpacity>
  );
}

/**
 * The trailing control on a list item that means "in this list".
 *
 * The same gold check on films and words, so a row's control says the same
 * thing wherever it appears: this is in the list, and tapping takes it out.
 * Its own accessible button — nested inside the film row's pressable body it
 * used to be merged into the row's single element, so VoiceOver had no way to
 * reach it on its own.
 */
function RemoveCheck({
  onPress,
  label,
  tc,
  s,
}: {
  onPress: () => void;
  label: string;
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      style={[s.stateBtn, { backgroundColor: tc.goldWash, borderColor: 'transparent' }]}
      onPress={withTap(onPress)}
      hitSlop={hitSlopFor(28)}
      activeOpacity={0.7}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[s.stateGlyph, { color: tc.goldOnSurface }]}>✓</Text>
    </TouchableOpacity>
  );
}

/**
 * A word in an open list.
 *
 * ## What the trailing control is depends on the list — and it used to lie
 *
 * On EVERY words list this drew a heart, filled only when the list was
 * Favourites, and on every list its tap removed the word. On a list the user
 * made — "Travel" — that meant an empty outline heart, which reads as
 * "favourite this", whose tap silently deleted the word from Travel instead.
 * No confirmation, no toast, no undo, and no add button on the screen to put
 * it back. It was also empty on words that WERE favourites, because the fill
 * came from which list was open rather than from the word.
 *
 * So the control is now named for what it does:
 *
 *  • `favourite` — Favourites itself. A filled heart; tapping un-hearts, which
 *    is what a filled heart promises.
 *  • `member`    — any other words list. The gold check films already use:
 *    "in this list", tap to take it out.
 *
 * Either way the removal carries an Undo, owned by the screen.
 *
 * The row body is deliberately NOT pressable. It used to be, and tapping a
 * word threw the user out of the list they were reading and into the old
 * saved-words notebook — every saved word, unfiltered, with no relationship
 * to the word tapped or the list it was in. That view is gone, and rather than
 * find the row somewhere else to go, the row simply stops claiming it goes
 * anywhere. A control that looks tappable and does nothing is worse than one
 * that never offered.
 */
export function WordItemRow({
  item,
  control,
  onRemove,
}: {
  item: ListWordItem;
  control: 'favourite' | 'member';
  /** Bare — the row wraps it, so the parent must not. */
  onRemove: () => void;
}) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const sub = [item.pos, t(`srs.${item.srsState}`)].filter(Boolean).join(META_SEPARATOR);

  return (
    <View style={s.wordRow}>
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

      {control === 'favourite' ? (
        <TouchableOpacity
          style={[s.heartBtn, { backgroundColor: tc.goldWash }]}
          onPress={withTap(onRemove)}
          hitSlop={hitSlopFor(34)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ selected: true }}
          accessibilityLabel={t('a11y.unfavourite', { item: item.word })}
        >
          <HeartIcon size={19} filled color={tc.gold} />
        </TouchableOpacity>
      ) : (
        <RemoveCheck
          onPress={onRemove}
          label={t('a11y.removeFromList', { item: item.word })}
          tc={tc}
          s={s}
        />
      )}
    </View>
  );
}

/**
 * Placeholder rows for an open list that is still loading.
 *
 * Lives here, beside the rows it stands in for, and draws itself with their
 * own `makeStyles` — so it is the real row's height by construction rather
 * than by a number someone remembered to copy.
 *
 * ListDetailScreen used to render three bare `Skeleton height={74}` blocks.
 * 74 is the *poster's* height, not the row's: a film row is 74 plus 10pt of
 * padding either side, so every placeholder was 20pt short. They also had no
 * gap between them, so the three ran together into one grey slab, and the
 * same shape was drawn for a words list, whose rows are shorter and carry no
 * poster at all.
 */
export function ListItemsSkeleton({ kind, rows = 4 }: { kind: 'films' | 'words'; rows?: number }) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View>
      {Array.from({ length: rows }).map((_, i) =>
        kind === 'films' ? (
          <View key={i} style={s.filmRow}>
            <Skeleton width={52} height={74} radius={3} sheen delay={i * 70} />
            <View style={s.filmBody}>
              <Skeleton width="68%" height={15} radius={4} sheen delay={i * 70 + 40} />
              <Skeleton width="40%" height={10} radius={4} sheen delay={i * 70 + 70} />
              <Skeleton width="52%" height={10} radius={4} sheen delay={i * 70 + 100} />
            </View>
            <Skeleton width={34} height={34} radius={17} sheen delay={i * 70 + 130} />
          </View>
        ) : (
          <View key={i} style={s.wordRow}>
            <View style={s.wordBody}>
              <Skeleton width="45%" height={20} radius={4} sheen delay={i * 70} />
              <Skeleton width="70%" height={10} radius={4} sheen delay={i * 70 + 50} />
            </View>
            <Skeleton width={28} height={28} radius={14} sheen delay={i * 70 + 90} />
          </View>
        ),
      )}
    </View>
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
  filmMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
