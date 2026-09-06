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

/** Total tiles rendered at once. */
const WINDOW_SIZE = 9;
/** How many completed tiles to show above the active one (capped by
 *  `cursor` — a brand-new user with cursor=0 shows zero completed). */
const COMPLETED_ABOVE = 2;
// Tiles sit flush against each other now — no vertical gap owned by the row.

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
        return (
          <View
            key={tile.index}
            style={[
              styles.tileRow,
              { transform: [{ translateX: x }] },
            ]}
          >
            <PracticeTile
              state={tile.state}
              onPress={() => onTilePress(tile.index)}
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
    paddingTop: 6,
    paddingBottom: 24,
    // No flex gap and no per-row margin — tiles sit flush.
  },
  tileRow: {
    alignItems: 'center',
  },
});
