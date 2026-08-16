/**
 * PosterFan — the up-to-three overlapping posters that stand in for a film
 * list on the index.
 *
 * Each card is ringed in the row's surface colour so they separate against
 * one another; the first poster sits on top, which is why the array is
 * painted in reverse and z-ordered back to front.
 *
 * Fewer than three posters centre in the box rather than hugging the start
 * edge, so a one-film list doesn't look like a layout bug. Zero posters
 * renders the dashed empty tile (§8) instead — the row still exists, because
 * `Saved from Home` is always present even when nothing is saved.
 */

import { useMemo } from 'react';
import { I18nManager, Image, StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { METRICS } from './listStyles';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w185';

interface Props {
  posters: string[];
  /** Surface the row is painted on — the separating ring matches it. */
  surface: string;
}

export function PosterFan({ posters, surface }: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const shown = posters.slice(0, 3);

  if (shown.length === 0) return <EmptyPosterTile />;

  // The fan opens toward the end edge, so it mirrors under RTL.
  const dir = I18nManager.isRTL ? -1 : 1;
  const spread = (shown.length - 1) * METRICS.posterOffset;
  const startOffset = (METRICS.fanBoxW - METRICS.posterW - spread) / 2;

  return (
    <View style={s.box}>
      {shown
        .map((path, i) => ({ path, i }))
        .reverse()
        .map(({ path, i }) => (
          <Image
            key={`${path}-${i}`}
            source={{ uri: `${TMDB_IMAGE_BASE}${path}` }}
            style={[
              s.poster,
              {
                borderColor: surface,
                start: startOffset + dir * i * METRICS.posterOffset,
                zIndex: shown.length - i,
              },
            ]}
          />
        ))}
    </View>
  );
}

/** §8 — the "nothing saved yet" tile: dashed gold hairline, a small plus,
 *  no text. The words underneath carry the instruction. */
export function EmptyPosterTile() {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={s.box}>
      <View style={s.empty}>
        <Text style={[s.emptyPlus, { color: tc.goldOnSurface }]}>+</Text>
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  box: {
    width: METRICS.fanBoxW,
    height: METRICS.posterH,
    justifyContent: 'center',
  },
  poster: {
    position: 'absolute',
    width: METRICS.posterW,
    height: METRICS.posterH,
    borderRadius: METRICS.posterRadius,
    borderWidth: 1.5,
    backgroundColor: tc.chipBg,
  },
  empty: {
    width: METRICS.posterW,
    height: METRICS.posterH,
    borderRadius: METRICS.posterRadius,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tc.goldLine,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  emptyPlus: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 20,
  },
});
