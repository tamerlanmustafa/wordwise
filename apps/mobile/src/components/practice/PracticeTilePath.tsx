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

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { kindAtIndex } from '../../stores/practicePathStore';
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

/** Gentle zigzag — same energy as the v0.7 reel offsets. Cycles by
 *  rendered-position so the path's overall shape stays put as the
 *  cursor advances (tiles slide vertically, not horizontally). */
const X_OFFSETS = [0, 24, -16, 12, -8, 18, -20];

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
      {tiles.map((t, renderIdx) => {
        const x = X_OFFSETS[renderIdx % X_OFFSETS.length];
        return (
          <View
            key={t.index}
            style={[styles.tileRow, { transform: [{ translateX: x }] }]}
          >
            <PracticeTile
              kind={t.kind}
              label={TILE_LABELS[t.kind]}
              state={t.state}
              onPress={() => onTilePress(t.kind, t.index)}
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
    gap: 24, // breathing room between tiles + their labels
  },
  tileRow: {
    alignItems: 'center',
  },
});
