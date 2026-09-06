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
 *     {@link COMPLETED_ABOVE} completed tiles above (capped by what's
 *     actually been completed; a brand-new user shows zero), then the
 *     active tile, then locked tiles below until the window fills.
 *   • The visible range is always WINDOW_SIZE rows; the window slides
 *     down as the user advances.
 *
 * State derivation rules (pure, per index `i`):
 *   • i  < cursor → 'completed'
 *   • i == cursor → 'active'
 *   • i  > cursor → 'locked'
 *
 * Vertical rhythm: the pills *are* the road, stacked flush with no gap
 * between one tile's bottom and the next one's top. Each tile's own tall
 * edge — the riser, see `TilePill` — is what keeps two abutting steps
 * reading as separate treads rather than fusing into one long strip; the
 * corners are rounded just enough to still read as a rectangle rather than
 * a pill.
 *
 * The path itself doesn't know about session APIs or the free-tier daily
 * cap; the parent screen wires the tap of the active tile into the right
 * side-effects.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { PracticeTile, type PracticeTileState } from './PracticeTile';
import { TILE_BLOCK, TILE_EDGE, TILE_W } from './TilePill';

/** Total tiles rendered at once. */
const WINDOW_SIZE = 9;
/** How many completed tiles to show above the active one (capped by
 *  `cursor` — a brand-new user with cursor=0 shows zero completed). */
const COMPLETED_ABOVE = 2;
// The next tread begins one riser higher. With TILE_H=56 and TILE_EDGE=24,
// the 32pt face overlap leaves no background slit while preserving a full,
// readable 24pt riser between consecutive steps.
export const STAIR_RISE = TILE_EDGE;
// At 32pt, each diagonal move is 16% of a 200pt tread. STAIR_RISE / STEP_RUN
// is 0.75: visibly diagonal, without breaking the path into isolated buttons.
export const STEP_RUN = 32;
// The active tile used to be the third rendered row after progression begins.
// Keeping that 160pt anchor prevents it jumping when a lesson completes.
const ACTIVE_ANCHOR_Y = COMPLETED_ABOVE * TILE_BLOCK;

/** Horizontal sway of the road, as a smooth wave rather than a jitter: four
 *  steps out and four back, so consecutive tiles lean into each other the way
 *  a path bends. Keyed on each tile's *absolute* index (see
 *  {@link offsetForIndex}) rather than its rendered slot, so the shape scrolls
 *  past as the cursor advances — the road moves, instead of the window showing
 *  an identical frozen shape every session. */
const X_OFFSETS = [0, STEP_RUN, 0, -STEP_RUN];

/** Horizontal zigzag offset for a tile at absolute path index. Pure +
 *  exported for unit testing. */
export function offsetForIndex(index: number): number {
  const n = X_OFFSETS.length;
  return X_OFFSETS[((index % n) + n) % n];
}

/** Direction from this tread to the next, higher (future) tread. */
export function riserDirectionForIndex(index: number): 'upper-left' | 'upper-right' {
  return offsetForIndex(index + 1) < offsetForIndex(index) ? 'upper-left' : 'upper-right';
}

/** Absolute tread position around the fixed active-step anchor. */
export function stairTopForIndex(index: number, cursor: number): number {
  return ACTIVE_ANCHOR_Y + (cursor - index) * STAIR_RISE;
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
}

interface RenderedTile {
  index: number;
  state: PracticeTileState;
}

export function PracticeTilePath({
  cursor,
  onTilePress,
}: PracticeTilePathProps) {
  const tiles = useMemo<RenderedTile[]>(
    () => buildWindow(cursor),
    [cursor],
  );

  return (
    <View style={styles.wrap}>
      {tiles.map((tile) => {
        const x = offsetForIndex(tile.index);
        const y = stairTopForIndex(tile.index, cursor);
        return (
          <View
            key={tile.index}
            style={[
              styles.tileRow,
              // Lower (past) treads paint on top of higher (future) ones,
              // matching the front-to-back order of a staircase.
              { top: y, zIndex: cursor - tile.index, transform: [{ translateX: x }] },
            ]}
          >
            <PracticeTile
              state={tile.state}
              onPress={() => onTilePress(tile.index)}
              riserDirection={riserDirectionForIndex(tile.index)}
            />
          </View>
        );
      })}
    </View>
  );
}

/** Pure — given the cursor, return WINDOW_SIZE consecutive tiles
 *  (top-to-bottom) with their absolute indices and per-tile state.
 *  Exported for unit testing. */
export function buildWindow(cursor: number): RenderedTile[] {
  const completedAbove = Math.min(COMPLETED_ABOVE, Math.max(0, cursor));
  const startIndex = Math.max(0, cursor - completedAbove);
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

const styles = StyleSheet.create({
  wrap: {
    height: ACTIVE_ANCHOR_Y + COMPLETED_ABOVE * STAIR_RISE + TILE_BLOCK,
    paddingTop: 6,
  },
  tileRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
