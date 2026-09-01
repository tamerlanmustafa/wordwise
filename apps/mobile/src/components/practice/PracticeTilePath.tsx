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
 * Vertical rhythm: the coins *are* the road. There used to be a trail of
 * three dots drawn between every pair of them, which cost 26pt a row on top
 * of the row's own padding and stretched the path so far that barely four
 * tiles fitted on a phone screen. Tiles now sit {@link ROW_GAP} apart, which
 * puts seven on screen at once — the density the path was designed for, and
 * what makes it read as one continuous route rather than a sparse column.
 *
 * The path itself doesn't know about session APIs or the free-tier daily
 * cap; the parent screen wires the tap of the active tile into the right
 * side-effects.
 */

import { Fragment, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { PracticeTile, type PracticeTileState } from './PracticeTile';

/** Total tiles rendered at once. */
const WINDOW_SIZE = 9;
/** How many completed tiles to show above the active one (capped by
 *  `cursor` — a brand-new user with cursor=0 shows zero completed). */
const COMPLETED_ABOVE = 2;
/** Vertical gap between two coins. Sized so the active tile's START callout
 *  lands *in* the gap rather than on the tile below it. */
const ROW_GAP = 24;

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

/** How many tiles make up one "section" — the landmark cadence. A
 *  checkpoint divider is rendered above each section's first tile so the
 *  user sees named landmarks scroll past as they advance, instead of an
 *  undifferentiated infinite chain. */
export const SECTION_SIZE = 5;

/** 1-based section number a given absolute index belongs to. */
export function sectionForIndex(index: number): number {
  return Math.floor(index / SECTION_SIZE) + 1;
}

/** True when this index opens a new section (gets a divider above it). */
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
      {tiles.map((tile, slot) => {
        const x = offsetForIndex(tile.index);
        const startsSection = isSectionStart(tile.index);
        return (
          <Fragment key={tile.index}>
            {startsSection ? (
              <SectionDivider
                section={sectionForIndex(tile.index)}
                completed={cursor >= tile.index + SECTION_SIZE}
                current={tile.index <= cursor && cursor < tile.index + SECTION_SIZE}
                first={slot === 0}
              />
            ) : null}
            <View
              style={[
                styles.tileRow,
                // The divider owns the space above the tile it introduces, so
                // the row's own gap would double it.
                slot > 0 && !startsSection && styles.tileGap,
                { transform: [{ translateX: x }] },
              ]}
            >
              <PracticeTile
                state={tile.state}
                onPress={() => onTilePress(tile.index)}
              />
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

/** Checkpoint banner between sections. A completed section reads gold +
 *  checked (a landmark you've walked past); the section holding the
 *  cursor gets the bright gold accent; future sections stay faint. */
function SectionDivider({
  section,
  completed,
  current,
  first,
}: {
  section: number;
  completed: boolean;
  current: boolean;
  /** Opening the window — no tile above it to be separated from. */
  first: boolean;
}) {
  const tc = useThemeColors();
  const ds = useMemo(() => makeDividerStyles(tc), [tc]);
  const accent = completed ? tc.goldOnSurface : current ? tc.gold : tc.textFaint;
  return (
    <View style={[ds.wrap, first && ds.wrapFirst]}>
      <View style={[ds.line, { backgroundColor: tc.border }]} />
      <View style={[ds.pill, { borderColor: accent, backgroundColor: tc.paper }]}>
        <Text style={[ds.label, { color: accent }]}>
          {completed ? '✓ ' : ''}SECTION {section}
        </Text>
      </View>
      <View style={[ds.line, { backgroundColor: tc.border }]} />
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
    // No flex gap — the space between rows is owned by `tileGap` (or the
    // section divider's margins at boundaries).
  },
  tileRow: {
    alignItems: 'center',
  },
  tileGap: {
    marginTop: ROW_GAP,
  },
});

const makeDividerStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 4,
      // Owns its own breathing room now that the path has no flex gap. The
      // active tile's START callout can hang into the space above a divider,
      // so the top margin is the larger of the two.
      marginTop: ROW_GAP + 4,
      marginBottom: 8,
    },
    wrapFirst: {
      marginTop: 0,
    },
    line: {
      flex: 1,
      height: 1,
    },
    pill: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1.5,
    },
    label: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.4,
    },
  });
