/**
 * PracticeTilePath — v0.7.2 vertical chain of practice tiles.
 *
 * Bottom-to-top: Quick Recall (always-on) sits at the bottom of the
 * chain; more specialized tiles climb up as the user earns longer
 * streaks. Subtle zigzag x-offsets (matching the v0.7 reel) for visual
 * rhythm without the per-movie path's aggressive sweep.
 *
 * State derivation rules (pure):
 *   • If the user already started today AND `last_session_kind` is set
 *     → that tile is `done-today`; everything else is `locked-other`.
 *   • Otherwise → for each tile, if `streak >= unlockAt` it's
 *     `available` (in practice only one can be tapped per day, but
 *     all unlocked tiles are visually pickable until one is chosen);
 *     if streak < unlockAt it's `locked-streak`.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  KIND_UNLOCK_THRESHOLDS,
  type SessionKind,
} from '../../services/api';
import { PracticeTile, type PracticeTileState } from './PracticeTile';

/** Top-to-bottom order in the rendered array. Bottom of the chain
 *  (most accessible) is the LAST entry so we can render the chain
 *  reversed and have the always-on tile at the visual bottom. */
const ORDER_TOP_TO_BOTTOM: SessionKind[] = [
  'movie_deep_dive',
  'tough_words',
  'synonym_round',
  'quick_recall',
];

const TILE_LABELS: Record<SessionKind, string> = {
  quick_recall:    'Quick Recall',
  synonym_round:   'Synonym Round',
  tough_words:     'Tough Words',
  movie_deep_dive: 'Movie Deep-Dive',
};

/** Gentle zigzag — same energy as the v0.7 reel offsets but tighter
 *  so the chain reads as a column-with-rhythm, not a Duolingo path. */
const X_OFFSETS = [0, 24, -16, 12];

export interface PracticeTilePathProps {
  /** User's current streak — drives the per-tile unlock check. */
  streak: number;
  /** What the user picked today (or null/undefined if they haven't yet). */
  lastSessionKind?: SessionKind | null;
  /** Tap on an `available` tile. The path doesn't know what the tile
   *  does — the parent screen wires the actual session-start call. */
  onTilePress: (kind: SessionKind) => void;
}

export function PracticeTilePath({
  streak,
  lastSessionKind,
  onTilePress,
}: PracticeTilePathProps) {
  const states = useMemo<Record<SessionKind, PracticeTileState>>(
    () => deriveTileStates(streak, lastSessionKind ?? null),
    [streak, lastSessionKind],
  );

  return (
    <View style={styles.wrap}>
      {ORDER_TOP_TO_BOTTOM.map((kind, i) => {
        const x = X_OFFSETS[i % X_OFFSETS.length];
        return (
          <View
            key={kind}
            style={[styles.tileRow, { transform: [{ translateX: x }] }]}
          >
            <PracticeTile
              kind={kind}
              label={TILE_LABELS[kind]}
              state={states[kind]}
              unlockAt={KIND_UNLOCK_THRESHOLDS[kind]}
              onPress={() => onTilePress(kind)}
            />
          </View>
        );
      })}
    </View>
  );
}

/** Pure state-machine derivation. Exported for unit tests. */
export function deriveTileStates(
  streak: number,
  lastSessionKind: SessionKind | null,
): Record<SessionKind, PracticeTileState> {
  const out = {} as Record<SessionKind, PracticeTileState>;
  const allKinds: SessionKind[] = [
    'quick_recall', 'synonym_round', 'tough_words', 'movie_deep_dive',
  ];

  if (lastSessionKind) {
    // User picked today already — exactly one tile renders as
    // done-today; the rest are locked-other until UTC rollover.
    for (const k of allKinds) {
      out[k] = k === lastSessionKind ? 'done-today' : 'locked-other';
    }
    return out;
  }

  // No pick yet — open the gates. Each tile is either available
  // (streak meets threshold) or locked-streak.
  for (const k of allKinds) {
    out[k] = streak >= KIND_UNLOCK_THRESHOLDS[k] ? 'available' : 'locked-streak';
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
    // No vertical padding — the inter-tile gap is handled by `gap` on
    // the parent. The translateX on each row is what produces the
    // gentle zigzag.
  },
});
