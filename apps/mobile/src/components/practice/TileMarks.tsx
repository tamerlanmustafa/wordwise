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
 * Grooves come in two builds, and which one a mark uses is decided by what it
 * is made of rather than by taste. The check and the lock are *drawings*, so
 * they stroke and fill the same shape three times in SVG. The lesson number
 * and START are *characters*, and no amount of SVG will set a numeral as well
 * as the text engine will — so they stack two copies of a `Text` with opposite
 * shadows instead. Same three layers either way; see {@link Letterpress}.
 *
 * ## Three fixed zones
 *
 * Leading end: the lesson number, on every tile. Centre: whatever the state
 * says — check, START, or lock. Trailing end: the scuff, on completed tiles.
 *
 * The zones are fixed, and that is a reversal worth recording. The check used
 * to sit off-centre and alternate sides by index, because a mark repeating in
 * one spot draws a vertical stripe down a path that bends. Numbering every
 * tile puts a deliberate column down the leading edge regardless, so there is
 * no stripe left to avoid — and three marks that each have one home read as a
 * layout, where the same three with one of them jumping about read as drift.
 *
 * Positions use `start`/`end` rather than `left`/`right` for the RTL scan in
 * `i18n/__tests__/rtl.test.ts`. That is the correct behaviour here and not
 * just guard-appeasement: the number is text, so under a right-to-left UI it
 * belongs on the right, where that reader's eye starts.
 */

import { useId } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { MONO_FAMILY } from '../../theme/fonts';
import { shade, useThemeColors } from '../../theme/tokens';
import { NOSING_INSET } from './TilePill';
import { CHECK_FLOOR_DARKEN, type TileMark } from './tileVisuals';

/** Kept for the scuff's trailing-side anchor; the marks no longer alternate. */
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

/** Painted size of the scuff — wider and taller than the check, because the
 *  heel trails below and behind the ball. */
export const SCUFF_W = 44;
export const SCUFF_H = 40;

/** Top of the scuff. The check needs no equivalent — it is centred on both
 *  axes, and on a 56pt tread a 30pt box centres to exactly this, which is why
 *  the two marks still share a baseline. */
export const MARK_TOP = 13;

/**
 * Where the scuff is worn, on the trailing side of the tread.
 *
 * It used to alternate sides by tile index, to stop a mark repeating in one
 * spot from drawing a vertical stripe down a path that bends. That job is
 * gone: the lesson number now occupies the leading end of EVERY tile on
 * purpose, so the flight has a deliberate column in it either way, and the
 * leading half is spoken for. Three fixed zones — number, check, scuff — read
 * as a layout; the same three with one of them jumping about reads as drift.
 */
export const SCUFF_START = 132;

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

export interface TileMarksProps {
  /** Which centre mark, from {@link tileMark}. */
  mark: TileMark;
  /** 1-based lesson this tile is, cut into the leading end. */
  lesson: number;
  /** Groove floor for the tread's text, from `tileVisual().markInk`. */
  ink: string;
  /** The one locked tile directly above the active one — its lock is cut a
   *  little deeper than the rest of the road ahead. */
  nextUp?: boolean;
}

export function TileMarks({ mark, lesson, ink, nextUp = false }: TileMarksProps) {
  return (
    <>
      <LessonNumber lesson={lesson} ink={ink} />
      {mark === 'check' ? <CompletedMark /> : null}
      {mark === 'start' ? <StartMark ink={ink} /> : null}
      {mark === 'lock' ? <LockMark emphasised={nextUp} /> : null}
    </>
  );
}

/**
 * A check cut into the tread, and a worn patch where a foot landed.
 *
 * The scuff is what makes the check read as *history* rather than as a status
 * icon: someone walked here. Two soft ellipses, ball and heel, at opacities
 * low enough to be felt before they are seen.
 */
function CompletedMark() {
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

      <View pointerEvents="none" style={[styles.mark, { top: MARK_TOP, start: SCUFF_START }]}>
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
 * Text cut into the tread.
 *
 * React Native gives a `Text` exactly one `textShadow*` set, and a letterpress
 * needs two — dark above the glyph, light below it. So the string is drawn
 * twice in the same place: the lower copy first carrying the light shadow, the
 * upper copy over it carrying the dark one. The glyphs are identical and
 * opaque, so they cover each other exactly and only the shadows survive the
 * overlap.
 *
 * The absolute-fill second copy is sized by the first, which is why the pair
 * is wrapped in a bare `View` — that wrapper is the shared box, and without it
 * the copy would fill the whole tread and set its text somewhere else.
 */
function Letterpress({ text, style }: { text: string; style: TextStyle }) {
  return (
    <View>
      <Text style={[style, styles.pressLit]}>{text}</Text>
      <Text style={[style, styles.pressCut, StyleSheet.absoluteFill]}>{text}</Text>
    </View>
  );
}

/**
 * Which lesson this tile is — the number carved into its leading end.
 *
 * On every tile, including the road ahead, because its job is navigation
 * rather than reward: the path now renders thirty locked tiles, and three
 * screens of near-identical stone with nothing written on them is a place you
 * cannot tell your position in. A number is the cheapest possible answer to
 * "where am I", and unlike every score we could show here it is available
 * without asking the server for anything — the tile already knows its index.
 *
 * It is an ADDRESS, not an achievement, and the distinction matters if anyone
 * is ever tempted to label it: `users.practice_lessons_completed` is merged
 * with GREATEST across devices and was never backfilled, so tile 47 is a
 * position on the road and emphatically not a receipt for 47 finished
 * sessions.
 */
function LessonNumber({ lesson, ink }: { lesson: number; ink: string }) {
  return (
    <View pointerEvents="none" style={styles.lessonSlot}>
      <Letterpress text={String(lesson)} style={{ ...styles.lesson, color: ink }} />
    </View>
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
 * Cut with the same {@link Letterpress} the lesson number uses — they are the
 * two pieces of text on the tread, and one construction for both is what stops
 * them drifting into two different-looking engravings.
 */
function StartMark({ ink }: { ink: string }) {
  const { t } = useTranslation('practice');

  return (
    <View pointerEvents="none" style={styles.centred}>
      <Letterpress text={t('start')} style={{ ...styles.start, color: ink }} />
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
  // The leading end, inset to the same 12pt the nosing stops at — so the
  // number, the tread's lit lip and the tile's corner all break at one line.
  lessonSlot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: NOSING_INSET,
    justifyContent: 'center',
  },
  lesson: {
    fontFamily: MONO_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
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
  pressLit: {
    textShadowColor: 'rgba(255,255,255,0.60)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 0.6,
  },
  pressCut: {
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
