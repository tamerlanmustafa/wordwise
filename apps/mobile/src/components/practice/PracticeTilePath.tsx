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
 *     active tile, then locked tiles above until the window fills.
 *   • The visible range is always WINDOW_SIZE rows; the window slides
 *     up as the user advances.
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

import { useMemo } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { PracticeTile, type PracticeTileState } from './PracticeTile';
import { markSideForIndex } from './TileMarks';

/** Total tiles rendered at once. */
const WINDOW_SIZE = 9;
/** How many completed tiles to show below the active one (capped by
 *  `cursor` — a brand-new user with cursor=0 shows zero completed). */
const COMPLETED_BEHIND = 2;

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

export function PracticeTilePath({
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
              onPress={() => onTilePress(tile.index)}
              // Keyed on the absolute index, like the zigzag: the alternation
              // has to belong to the tile rather than to the slot it happens
              // to occupy, or the scuff flips under every tile as the window
              // slides.
              markSide={markSideForIndex(tile.index)}
              nextUp={tile.index === cursor + 1}
              depth={depth}
              marksOnAllLocked={marksOnAllLocked}
            />
          </View>
        );
      })}
    </View>
  );
}

/** Pure — given the cursor, return WINDOW_SIZE consecutive tiles in index
 *  order (past → future) with their absolute indices and per-tile state.
 *  Exported for unit testing. */
export function buildWindow(cursor: number): RenderedTile[] {
  const completedBehind = Math.min(COMPLETED_BEHIND, Math.max(0, cursor));
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
    paddingTop: 6,
    paddingBottom: 24,
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
