/**
 * TileMarks — what is drawn on a practice tile's tread.
 *
 * ## Every mark is flat
 *
 * They used to be grooves. Each mark was drawn two or three times — a dark
 * copy offset up for the lip in shadow, a light copy offset down for the lip
 * catching the light, and the shape itself between them as the floor — so a
 * check read as cut into stone rather than stuck onto it. The text marks did
 * the same trick with two stacked `Text` copies carrying opposite shadows,
 * because React Native gives a `Text` exactly one `textShadow` and a
 * letterpress needs two.
 *
 * All of it is gone, by decision: the tiles are simple now. A mark is one
 * stroke, one glyph, one colour. The tile's own depth still comes from
 * `TilePill` — the occlusion band, the lit nosing and the riser beneath the
 * face — so the flight still reads as a stack of steps; the things *written*
 * on it just no longer pretend to be carved.
 *
 * Worth knowing if the grooves are ever missed: they came back subtle enough
 * that the cost was never one obvious mistake, it was three drawing passes per
 * mark on every tile of a thirty-tile path.
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

import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { MONO_FAMILY } from '../../theme/fonts';
import { useThemeColors } from '../../theme/tokens';
import { NOSING_INSET } from './TilePill';
import { type TileMark } from './tileVisuals';

/** Painted size of the check. */
export const CHECK_BOX = 30;
/** The check, as one stroke. Drawn in a 24×24 box and scaled up, so the three
 *  layers' offsets stay in one coordinate system. */
const CHECK_PATH = 'M4.4 12.9L9.7 18.1L19.8 6.7';
/** Stroke width of the check. One stroke — the mark is drawn flat, not cut. */
export const CHECK_W = 3.0;

/** Top of the scuff. The check needs no equivalent — it is centred on both
 *  axes, and on a 56pt tread a 30pt box centres to exactly this, which is why
 *  the two marks still share a baseline. */
export const MARK_TOP = 13;


/**
 * The lock's ink, at both weights.
 *
 * `nextUp` is the tile immediately above the active one — the next step you
 * will actually take, and the only one on the road ahead worth reading. Every
 * other locked tile stays at `base`, so the flight recedes into the distance
 * instead of ending in a wall of locks. That distinction is about *legibility*
 * and survives the marks going flat; the second, lighter layer that used to
 * sit under each lock does not.
 */
export const LOCK_INK = {
  base: 'rgba(0,0,0,0.50)',
  nextUp: 'rgba(0,0,0,0.62)',
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
      {mark === 'check' ? <CompletedMark ink={ink} /> : null}
      {mark === 'start' ? <StartMark ink={ink} /> : null}
      {mark === 'lock' ? <LockMark emphasised={nextUp} /> : null}
    </>
  );
}

/**
 * A check cut into the tread.
 *
 * There used to be a scuff beside it — two soft white radial-gradient
 * ellipses, a ball and a heel, meant to read as a worn patch where a foot
 * landed and to make the check feel like *history* rather than like a status
 * icon. On a real screen it did not read as wear. It read as two bubbles
 * floating on the green, which is the failure mode of any texture drawn from
 * an idea of a thing rather than from the thing: at the opacity where it was
 * subtle enough not to be noticed as a footprint, it was still visible enough
 * to be noticed as *something*, and something unexplained on a flat surface is
 * a smudge. Removed rather than re-tuned.
 */
function CompletedMark({ ink }: { ink: string }) {
  return (
    <View pointerEvents="none" style={styles.centred}>
      <Svg width={CHECK_BOX} height={CHECK_BOX} viewBox="0 0 24 24">
        <Path
          d={CHECK_PATH}
          fill="none"
          stroke={ink}
          strokeWidth={CHECK_W}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
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
      <Text style={[styles.lesson, { color: ink }]}>{String(lesson)}</Text>
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
 * Set in the same flat `Text` the lesson number uses — they are the two pieces
 * of text on the tread, and one construction for both is what stops them
 * drifting into two different-looking labels.
 */
function StartMark({ ink }: { ink: string }) {
  const { t } = useTranslation('practice');

  return (
    <View pointerEvents="none" style={styles.centred}>
      <Text style={[styles.start, { color: ink }]}>{t('start')}</Text>
    </View>
  );
}

/** Painted size of one lock layer. */
const LOCK_BOX = 20;
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
  const ink = emphasised ? LOCK_INK.nextUp : LOCK_INK.base;

  return (
    <View pointerEvents="none" style={styles.centred}>
      <LockShape color={ink} keyhole={tc.nodeLocked} />
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
});
