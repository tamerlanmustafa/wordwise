import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * PressablePill — the app's "press it down" button, at any size.
 *
 * ## The pattern, and what it is called
 *
 * **A pill is a face and an edge.** The face is the surface you see and read;
 * the edge is a copy of the same shape in a darker tone, offset straight down
 * and never moved again. Pressing sinks the face onto the edge, so the control
 * physically depresses instead of dimming. Those two words — *face* and *edge*
 * — are the vocabulary everywhere this appears: `TilePill` on the practice
 * path states the rule, and the quiz CTA, `MCQChoice`, the word deck's
 * Knew it / Next pills and the film-feed card all follow it.
 *
 * (Elsewhere in UI writing this shape goes by "3D button" or "pushable
 * button", and the offset solid beneath it by "hard shadow" — unblurred, as
 * opposed to the soft drop shadow it replaces. This codebase says pill.)
 *
 * ## Why this component exists
 *
 * The five places above each hand-rolled the same three layers, which was
 * tolerable while they were all fixed-size. This one sizes to its content, so
 * it works for a row whose height depends on how many lines of text landed in
 * it. New pills should start here rather than as a sixth copy.
 *
 * The face is a normal-flow child and the edge is absolute, so the slot is
 * exactly `face + edgeDepth` tall and a press shifts nothing below it.
 *
 * ## Two rules the construction depends on
 *
 * 1. **Only the face moves.** If the edge moved too, the whole control would
 *    slide down the page rather than compress — a different gesture entirely.
 * 2. **The edge carries the shadow, not the face.** It is the bottom-most
 *    solid, so the pill casts one shadow; a blurred shadow under the face plus
 *    a hard edge beneath it is two depth cues drawn at once, and the face's
 *    would fall on its own edge.
 *
 * Haptics are the caller's, wrapped in the JSX as
 * `onPress={withTap(handler)}` — the house rule, and what every existing pill
 * does. This component deliberately fires none of its own, so wrapping can
 * never double up. (`PressableScale`, the other press primitive, owns its
 * haptic instead; that difference is why they are separate components.)
 */

/**
 * Default depth of the edge, and how far the face travels on press.
 *
 * 4 is the tap-button depth — the quiz CTA's, and the film-feed card's. The
 * practice path uses 24, but its tiles are stair treads you climb rather than
 * buttons you tap, and a 24pt lip under a card reads as a shelf it is sitting
 * on.
 */
export const PILL_EDGE = 4;

/**
 * The face never quite reaches the edge's bottom.
 *
 * A face that lands flush reads as the button vanishing rather than as it
 * bottoming out, so the travel is one point short of the depth. Same -1 the
 * quiz CTA and the MCQ choices use.
 */
const PRESS_SHORTFALL = 1;

export interface PressablePillProps extends Omit<PressableProps, 'style' | 'children'> {
  /**
   * Edge colour. Always darker than the face — that difference *is* the
   * depth, so it is a real colour and never an opacity over the face.
   */
  edge: string;
  /**
   * The face: its background, border, padding and radius. Everything the
   * reader sees belongs here rather than on the slot, which only reserves
   * room.
   */
  faceStyle?: StyleProp<ViewStyle>;
  /**
   * Corner radius, repeated on the edge so the two layers are the same
   * rectangle. Passed rather than read off `faceStyle` because a style prop
   * can be an array, a registered id, or a platform-specific object, and
   * guessing wrong leaves a square edge under a rounded face.
   */
  radius: number;
  /** Depth of the edge and the press travel. Defaults to {@link PILL_EDGE}. */
  edgeDepth?: number;
  /**
   * Soft shadow for the edge layer. Omit for a flat pill.
   *
   * **iOS properties only — never `elevation`.** On Android `elevation` also
   * sets z-order within the parent, so an elevated edge draws *above* the
   * zero-elevation face beside it and the pill renders as a solid block of
   * edge colour. That is not a loss: the hard edge is itself the depth cue,
   * which is why `TilePill`, `MCQChoice` and the deck's pills carry no shadow
   * at all. A shadow says "this floats"; an edge says "this is a button you
   * can push".
   */
  shadow?: StyleProp<ViewStyle>;
  /** Outer layout only — margins, alignment. Never paint on this. */
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function PressablePill({
  edge,
  faceStyle,
  radius,
  edgeDepth = PILL_EDGE,
  shadow,
  style,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: PressablePillProps) {
  // `useRef`, not a fresh value per render: a pill that re-renders mid-press —
  // an image landing, a count resolving — must not get a new Animated.Value
  // and snap back up under the finger.
  const press = useRef(new Animated.Value(0)).current;

  return (
    <Pressable
      style={style}
      onPressIn={(e) => {
        press.setValue(1);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.setValue(0);
        onPressOut?.(e);
      }}
      {...rest}
    >
      {/* Absolutely filling the slot and then pushed down by `edgeDepth`
          leaves it exactly the face's height, which is what keeps the two
          shapes seamless at the corners. Static — see rule 1 above. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          shadow,
          { top: edgeDepth, borderRadius: radius, backgroundColor: edge },
        ]}
        pointerEvents="none"
      />
      <Animated.View
        style={[
          faceStyle,
          {
            transform: [
              {
                translateY: press.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, edgeDepth - PRESS_SHORTFALL],
                }),
              },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
      {/* Reserves the edge's depth in the flow, so pressing the pill moves
          nothing beneath it. */}
      <View style={{ height: edgeDepth }} pointerEvents="none" />
    </Pressable>
  );
}
