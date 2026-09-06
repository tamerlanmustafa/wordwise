/**
 * LevelRing — how many distinct words a film speaks, drawn as an arc against
 * a typical film on the reader's shelf (see `filmVocabulary`).
 *
 * Extracted out of `RankedMovieList` so the feed card and `MovieDetailHero`
 * draw the exact same ring off the exact same data rather than two copies
 * that could drift apart. Geometry and colour rules are unchanged from the
 * card: gold arc, ink count, stock-filled hole so the backdrop can't show
 * through it.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { MONO_FAMILY } from '../../theme/fonts';
import type { ThemeColors } from '../../theme/tokens';
import { formatCompactCount } from '../../utils/formatting';
import { RING_C, RING_HOLE, RING_R, RING_SIZE, RING_STROKE, ringDashOffset } from './cardVisuals';
import type { FilmVocabulary } from './filmVocabulary';

const RING_MID = RING_SIZE / 2;

export interface LevelRingProps {
  vocab: FilmVocabulary | null;
  /** The word under the count, already translated. Passed in rather than
   *  looked up here so a cell that FlashList recycles doesn't take an i18n
   *  context subscription per row. */
  caption: string;
  tc: ThemeColors;
  /** Fills the ring's hole — must match whatever surface sits behind it
   *  (the feed card's stock colour, the hero's page background, ...). */
  holeColor: string;
}

export const LevelRing = React.memo(({ vocab, caption, tc, holeColor }: LevelRingProps) => {
  const s = useMemo(() => makeStyles(tc, holeColor), [tc, holeColor]);
  return (
    <View style={s.ring}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_MID}
          cy={RING_MID}
          r={RING_R}
          strokeWidth={RING_STROKE}
          stroke={tc.cardRingTrack}
          fill="none"
        />
        {vocab ? (
          <Circle
            cx={RING_MID}
            cy={RING_MID}
            r={RING_R}
            strokeWidth={RING_STROKE}
            stroke={tc.cardMeta}
            fill="none"
            strokeDasharray={RING_C}
            strokeDashoffset={ringDashOffset(vocab.fill)}
            strokeLinecap="butt"
            transform={`rotate(-90 ${RING_MID} ${RING_MID})`}
          />
        ) : null}
      </Svg>
      <View style={s.holeWrap} pointerEvents="none">
        <View style={s.hole}>
          {/* No distribution → bare track and an em dash. `0` would read as
              "this film has nothing for you", which is a claim; the dash is
              not. */}
          <Text style={s.pct} numberOfLines={1} adjustsFontSizeToFit>
            {vocab ? formatCompactCount(vocab.words) : '—'}
          </Text>
          {vocab ? (
            <Text style={s.caption} numberOfLines={1} adjustsFontSizeToFit>
              {caption}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const makeStyles = (tc: ThemeColors, holeColor: string) =>
  StyleSheet.create({
    ring: {
      width: RING_SIZE,
      height: RING_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    holeWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hole: {
      width: RING_HOLE,
      height: RING_HOLE,
      borderRadius: RING_HOLE / 2,
      backgroundColor: holeColor,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    pct: {
      width: RING_HOLE - 4,
      textAlign: 'center',
      fontFamily: MONO_FAMILY,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: -0.36,
      lineHeight: 12,
      color: tc.cardInk,
    },
    caption: {
      width: RING_HOLE - 4,
      textAlign: 'center',
      fontFamily: MONO_FAMILY,
      fontSize: 6.5,
      fontWeight: '700',
      letterSpacing: 0.65,
      lineHeight: 8,
      color: tc.cardMeta,
    },
  });
