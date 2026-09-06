/**
 * MixPanel — the left-edge slide-in that sets the feed's CEFR blend.
 *
 * Geometry is pinned to the action rail: same height, same bottom edge, and an
 * end inset so the rail stays fully visible and tappable while the panel is
 * open. It is flush to the start screen edge (no start border, only the end
 * corners are rounded), and it never scrolls at default type sizes — see
 * `mixPanelLayout`, which sizes the bar as the residual so six levels fit in a
 * panel that could not have held six rows.
 *
 * The control is one **composition bar**, not six sliders. Its state is an
 * ordered array of cut points; the shares are derived from the cuts, so no
 * arrangement of them can fail to total 100. That is why there is no status
 * line, no "still to assign", and no disabled Done — the arithmetic the old
 * panel made the user do is now a property of the geometry. All of it lives in
 * utils/levelMix, so the panel and the store agree on the rules.
 *
 * The panel stays mounted and animates; it is not unmounted on close, so the
 * slide-out runs on the same curve as the slide-in.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColorScheme, useThemeColors, withAlpha, type ThemeColors } from '../../theme/tokens';
import type { LevelMix } from '../../services/api';
import {
  MIX_LEVELS,
  MIX_NUDGE_STEP,
  cutsToMix,
  mixShortfall,
  mixToCuts,
  moveCut,
  nudge,
  pageCounts,
  type MixCuts,
} from '../../utils/levelMix';
import { FEED_PAGE_SIZE, useWordFeedStore } from '../../stores/wordFeedStore';
import { mixPanelLayout } from './mixPanelLayout';
import { directionSign } from '../../i18n/rtl';

const SERIF_FAMILY = 'Source Serif 4';
const MONO_FAMILY = 'Courier';

/**
 * Fill opacity per level, easiest to hardest. Derived from `tc.gold` at render
 * time rather than added to the palette: the bar wants a difficulty *gradient*,
 * and six new tokens would be six things to keep in step with the accent.
 */
const LEVEL_ALPHA = [0.14, 0.26, 0.42, 0.6, 0.8, 1.0];

/** Below this share a segment is too narrow for its own label and the legend
 *  carries it instead. */
const LABEL_MIN_SHARE = 18;

interface Props {
  /** Working copy — the panel edits freely; only Done commits. */
  draft: LevelMix;
  onChange: (mix: LevelMix) => void;
  onDone: () => void;
  /** 0 = fully off-screen start edge, 1 = open. */
  progress: Animated.Value;
  visible: boolean;
  /** Must match the rail exactly — same height, same bottom edge, and an
   *  end inset that leaves the rail visible and tappable. */
  height: number;
  bottom: number;
  lane: number;
}

export function MixPanel({
  draft,
  onChange,
  onDone,
  progress,
  visible,
  height,
  bottom,
  lane,
}: Props) {
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Cuts are the panel's language; `LevelMix` is the store's and the wire's.
  // They are derived on open and converted back on every change, so nothing
  // outside this component ever sees a cut.
  const [cuts, setCuts] = useState<MixCuts>(() => mixToCuts(draft));

  // Re-derive only when the panel opens. Following `draft` would mean
  // re-deriving from the mix this component just emitted — a round trip that
  // can only lose precision, and one that fights an in-flight drag.
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  useEffect(() => {
    if (visible) setCuts(mixToCuts(latestDraft.current));
  }, [visible]);

  // The committed mix and what the server actually honoured — the truth for
  // the thin-level note. Read from the store rather than added to the props so
  // WordFeedScreen keeps the props it already passes.
  const committedMix = useWordFeedStore((st) => st.mix);
  const mixApplied = useWordFeedStore((st) => st.mixApplied);
  const shortfall = useMemo(
    () => mixShortfall(committedMix, mixApplied),
    [committedMix, mixApplied],
  );

  const layout = mixPanelLayout(height, shortfall !== null);

  const mix = useMemo(() => cutsToMix(cuts), [cuts]);
  const shares = MIX_LEVELS.map((level) => mix[level] ?? 0);
  const counts = useMemo(() => pageCounts(mix, FEED_PAGE_SIZE), [mix]);

  /** A move mid-drag repaints the bar and nothing else. The parent holds the
   *  draft that Done commits, and it does not need a new one sixty times a
   *  second for a divider the finger has not finished aiming — that is one
   *  WordFeedScreen render per touch event to show a value about to change. */
  function preview(next: MixCuts) {
    setCuts(next);
  }

  /** Where the finger stopped, or a tap: the parent hears about this one. */
  function apply(next: MixCuts) {
    setCuts(next);
    onChange(cutsToMix(next));
  }

  return (
    <Animated.View
      style={[
        s.panel,
        {
          height,
          bottom,
          end: lane,
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                // Off past the start edge, then in to flush. `directionSign`
                // flips it so an RTL layout slides in from the right.
                outputRange: [-500 * directionSign, 0],
              }),
            },
          ],
        },
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityViewIsModal={visible}
    >
      <Text style={s.title}>Word mix</Text>
      <Text style={s.hint} numberOfLines={layout.hintLines}>
        {layout.hintLines === 2
          ? 'Drag a divider to trade share.\nTap a level to give it 5%.'
          : 'Drag a divider, or tap a level.'}
      </Text>

      <View style={s.spacer} />

      <CompositionBar
        cuts={cuts}
        shares={shares}
        barHeight={layout.barHeight}
        onCuts={preview}
        onCommit={apply}
        scheme={scheme}
        tc={tc}
        s={s}
      />

      <View style={s.legend}>
        {MIX_LEVELS.map((level, i) => (
          <TouchableOpacity
            key={level}
            style={s.chip}
            // 44pt of touch on a chip that only draws ~24 — hitSlop rather
            // than padding, so the legend row stays 30pt tall in the budget.
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            activeOpacity={0.6}
            onPress={() => apply(nudge(cuts, i, MIX_NUDGE_STEP))}
            // VoiceOver never touches the bar; the chips are the control.
            accessibilityRole="adjustable"
            accessibilityLabel={`${level} share`}
            accessibilityValue={{ min: 0, max: 100, now: shares[i] }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => {
              const dir = e.nativeEvent.actionName === 'decrement' ? -MIX_NUDGE_STEP : MIX_NUDGE_STEP;
              apply(nudge(cuts, i, dir));
            }}
          >
            <Text style={[s.chipCode, shares[i] === 0 ? s.chipOff : null]}>{level}</Text>
            <Text style={[s.chipValue, shares[i] === 0 ? s.chipOff : null]}>{shares[i]}%</Text>
          </TouchableOpacity>
        ))}
      </View>

      {layout.showsNote && shortfall ? (
        <Text style={s.note} numberOfLines={1}>
          {`${shortfall.short} is running low — those cards came from ${shortfall.from}.`}
        </Text>
      ) : null}

      <View style={s.spacer} />

      <View style={s.footer}>
        <Text style={s.readout} numberOfLines={1}>
          {`Next ${FEED_PAGE_SIZE} words`}
          {counts.map((c) => ` · ${c.count} ${c.level}`).join('')}
        </Text>
        <TouchableOpacity
          style={s.done}
          onPress={onDone}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={s.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

function CompositionBar({
  cuts,
  shares,
  barHeight,
  onCuts,
  onCommit,
  scheme,
  tc,
  s,
}: {
  cuts: MixCuts;
  shares: number[];
  barHeight: number;
  /** Every move of the finger — repaint only. */
  onCuts: (cuts: MixCuts) => void;
  /** Once, where the finger stopped. */
  onCommit: (cuts: MixCuts) => void;
  scheme: 'light' | 'dark';
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) {
  const [barWidth, setBarWidth] = useState(0);

  // PanResponder is built once, so it must read the live cuts and width
  // rather than the values captured at creation time.
  const latest = useRef({ cuts, barWidth, onCuts, onCommit, index: 0 });
  latest.current = { ...latest.current, cuts, barWidth, onCuts, onCommit };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Claim the gesture so the FlatList underneath doesn't scroll the feed
      // while the user is dragging a divider.
      onPanResponderTerminationRequest: () => false,
      // Grant picks the divider but commits nothing. A tap that never moves
      // must not restructure the mix — the legend chips are the tap
      // affordance, and a stray touch on a wide segment yanking the nearest
      // divider under the finger is a mix the user did not ask for.
      onPanResponderGrant: (e) => {
        const pct = toPercent(e.nativeEvent.locationX);
        if (pct !== null) latest.current.index = pickCut(latest.current.cuts, pct);
      },
      onPanResponderMove: (e) => {
        const pct = toPercent(e.nativeEvent.locationX);
        if (pct !== null) drag(pct);
      },
      // The drag has only been repainting; this is the one place the mix the
      // user aimed at leaves the bar. Terminate matters as much as Release:
      // a gesture cancelled by the panel closing or a system sheet taking the
      // touch would otherwise strand the parent on a pre-drag draft while the
      // bar shows the dragged one.
      onPanResponderRelease: () => commit(),
      onPanResponderTerminate: () => commit(),
    }),
  ).current;

  function toPercent(x: number): number | null {
    const { barWidth: w } = latest.current;
    if (!w) return null;
    // locationX is always measured from the view's visual left edge, but the
    // bar runs from the start edge — which is the right one under RTL.
    const fraction = directionSign === 1 ? x / w : 1 - x / w;
    return fraction * 100;
  }

  function drag(pct: number) {
    const { cuts: c, onCuts: cb, index } = latest.current;
    const next = moveCut(c, index, pct);
    // Written to the ref rather than waiting to read it back off the next
    // render: `commit` fires from the release event and must see the last
    // move, not whatever the last completed render happened to hold.
    latest.current.cuts = next;
    cb(next);
  }

  function commit() {
    const { cuts: c, onCommit: cb } = latest.current;
    cb(c);
  }

  return (
    <View
      style={[s.bar, { height: barHeight }]}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...pan.panHandlers}
    >
      {MIX_LEVELS.map((level, i) => {
        // `flex: share` rather than a width percentage: adjacent flex children
        // are laid out against one measured line, so there is no rounding seam
        // between two segments the way there is between two percentages.
        const ink = labelInk(i, scheme, tc);
        return (
          <View
            key={level}
            // Segments never take a touch. `locationX` is measured from
            // whichever view the touch actually landed on, so leaving them
            // hittable would hand the PanResponder an offset relative to one
            // 40pt segment and read it as a position on the whole bar.
            pointerEvents="none"
            style={{ flex: shares[i], backgroundColor: withAlpha(tc.gold, LEVEL_ALPHA[i]) }}
          >
            {shares[i] >= LABEL_MIN_SHARE ? (
              <View style={s.segLabel}>
                <Text style={[s.segCode, { color: ink }]}>{level}</Text>
                <Text style={[s.segValue, { color: ink }]}>{shares[i]}%</Text>
              </View>
            ) : null}
          </View>
        );
      })}

      {cuts.map((cut, i) => (
        // The pill is the affordance, the line is the seam. Both are in the
        // panel's own paper so the bar reads as slotted rather than striped.
        <View key={i} style={[s.seam, { start: `${cut}%` }]} pointerEvents="none">
          <View style={s.seamLine} />
          <View style={s.grab}>
            <View style={s.tick} />
            <View style={s.tick} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Which divider a touch grabs: the nearest cut, except across a *stack* of
 * cuts sitting on one value — which is what a collapsed level looks like.
 * There, only the outermost cut of the stack can move without violating the
 * ordering, so the touch takes the last tied index from the right and the
 * first from the left. Getting this wrong doesn't just feel bad: it picks a
 * divider whose every move is immediately overridden by the push.
 */
function pickCut(cuts: MixCuts, pct: number): number {
  if (cuts.length === 0) return 0;

  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < cuts.length; i++) {
    const d = Math.abs(cuts[i] - pct);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }

  const value = cuts[best];
  let first = best;
  let last = best;
  while (first > 0 && cuts[first - 1] === value) first--;
  while (last < cuts.length - 1 && cuts[last + 1] === value) last++;
  return pct >= value ? last : first;
}

/**
 * Label ink for segment `i`.
 *
 * In dark mode the ramp crosses over: the low alphas sit on near-black and
 * need light ink, the top two are bright gold and need dark. In light mode it
 * never crosses — every segment is gold-on-cream, from pale to ochre, and
 * `goldDeep` is the only ink readable on all of them. White on the light
 * theme's #C58B1B is ~3:1, which is not a label.
 */
function labelInk(index: number, scheme: 'light' | 'dark', tc: ThemeColors): string {
  if (scheme === 'light') return tc.goldDeep;
  return index >= LEVEL_ALPHA.length - 2 ? tc.goldDeep : '#FFFFFF';
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    panel: {
      position: 'absolute',
      start: 0,
      backgroundColor: tc.paper,
      // Flush to the start edge: only the end corners round, and there is no
      // start border — the panel runs off the screen edge.
      borderTopEndRadius: 22,
      borderBottomEndRadius: 22,
      borderTopWidth: 1,
      borderEndWidth: 1,
      borderBottomWidth: 1,
      borderColor: tc.border,
      paddingTop: 14,
      paddingHorizontal: 18,
      paddingBottom: 16,
      overflow: 'hidden',
      // Theme-specific lift: a black shadow vanishes on the dark surface,
      // so `panelShadowColor` carries a warm glow there and a brown shadow
      // in light mode.
      shadowColor: tc.panelShadowColor,
      shadowOpacity: 1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 14 },
      elevation: 16,
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '700',
      color: tc.text,
    },
    hint: {
      marginTop: 2,
      fontSize: 11.5,
      lineHeight: 15,
      color: tc.textFaint,
    },
    // Two of these split whatever the fixed bands leave over, so the bar sits
    // optically centred however tall the panel turns out to be.
    spacer: { flex: 1 },

    bar: {
      marginTop: 10,
      borderRadius: 13,
      overflow: 'hidden',
      backgroundColor: tc.chipBg,
      flexDirection: 'row',
    },
    segLabel: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segCode: {
      fontSize: 10.5,
      lineHeight: 13,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    segValue: {
      fontSize: 17,
      lineHeight: 21,
      fontWeight: '800',
    },
    seam: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 2,
      // Centre the 2pt seam on the cut rather than hanging it off the edge.
      marginStart: -1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seamLine: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tc.paper,
    },
    grab: {
      width: 14,
      height: 34,
      borderRadius: 7,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.goldLine,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    tick: {
      width: 1,
      height: 12,
      backgroundColor: tc.gold,
    },

    legend: {
      marginTop: 6,
      height: 24,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    chip: {
      alignItems: 'center',
      minWidth: 30,
    },
    chipCode: {
      fontFamily: MONO_FAMILY,
      fontSize: 9,
      lineHeight: 11,
      fontWeight: '900',
      color: tc.goldOnSurface,
      letterSpacing: 0.4,
    },
    chipValue: {
      fontFamily: MONO_FAMILY,
      fontSize: 10,
      lineHeight: 12,
      fontWeight: '800',
      color: tc.goldOnSurface,
    },
    chipOff: { color: tc.textFaint },

    note: {
      marginTop: 4,
      fontSize: 11,
      lineHeight: 15,
      color: tc.textFaint,
    },

    footer: {
      borderTopWidth: 1,
      borderTopColor: tc.border,
      paddingTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    // Cards, not percentages: one tap (MIX_NUDGE_STEP) is exactly one card of
    // a 20-card page, so the thing the user is dragging is legible in what
    // they'll get. A drag moves in whole percents and so crosses a card
    // boundary every fifth one — the read-out holding still between those is
    // the truth about the next page, not the bar failing to respond.
    readout: {
      flex: 1,
      fontSize: 10.5,
      color: tc.textFaint,
    },
    // Always enabled. There is no unbalanced mix left to gate on.
    done: {
      height: 34,
      borderRadius: 10,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tc.gold,
    },
    doneText: { fontSize: 12.5, fontWeight: '800', color: tc.goldDeep },
  });
