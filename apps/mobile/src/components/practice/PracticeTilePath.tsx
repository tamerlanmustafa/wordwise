/**
 * PracticeTilePath — v0.7.3 Duolingo-style endless chain.
 *
 * The path is a linear, never-ending sequence of lesson tiles. A single
 * client-side cursor (see `practicePathStore`) points at the user's
 * next active tile. Every tile is the same lesson — the path used to
 * rotate three kinds, one of which made the user pick a film first.
 *
 * Rendering window:
 *   • Show {@link WINDOW_SIZE} tiles around the cursor — up to
 *     {@link COMPLETED_BEHIND} completed tiles below (capped by what's
 *     actually been completed; a brand-new user shows zero), then the
 *     active tile, then {@link LOCKED_AHEAD} locked tiles above it.
 *   • The visible range is always WINDOW_SIZE rows; the window slides
 *     up as the user advances.
 *
 * ## The active tile's two positions
 *
 * Vertically it is pinned: the screen opens with it in the middle of the
 * visible path, on every screen height. Its place in the path is arithmetic
 * ({@link activeTileCenterY}), so the screen scrolls to it without measuring
 * the tiles. It used to open scrolled to the bottom with four completed tiles
 * under it, which on a 667pt iPhone SE left the active tile pressed against
 * the header with no road ahead in view.
 *
 * Horizontally it is the opposite — it must NOT be pinned. `offsetForIndex` is
 * keyed on the tile's absolute index, so as the cursor advances the active
 * tile walks along the wave (0 → 28 → 40 → 28 → 0 → -28 …) instead of sitting
 * in a fixed column. That is what makes progress feel like travelling a road
 * rather than watching a counter: the slot stays, the position on the path
 * does not. A fixed vertical slot plus a fixed horizontal offset would put
 * every session's active tile in the identical pixel, which is the version of
 * this that looks broken.
 *
 * State derivation rules (pure, per index `i`):
 *   • i  < cursor → 'completed'
 *   • i == cursor → 'active'
 *   • i  > cursor → 'locked'
 *
 * Vertical rhythm: the pills *are* the road. `buildWindow` returns tiles in
 * index order (past → future); {@link visualOrder} flips that for display so
 * the path climbs the screen — the road ahead is always above you, the road
 * behind sinks away below.
 *
 * The path itself doesn't know about session APIs or the free-tier daily
 * cap; the parent screen wires the tap of the active tile into the right
 * side-effects.
 */

import { memo, useMemo } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { PracticeTile, type PracticeTileState } from './PracticeTile';
import { TILE_BLOCK } from './TilePill';
import { withTap } from '../../utils/feedback';

/**
 * How many locked tiles to render above the active one.
 *
 * Sized by how far the user should be able to scroll, not by what fits: on the
 * shortest phone the app supports the scroller shows roughly six tiles, and
 * the ask is at least three full screens of road ahead. About three of these
 * are already on screen when the path opens with the active tile centred, so
 * the rest are what the user climbs into.
 *
 * It is the one number to change if the path should feel longer or shorter,
 * and it is the one that costs: every tile here is a `TilePill` plus a lock,
 * so raising it raises the mount cost of the whole tab.
 */
export const LOCKED_AHEAD = 30;
/**
 * How many completed tiles to render below the active one.
 *
 * History to scroll back into. It used to be 4, which was the point when the
 * path opened scrolled to the bottom: four tiles fixed the active one's slot.
 * Now the active tile is centred, so about half a screen of these is already
 * in view and the rest is scroll.
 *
 * Not the same 30 as the road ahead, and the reason is measured: every tile
 * rendered is paid for on the tab's first tap. On the iPhone 17 Pro simulator
 * after a cold start, 35 tiles drew their first frame at the baseline, 41 (this
 * value) about 25ms later, and 61 (thirty each way) about 85ms later — roughly
 * 3ms a tile, and more on a real phone. Ten is well over a screen of history on
 * every phone for a third of that.
 *
 * Capped by `cursor`, so a brand-new user has none — the screen pads the
 * bottom instead (see `bottomRunway`), because an empty row would be a
 * promise the path cannot keep.
 */
export const COMPLETED_BEHIND = 10;
/** Total tiles rendered at once. */
export const WINDOW_SIZE = COMPLETED_BEHIND + 1 + LOCKED_AHEAD;

/** The path's own padding above its first row and below its last. */
export const PATH_PAD_TOP = 6;
export const PATH_PAD_BOTTOM = 24;

/** How many completed tiles sit below the active one at this cursor — the
 *  one rule `buildWindow` and the geometry below both follow. */
export function completedBelow(cursor: number): number {
  return Math.min(COMPLETED_BEHIND, Math.max(0, cursor));
}

/**
 * The active tile's vertical centre, measured from the top of the path.
 *
 * Arithmetic, not a measurement: every row is one TILE_BLOCK tall, and the
 * window is always WINDOW_SIZE rows, so the rows above the active tile are
 * whatever the completed ones below it leave. That count moves with the cursor
 * until the history fills: a user on lesson 16 has 15 completed tiles below
 * and 45 locked above, not 30 — the window tops itself up with road ahead.
 * Assuming a constant here centred the path on tile 30-odd, measured.
 */
export function activeTileCenterY(cursor: number): number {
  const rowsAbove = WINDOW_SIZE - 1 - completedBelow(cursor);
  return PATH_PAD_TOP + rowsAbove * TILE_BLOCK + TILE_BLOCK / 2;
}

/** How much path lies below the active tile's centre at this cursor. Short
 *  for a new user, who has nothing completed under them yet. */
export function pathBelowActiveCenter(cursor: number): number {
  return TILE_BLOCK / 2 + completedBelow(cursor) * TILE_BLOCK + PATH_PAD_BOTTOM;
}

/** Horizontal sway of the road, as a smooth wave rather than a jitter: four
 *  steps out and four back, so consecutive tiles lean into each other the way
 *  a path bends. Keyed on each tile's *absolute* index (see
 *  {@link offsetForIndex}) rather than its rendered slot, so the shape scrolls
 *  past as the cursor advances — the road moves, instead of the window showing
 *  an identical frozen shape every session. */
const X_OFFSETS = [0, 28, 40, 28, 0, -28, -40, -28];

/** Horizontal zigzag offset for a tile at absolute path index. Pure +
 *  exported for unit testing. */
export function offsetForIndex(index: number): number {
  const n = X_OFFSETS.length;
  return X_OFFSETS[((index % n) + n) % n];
}

/** How many tiles make up one "section" — the landmark cadence. No longer
 *  drawn (the checkpoint banner is off in the UI), but kept as the data the
 *  banner would need if it comes back — see `isSectionStart`. */
export const SECTION_SIZE = 5;

/** 1-based section number a given absolute index belongs to. */
export function sectionForIndex(index: number): number {
  return Math.floor(index / SECTION_SIZE) + 1;
}

/** True when this index opens a new section. Not rendered any more (see
 *  `SECTION_SIZE`), but still exported and tested — removing the divider was
 *  a UI-only change, not a removal of the section data itself. */
export function isSectionStart(index: number): boolean {
  return index % SECTION_SIZE === 0;
}

export interface PracticeTilePathProps {
  /** Number of sessions the user has already completed — the index of
   *  the next active tile. */
  cursor: number;
  /** Tap on the active tile. The path doesn't know what the tile does
   *  — the parent screen wires the actual session-start call. */
  onTilePress: (index: number) => void;
  /**
   * 0–1 dial on every tile's stair depth cues — the tread occlusion band and
   * the lit nosing (see `TilePill`).
   *
   * One number for the whole flight, on purpose. Nine tiles' worth of shadow
   * is the sort of effect that looks right in a mockup and heavy on a real
   * screen, and the way that gets fixed badly is one opacity at a time until
   * the states no longer agree with each other. This turns them together.
   */
  depth?: number;
  /**
   * When false, only the tile directly above the active one carries a lock and
   * the rest of the road ahead stays bare stone.
   */
  marksOnAllLocked?: boolean;
}

/**
 * One shadow for the whole flight, not one per tile.
 *
 * Nine shadows is nine objects lying on a floor; one shadow is a staircase
 * standing on it. iOS gets this for free — a layer with no background colour
 * casts the shadow of its composited subtree, which is exactly the zigzag
 * silhouette the offsets draw.
 *
 * Android has no equivalent. `elevation` shadows the view's bounding box, so
 * on a column that is mostly empty space it would draw a tall rounded
 * rectangle behind the path rather than the shape of it — and putting
 * `elevation` on the tiles themselves is worse still: it takes over Android's
 * z-ordering and lifts each riser above the face that is supposed to cover it.
 * So Android goes without, deliberately. The tread band and the nosing are the
 * cues that actually make the flight read as stacked, and both are plain
 * drawing that lands identically on either platform; this one only adds
 * weight on the floor.
 */
const FLIGHT_SHADOW: ViewStyle = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
  },
  default: {},
});

interface RenderedTile {
  index: number;
  state: PracticeTileState;
}

/**
 * Memoized. The screen around it re-renders on things that have nothing to do
 * with the tiles — its measured height, the way-back button showing and
 * hiding as the user scrolls — and up to 61 tiles, each with its own SVG mark,
 * is too much to redraw for any of them.
 */
export const PracticeTilePath = memo(function PracticeTilePath({
  cursor,
  onTilePress,
  depth = 1,
  marksOnAllLocked = true,
}: PracticeTilePathProps) {
  const tiles = useMemo<RenderedTile[]>(
    () => buildWindow(cursor),
    [cursor],
  );

  return (
    <View style={styles.wrap}>
      {visualOrder(tiles).map((tile) => {
        const x = offsetForIndex(tile.index);
        return (
          <View
            key={tile.index}
            style={[styles.tileRow, { transform: [{ translateX: x }] }]}
          >
            <PracticeTile
              state={tile.state}
              onPress={withTap(() => onTilePress(tile.index))}
              // 1-based, and from the ABSOLUTE index like the zigzag: the
              // number names the tile, not the slot it currently occupies, so
              // it stays put as the window slides past.
              lesson={tile.index + 1}
              nextUp={tile.index === cursor + 1}
              depth={depth}
              marksOnAllLocked={marksOnAllLocked}
            />
          </View>
        );
      })}
    </View>
  );
});

/** Pure — given the cursor, return WINDOW_SIZE consecutive tiles in index
 *  order (past → future) with their absolute indices and per-tile state.
 *  Exported for unit testing. */
export function buildWindow(cursor: number): RenderedTile[] {
  const completedBehind = completedBelow(cursor);
  const startIndex = Math.max(0, cursor - completedBehind);
  const out: RenderedTile[] = [];
  for (let i = 0; i < WINDOW_SIZE; i += 1) {
    const absolute = startIndex + i;
    let state: PracticeTileState;
    if (absolute < cursor) state = 'completed';
    else if (absolute === cursor) state = 'active';
    else state = 'locked';
    out.push({ index: absolute, state });
  }
  return out;
}

/** Display order: `buildWindow` runs past → future, but the path climbs the
 *  screen, so the furthest-future tile renders first (top) and the furthest
 *  past tile last (bottom). Pure + exported for unit testing. */
export function visualOrder(tiles: RenderedTile[]): RenderedTile[] {
  return [...tiles].reverse();
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: PATH_PAD_TOP,
    paddingBottom: PATH_PAD_BOTTOM,
    // No flex gap and no per-row margin — tiles sit flush.
    // The shadow belongs here rather than on a tile: see FLIGHT_SHADOW. Note
    // this view must never gain a background colour — iOS would then shadow
    // its bounding box instead of the flight's silhouette.
    ...FLIGHT_SHADOW,
  },
  tileRow: {
    alignItems: 'center',
  },
});
