/**
 * MixPanel — the left-edge slide-in that sets the feed's CEFR blend.
 *
 * Geometry is pinned to the action rail: same height, same bottom edge, and
 * a 76px right inset so the rail stays fully visible and tappable while the
 * panel is open. It is flush to the left screen edge (no left border, only
 * the right corners are rounded), and it never scrolls at default type
 * sizes — the four rows and the footer are sized to fit 285px.
 *
 * The panel stays mounted and animates; it is not unmounted on close, so
 * the slide-out runs on the same curve as the slide-in.
 *
 * All the arithmetic lives in utils/levelMix so the panel and the store
 * agree on what the rules are. Each level moves independently: `+` and drag
 * are clamped by what's left of 100 and never steal from another level,
 * `−` always works down to 0.
 */

import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import type { LevelMix } from '../../services/api';
import {
  MIX_LEVELS,
  canDecrement,
  canIncrement,
  decrement,
  increment,
  isBalanced,
  remainingToAssign,
  setLevelFromFraction,
  type MixLevel,
} from '../../utils/levelMix';
import { directionSign } from '../../i18n/rtl';

const SERIF_FAMILY = 'Source Serif 4';

interface Props {
  /** Working copy — the panel edits freely; only Done commits. */
  draft: LevelMix;
  onChange: (mix: LevelMix) => void;
  onDone: () => void;
  /** 0 = fully off-screen left, 1 = open. */
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
  const s = useMemo(() => makeStyles(tc), [tc]);

  const balanced = isBalanced(draft);
  const remaining = remainingToAssign(draft);

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
      <Text style={s.sub}>How much of your feed comes from each level.</Text>

      <View style={s.rows}>
        {MIX_LEVELS.map((level, i) => (
          <LevelRow
            key={level}
            level={level}
            value={draft[level] ?? 0}
            mix={draft}
            onChange={onChange}
            showRule={i > 0}
            tc={tc}
            s={s}
          />
        ))}
      </View>

      <View style={s.footer}>
        <Text style={[s.status, balanced ? s.statusOk : null]}>
          {balanced ? 'Adds up to 100%' : `${remaining}% still to assign`}
        </Text>
        <TouchableOpacity
          style={[s.done, balanced ? s.doneOn : s.doneOff]}
          onPress={balanced ? onDone : undefined}
          disabled={!balanced}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !balanced }}
        >
          <Text style={[s.doneText, balanced ? s.doneTextOn : s.doneTextOff]}>
            {balanced ? 'Done' : `Assign ${remaining}%`}
          </Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

function LevelRow({
  level,
  value,
  mix,
  onChange,
  showRule,
  tc,
  s,
}: {
  level: MixLevel;
  value: number;
  mix: LevelMix;
  onChange: (mix: LevelMix) => void;
  showRule: boolean;
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  // PanResponder is built once, so it must read the live mix/width rather
  // than the values captured at creation time.
  const latest = useRef({ mix, trackWidth, onChange, level });
  latest.current = { mix, trackWidth, onChange, level };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Claim the gesture so the FlatList underneath doesn't scroll the
      // feed while the user is dragging a slider.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => applyDrag(e.nativeEvent.locationX),
      onPanResponderMove: (e) => applyDrag(e.nativeEvent.locationX),
    }),
  ).current;

  function applyDrag(x: number) {
    const { mix: m, trackWidth: w, onChange: cb, level: l } = latest.current;
    if (!w) return;
    // locationX is always measured from the view's visual left edge, but the
    // fill grows from the start edge — which is the right one under RTL.
    const fraction = directionSign === 1 ? x / w : 1 - x / w;
    cb(setLevelFromFraction(m, l, fraction));
  }

  const plusEnabled = canIncrement(mix);
  const minusEnabled = canDecrement(mix, level);

  return (
    <View style={[s.row, showRule ? s.rowRule : null]}>
      <Text style={s.levelCode}>{level}</Text>

      <View
        style={s.trackHit}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={s.track}>
          <View style={[s.fill, { width: `${value}%` }]} />
        </View>
        {/* Knob rides the end of the fill. Offset by half its width so it
            centres on the fill edge instead of hanging past it. */}
        <View
          style={[s.knob, { start: `${value}%`, marginStart: -7.5 }]}
          pointerEvents="none"
        />
      </View>

      <TouchableOpacity
        style={s.step}
        onPress={() => onChange(decrement(mix, level))}
        disabled={!minusEnabled}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${level}`}
      >
        <Text style={[s.stepGlyph, { color: minusEnabled ? tc.text : tc.textFaint }]}>−</Text>
      </TouchableOpacity>

      <Text style={s.value}>{value}%</Text>

      <TouchableOpacity
        style={s.step}
        onPress={() => onChange(increment(mix, level))}
        disabled={!plusEnabled}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${level}`}
      >
        <Text style={[s.stepGlyph, { color: plusEnabled ? tc.text : tc.textFaint }]}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    panel: {
      position: 'absolute',
      start: 0,
      backgroundColor: tc.paper,
      // Flush left: only the right corners round, and there is no left
      // border — the panel runs off the screen edge.
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
      fontWeight: '700',
      color: tc.text,
    },
    sub: {
      marginTop: 2,
      fontSize: 11.5,
      color: tc.textFaint,
    },
    // flex:1 so a longer list would scroll the rows only, never the panel.
    rows: { flex: 1, justifyContent: 'center' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 2,
      gap: 8,
    },
    rowRule: {
      borderTopWidth: 1,
      borderTopColor: tc.border,
    },
    levelCode: {
      width: 22,
      fontSize: 11.5,
      fontWeight: '900',
      color: tc.text,
    },
    trackHit: {
      flex: 1,
      paddingVertical: 9,
      justifyContent: 'center',
    },
    track: {
      height: 6,
      borderRadius: 3,
      backgroundColor: tc.chipBg,
      overflow: 'hidden',
    },
    fill: {
      height: 6,
      borderRadius: 3,
      backgroundColor: tc.gold,
    },
    knob: {
      position: 'absolute',
      width: 15,
      height: 15,
      borderRadius: 7.5,
      backgroundColor: tc.gold,
      borderWidth: 2,
      borderColor: tc.paper,
    },
    step: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tc.chipBg,
    },
    stepGlyph: {
      fontSize: 15,
      fontWeight: '800',
      lineHeight: 18,
    },
    value: {
      width: 36,
      textAlign: 'center',
      fontSize: 13.5,
      fontWeight: '800',
      color: tc.text,
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    status: {
      flex: 1,
      fontSize: 11.5,
      color: tc.textFaint,
    },
    statusOk: { color: tc.goldOnSurface },
    done: {
      height: 34,
      borderRadius: 10,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneOn: { backgroundColor: tc.gold },
    doneOff: { backgroundColor: tc.chipBg },
    doneText: { fontSize: 12.5, fontWeight: '800' },
    doneTextOn: { color: tc.goldDeep },
    doneTextOff: { color: tc.textFaint },
  });
