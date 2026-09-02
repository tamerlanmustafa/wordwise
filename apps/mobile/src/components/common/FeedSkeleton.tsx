/**
 * FeedSkeleton — loading placeholder for the home ranked feed (Motion §E3).
 *
 * It draws one silhouette per `RankedMovieList` card: a full-width tile of
 * exactly `CARD_H` at `CARD_RADIUS`, spaced by `CARD_GAP`, with faint blocks
 * where the level ring, the title and the meta line will land.
 *
 * It used to draw something else entirely — a 64x96 portrait poster with two
 * text lines beside it, which was the feed's row layout *before* the card
 * redesign made every row a 116pt full-width backdrop tile. Nothing broke when
 * the card changed; the skeleton simply carried on describing a screen that no
 * longer existed. That is the failure mode worth naming: a placeholder cannot
 * be wrong loudly. It renders, it animates, it looks deliberate, and the only
 * symptom is that the feed visibly re-lays-out the instant the data arrives —
 * which reads as jank, not as a stale component.
 *
 * The geometry now comes from `cardVisuals`, which the real card reads too, so
 * the two cannot drift apart again.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import {
  CARD_GAP,
  CARD_H,
  CARD_PAD_START,
  CARD_RADIUS,
  CARD_ROW_GAP,
  RING_SIZE,
} from '../home/cardVisuals';
import { Skeleton } from '../ui/Skeleton';

export interface FeedSkeletonProps {
  /** Number of placeholder cards. Defaults to 4 — what the feed panel shows
   *  at rest (`VISIBLE_CARDS`), so the strip is the height it will become. */
  rows?: number;
}

export function FeedSkeleton({ rows = 4 }: FeedSkeletonProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.container}>
      {Array.from({ length: rows }).map((_, i) => (
        // The tile itself is a plain View at the card's exact size; the
        // Skeleton primitives are the contents that pulse inside it. Animating
        // the whole 116pt slab would strobe a third of the screen.
        <View key={i} style={s.card}>
          <View style={s.row}>
            <Skeleton
              width={RING_SIZE}
              height={RING_SIZE}
              radius={RING_SIZE / 2}
              sheen
              delay={i * 70}
            />
            <View style={s.info}>
              <Skeleton width="72%" height={16} radius={5} sheen delay={i * 70 + 40} />
              <Skeleton
                width="34%"
                height={9}
                radius={4}
                sheen
                delay={i * 70 + 80}
                style={s.metaLine}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    // No horizontal padding: the real feed's cards run edge to edge inside
    // their own panel, and insetting the placeholder would slide every card
    // sideways the moment the list took over.
    container: { paddingTop: 0 },
    card: {
      height: CARD_H,
      marginBottom: CARD_GAP,
      borderRadius: CARD_RADIUS,
      backgroundColor: tc.cardStock,
      borderWidth: 1,
      borderColor: tc.border,
      overflow: 'hidden',
    },
    row: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingStart: CARD_PAD_START,
      paddingEnd: 12,
      gap: CARD_ROW_GAP,
    },
    // Matches the card's own `info` block, whose paddingEnd clears the add
    // glyph in the trailing corner.
    info: { flex: 1, paddingEnd: 30 },
    // The real card sets `marginTop: 7` on the year line under the title.
    metaLine: { marginTop: 7 },
  });
