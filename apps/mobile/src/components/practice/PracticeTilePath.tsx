/**
 * PracticeTilePath — v0.7.3 Duolingo-style endless chain.
 *
 * The path is a linear, never-ending sequence of lesson tiles. A single
 * client-side cursor (see `practicePathStore`) points at the user's
 * next active tile. The kind shown at each index is derived from a
 * fixed 4-step cycle in `practicePathStore.ts::kindAtIndex`.
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
 * The path itself doesn't know about session APIs / movie picks / the
 * free-tier daily cap; the parent screen wires the tap of the active
 * tile into the right side-effects.
 */

import { Fragment, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { kindAtIndex } from '../../stores/practicePathStore';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import type { SessionKind } from '../../services/api';
import { PracticeTile, type PracticeTileState } from './PracticeTile';

const TILE_LABELS: Record<SessionKind, string> = {
  quick_recall:    'Quick Recall',
  synonym_round:   'Synonym Round',
  tough_words:     'Tough Words',
  movie_deep_dive: 'Movie Deep-Dive',
};

/** Total tiles rendered at once. */
const WINDOW_SIZE = 7;
/** How many completed tiles to show above the active one (capped by
 *  `cursor` — a brand-new user with cursor=0 shows zero completed). */
const COMPLETED_ABOVE = 2;

/** Gentle zigzag — same energy as the v0.7 reel offsets. Keyed on each
 *  tile's *absolute* index (see {@link offsetForIndex}) rather than its
 *  rendered slot, so the path's shape scrolls past as the cursor
 *  advances — the road moves, instead of the window showing an identical
 *  frozen shape every session. */
const X_OFFSETS = [0, 24, -16, 12, -8, 18, -20];

/** Horizontal zigzag offset for a tile at absolute path index. Pure +
 *  exported for unit testing. */
export function offsetForIndex(index: number): number {
  const n = X_OFFSETS.length;
  return X_OFFSETS[((index % n) + n) % n];
}

/** Dots drawn in the trail between two consecutive tiles. */
export const CONNECTOR_DOTS = 3;

/** X offsets for the connector dots between tiles `prevIndex` →
 *  `nextIndex`, stepping evenly between the two tiles' zigzag offsets
 *  so the trail leans toward the next circle instead of running
 *  straight down. Pure + exported for unit testing. */
export function connectorXs(prevIndex: number, nextIndex: number): number[] {
  const a = offsetForIndex(prevIndex);
  const b = offsetForIndex(nextIndex);
  return Array.from({ length: CONNECTOR_DOTS }, (_, i) => {
    const t = (i + 1) / (CONNECTOR_DOTS + 1);
    return Math.round(a + (b - a) * t);
  });
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
   *  the next active tile in the kind cycle. */
  cursor: number;
  /** Tap on the active tile. The path doesn't know what the tile does
   *  — the parent screen wires the actual session-start call. */
  onTilePress: (kind: SessionKind, index: number) => void;
}

interface RenderedTile {
  index: number;
  kind: SessionKind;
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
      {tiles.map((t, slot) => {
        const x = offsetForIndex(t.index);
        const prev = slot > 0 ? tiles[slot - 1] : null;
        return (
          <Fragment key={t.index}>
            {isSectionStart(t.index) ? (
              <SectionDivider
                section={sectionForIndex(t.index)}
                completed={cursor >= t.index + SECTION_SIZE}
                current={t.index <= cursor && cursor < t.index + SECTION_SIZE}
              />
            ) : prev ? (
              // Dotted trail tying consecutive circles into one road.
              // Skipped at section boundaries — the divider is the
              // visual break there.
              <PathConnector
                prevIndex={prev.index}
                nextIndex={t.index}
                walked={t.index <= cursor}
              />
            ) : null}
            <View style={[styles.tileRow, { transform: [{ translateX: x }] }]}>
              <PracticeTile
                kind={t.kind}
                label={TILE_LABELS[t.kind]}
                state={t.state}
                onPress={() => onTilePress(t.kind, t.index)}
              />
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

/** Three small dots between two tiles, leaning from the previous tile's
 *  x offset toward the next one's. Walked segments (up to and including
 *  the active tile) read gold; the road ahead stays faint. */
function PathConnector({
  prevIndex,
  nextIndex,
  walked,
}: {
  prevIndex: number;
  nextIndex: number;
  walked: boolean;
}) {
  const tc = useThemeColors();
  const xs = connectorXs(prevIndex, nextIndex);
  const color = walked ? tc.goldOnSurface : tc.textFaint;
  return (
    <View style={styles.connector} pointerEvents="none">
      {xs.map((x, i) => (
        <View
          key={i}
          style={[
            styles.connectorDot,
            {
              backgroundColor: color,
              opacity: walked ? 0.9 : 0.35,
              transform: [{ translateX: x }],
            },
          ]}
        />
      ))}
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
}: {
  section: number;
  completed: boolean;
  current: boolean;
}) {
  const tc = useThemeColors();
  const ds = useMemo(() => makeDividerStyles(tc), [tc]);
  const accent = completed ? tc.goldOnSurface : current ? tc.gold : tc.textFaint;
  return (
    <View style={ds.wrap}>
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
    out.push({
      index: absolute,
      kind: kindAtIndex(absolute),
      state,
    });
  }
  return out;
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 12,
    paddingBottom: 24,
    // No flex gap — the space between rows is owned by the connector
    // trail (or the section divider's margins at boundaries).
  },
  tileRow: {
    alignItems: 'center',
  },
  connector: {
    height: 26,
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  connectorDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});

const makeDividerStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 4,
      // Owns its own breathing room now that the path has no flex gap.
      marginVertical: 14,
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
