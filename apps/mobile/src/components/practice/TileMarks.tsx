/**
 * TileMarks — what is cut into a practice tile's tread.
 *
 * ## Every mark is a groove, never a glyph
 *
 * A flat check drawn on a stair tread reads as a sticker. The same check
 * *engraved* reads as part of the stone, and the difference is three layers
 * drawn in one order:
 *
 *   1. a dark copy offset **up**    — the lip of the groove in shadow,
 *   2. a light copy offset **down** — the lip catching the light,
 *   3. the shape itself at zero offset, thinner, in a colour darker than the
 *      tile face — the floor of the groove.
 *
 * The direction is the whole trick and it is easy to get backwards. Light in
 * this design comes from above: that is what the tread's occlusion band and
 * its lit nosing already say (see `TilePill`). Swap layers 1 and 2 and the
 * mark embosses instead of engraving — it stands *out* of a surface that
 * everything around it says is lit from above, and the tile stops reading as
 * stone. The giveaway on a screenshot is which side of the stroke carries the
 * light edge: lower is cut, upper is raised.
 *
 * Drawn in SVG rather than as text or an icon font because a groove needs the
 * same path stroked three times at two widths, which is a drawing and not a
 * character.
 *
 * ## The check is centred; the scuff is what alternates
 *
 * The check sits dead centre of its tread, the same place the lock and the
 * START label sit. That is worth stating because it was not free: nine tiles
 * climb the screen on a zigzag, and a mark pinned to the same spot on every
 * face draws a vertical stripe straight down the flight — a line the path does
 * not have. The check having a *fixed* home is what makes the three states
 * read as one family rather than three differently-placed badges, so the job
 * of breaking that stripe moved entirely to the scuff, which alternates sides
 * by tile index and is faint enough to vary without drawing a second line.
 *
 * The scuff's two positions are mirror images about the tread's centre, which
 * is why one is derived from the other rather than typed twice, and both clear
 * the centred check by a margin a test asserts.
 *
 * Positions use `start`/`end` rather than `left`/`right` for the RTL scan in
 * `i18n/__tests__/rtl.test.ts`. Mirroring them is harmless here: the flight
 * is symmetric about its own centre line, so a mirrored path is the same
 * picture with the alternation starting on the other side.
 */

import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { MONO_FAMILY } from '../../theme/fonts';
import { shade, useThemeColors } from '../../theme/tokens';
import { TILE_W } from './TilePill';
import type { TileMark } from './tileVisuals';

/** Which side of the tread the scuff is worn into. The check is centred and
 *  takes no side. */
export type MarkSide = 'left' | 'right';

/** Painted size of the check. */
export const CHECK_BOX = 30;
/** The check, as one stroke. Drawn in a 24×24 box and scaled up, so the three
 *  layers' offsets stay in one coordinate system. */
const CHECK_PATH = 'M4.4 12.9L9.7 18.1L19.8 6.7';
/** Stroke width of the two lip layers, and of the groove floor. The floor is
 *  thinner so the lips show either side of it. */
export const CHECK_LIP_W = 3.7;
export const CHECK_FLOOR_W = 2.9;
/** How much darker than `nodeDone` the groove's floor sits. It is the tile's
 *  own colour in shadow, not a second green. */
export const CHECK_FLOOR_DARKEN = 0.14;

/** Painted size of the scuff — wider and taller than the check, because the
 *  heel trails below and behind the ball. */
export const SCUFF_W = 44;
export const SCUFF_H = 40;

/** Top of the scuff. The check needs no equivalent — it is centred on both
 *  axes, and on a 56pt tread a 30pt box centres to exactly this, which is why
 *  the two marks still share a baseline. */
export const MARK_TOP = 13;

/** The x a `mirrorWidth`-wide box needs to sit exactly opposite a
 *  `width`-wide box at `start`, about the tread's centre. Exported so the
 *  symmetry is asserted rather than eyeballed: a mark that runs past the
 *  tread is silently cropped by the face's `overflow: 'hidden'`, which looks
 *  like a design choice on a screenshot and like a bug on a phone. */
export function mirroredStart(start: number, width: number, mirrorWidth: number): number {
  return TILE_W - (start + width / 2) - mirrorWidth / 2;
}

/** Where the scuff falls when it is worn into the trailing side of the tread.
 *  Far enough out that it clears the centred check. */
const SCUFF_START_TRAILING = 132;
/** Both scuff positions. The leading one is *derived* rather than typed, so
 *  the pair cannot drift apart the way two hand-tuned numbers do. */
export const SCUFF_START: Record<MarkSide, number> = {
  right: SCUFF_START_TRAILING,
  left: mirroredStart(SCUFF_START_TRAILING, SCUFF_W, SCUFF_W),
};

/**
 * The lock's two layers, at both weights.
 *
 * `nextUp` is the tile immediately above the active one — the next step you
 * will actually take, and the only one on the road ahead worth reading. Every
 * other locked tile stays at `base`, so the flight recedes into the distance
 * instead of ending in a wall of locks.
 */
export const LOCK_INK = {
  base: { light: 'rgba(255,255,255,0.13)', dark: 'rgba(0,0,0,0.50)' },
  nextUp: { light: 'rgba(255,255,255,0.17)', dark: 'rgba(0,0,0,0.58)' },
} as const;

/** Which side of the tread tile `index` wears its scuff on. Pure + exported so
 *  the alternation is testable without rendering nine tiles. */
export function markSideForIndex(index: number): MarkSide {
  return ((index % 2) + 2) % 2 === 0 ? 'right' : 'left';
}

export interface TileMarksProps {
  /** Which mark, from {@link tileMark}. */
  mark: TileMark;
  /** Side for the completed tile's scuff; ignored by the others. */
  side: MarkSide;
  /** The one locked tile directly above the active one — its lock is cut a
   *  little deeper than the rest of the road ahead. */
  nextUp?: boolean;
}

export function TileMarks({ mark, side, nextUp = false }: TileMarksProps) {
  if (mark === 'check') return <CompletedMark side={side} />;
  if (mark === 'start') return <StartMark />;
  if (mark === 'lock') return <LockMark emphasised={nextUp} />;
  return null;
}

/**
 * A check cut into the tread, and a worn patch where a foot landed.
 *
 * The scuff is what makes the check read as *history* rather than as a status
 * icon: someone walked here. Two soft ellipses, ball and heel, at opacities
 * low enough to be felt before they are seen.
 */
function CompletedMark({ side }: { side: MarkSide }) {
  const tc = useThemeColors();
  // Unique per mount: react-native-svg resolves `url(#id)` per Svg root on
  // native, and this keeps that true if the path is ever rendered on web.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <>
      <View pointerEvents="none" style={styles.centred}>
        <Svg width={CHECK_BOX} height={CHECK_BOX} viewBox="0 0 24 24">
          {/* 1 — the lip in shadow, above the stroke. */}
          <Path
            d={CHECK_PATH}
            fill="none"
            stroke="rgba(0,0,0,0.46)"
            strokeWidth={CHECK_LIP_W}
            strokeLinecap="round"
            strokeLinejoin="round"
            transform="translate(0, -0.4)"
          />
          {/* 2 — the lip catching light, below it. */}
          <Path
            d={CHECK_PATH}
            fill="none"
            stroke="rgba(255,255,255,0.44)"
            strokeWidth={CHECK_LIP_W}
            strokeLinecap="round"
            strokeLinejoin="round"
            transform="translate(0, 1)"
          />
          {/* 3 — the floor of the groove: the tile's own green, in shadow. */}
          <Path
            d={CHECK_PATH}
            fill="none"
            stroke={shade(tc.nodeDone, -CHECK_FLOOR_DARKEN)}
            strokeWidth={CHECK_FLOOR_W}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>

      <View pointerEvents="none" style={[styles.mark, { top: MARK_TOP, start: SCUFF_START[side] }]}>
        <Svg width={SCUFF_W} height={SCUFF_H}>
          {/* Radial-gradient fills rather than a blurred shape: CSS
              `filter: blur()` has no React Native equivalent, and an SVG
              `feGaussianBlur` is both slower and softer at the rim than this
              on Android. Two gradients because the two prints differ in
              weight — a heel bears less than a ball. */}
          <Defs>
            <RadialGradient id={`ball${uid}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#fff" stopOpacity={0.12} />
              <Stop offset="1" stopColor="#fff" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id={`heel${uid}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#fff" stopOpacity={0.1} />
              <Stop offset="1" stopColor="#fff" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse
            cx={22}
            cy={12}
            rx={15}
            ry={10}
            fill={`url(#ball${uid})`}
            transform="rotate(-14, 22, 12)"
          />
          <Ellipse
            cx={17}
            cy={32}
            rx={7.5}
            ry={5.5}
            fill={`url(#heel${uid})`}
            transform="rotate(-14, 17, 32)"
          />
        </Svg>
      </View>
    </>
  );
}

/**
 * The one labelled tile on the path.
 *
 * It is also the only moving one — the active tile bounces — and that is
 * deliberate rather than a collision: the word and the motion are the same
 * claim made twice on the one tile the user can actually tap, and nowhere
 * else on the flight competes with it.
 *
 * Letterpress needs two shadows, one above and one below, and React Native's
 * `Text` carries exactly one `textShadow*` set. So the word is drawn twice in
 * the same place: the lower copy first with the light shadow under it, the
 * upper copy over it with the dark shadow above. The glyphs are identical and
 * opaque, so only the shadows survive the overlap.
 */
function StartMark() {
  const { t } = useTranslation('practice');
  const tc = useThemeColors();
  const label = t('start');

  return (
    <View pointerEvents="none" style={styles.centred}>
      <View>
        <Text style={[styles.start, styles.startLit, { color: tc.goldDeep }]}>{label}</Text>
        <Text
          style={[styles.start, styles.startCut, { color: tc.goldDeep }, StyleSheet.absoluteFill]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Painted size of one lock layer. */
const LOCK_BOX = 20;
/** How far the light layer sits below the dark one. The container is this much
 *  taller than a layer so the offset copy is not clipped. */
const LOCK_LIP = 1.2;
/** Shackle and body, shared by both layers. Stroked open on top, solid below —
 *  a lock is a bar over a block, and drawing it as one path loses that. */
const LOCK_SHACKLE = 'M8.4 10.6V7.4a3.6 3.6 0 0 1 7.2 0v3.2';

/**
 * The road ahead, and how loud it is allowed to be.
 *
 * Two flat layers rather than three: a lock is small enough that a third
 * stroke closes its keyhole. The keyhole is punched through the dark layer
 * only, filled with the tile's own face colour, so it reads as a hole in the
 * stone rather than as a darker mark on it.
 *
 * Barely legible at arm's length is the target, not a bug — see
 * {@link LOCK_INK} for which tile is allowed to be louder than that.
 */
function LockMark({ emphasised }: { emphasised: boolean }) {
  const tc = useThemeColors();
  const { light, dark } = emphasised ? LOCK_INK.nextUp : LOCK_INK.base;

  return (
    <View pointerEvents="none" style={styles.centred}>
      <View style={styles.lockBox}>
        <View style={styles.lockLight}>
          <LockShape color={light} />
        </View>
        <View style={styles.lockDark}>
          <LockShape color={dark} keyhole={tc.nodeLocked} />
        </View>
      </View>
    </View>
  );
}

function LockShape({ color, keyhole }: { color: string; keyhole?: string }) {
  return (
    <Svg width={LOCK_BOX} height={LOCK_BOX} viewBox="0 0 24 24">
      <Path
        d={LOCK_SHACKLE}
        fill="none"
        stroke={color}
        strokeWidth={2.1}
        strokeLinecap="round"
      />
      <Rect x={4.7} y={10.2} width={14.6} height={10.5} rx={2.9} fill={color} />
      {keyhole ? (
        <>
          <Circle cx={12} cy={14.4} r={1.45} fill={keyhole} />
          <Rect x={11.2} y={14.4} width={1.6} height={3.2} rx={0.8} fill={keyhole} />
        </>
      ) : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  // Absolute, so no mark ever changes the face's layout — the face centres
  // whatever is left, and that is the repair tile's alarm alone.
  mark: {
    position: 'absolute',
  },
  centred: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  start: {
    fontFamily: MONO_FAMILY,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 4.6,
    // `letterSpacing` in React Native trails every character, including the
    // last, so the text box is one space wider than the word. Padding the
    // leading edge by the same amount puts the glyphs back on centre.
    paddingStart: 4.6,
  },
  // A hairline radius keeps both shadows crisp; Android drops a shadow layer
  // of radius 0 entirely, so this is not the same as omitting it.
  startLit: {
    textShadowColor: 'rgba(255,255,255,0.60)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 0.6,
  },
  startCut: {
    textShadowColor: 'rgba(0,0,0,0.20)',
    textShadowOffset: { width: 0, height: -1 },
    textShadowRadius: 0.6,
  },
  lockBox: {
    width: LOCK_BOX,
    height: LOCK_BOX + LOCK_LIP,
  },
  lockLight: {
    position: 'absolute',
    top: LOCK_LIP,
    start: 0,
  },
  lockDark: {
    position: 'absolute',
    top: 0,
    start: 0,
  },
});
