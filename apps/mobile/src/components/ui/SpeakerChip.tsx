/**
 * SpeakerChip — the round gold "say this word" button that sits beside a
 * headword.
 *
 * One component rather than a copy per card. This app has had the pronunciation
 * control drift between its surfaces before: it once 401'd on two of them at
 * once because the bearer token was decided per component, and the tap target
 * was a bare `Text onPress` in one place and a padded touchable in another. A
 * source guard (`components/__tests__/pronounceCallSites`) exists because of
 * that history — this is the same argument applied to the appearance instead
 * of the behaviour.
 *
 * ## What the chip is, and why it is a chip
 *
 * A filled disc, not a bare glyph on the card ground. The word feed's speaker
 * was `textFaint` — the app's quietest ink, nearly invisible in both themes on
 * a card whose whole job is one loud word — and it read as decoration rather
 * than as something to press. Gold is the app's one accent, and `goldWash` /
 * `goldLine` are theme-aware: the wash and the hairline invert with the ground
 * while the ink stays legible on either. While it plays it fills solid, so the
 * state is visible from across the room and not only in the icon's animation.
 *
 * ## Size is the caller's, the design is not
 *
 * The two cards using this are different sizes — a full-viewport feed card
 * with a 46pt headword, and a deck card with a 32pt one — so a single diameter
 * would be right on one and wrong on the other. `size` is therefore a prop and
 * everything else is fixed here. The **glyph scales with the chip** rather
 * than being a second prop, because the ratio is the part that has to stay
 * constant for the two to read as the same control.
 *
 * `hitSlop` is uncapped on every side and lives here, not at the call sites.
 * Both cards put this chip inside a card-wide reveal Pressable, and a near
 * miss flipping the card instead of playing the word is the exact bug the
 * original user report was about.
 */

import {
  TouchableOpacity,
  StyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useThemeColors } from '../../theme/tokens';
import { SpeakerIcon } from './icons';

/** The glyph as a fraction of the chip. Tuned on the feed's 44/22 pairing. */
const GLYPH_RATIO = 0.5;

/** Enough that the thumb's near misses land on the chip rather than the card
 *  underneath it, without reaching a neighbouring control — neither card puts
 *  anything within 8pt of this. */
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

export function SpeakerChip({
  size,
  playing,
  onPress,
  disabled,
  accessibilityLabel,
  style,
}: {
  /** Chip diameter. 44 is the platform tap minimum on both stores; smaller is
   *  only acceptable because `hitSlop` above extends the real target. */
  size: number;
  playing: boolean;
  /** Takes the event, because both call sites sit inside a card-wide reveal
   *  Pressable and have to stop the tap propagating to it.
   *
   *  Optional for `disabled`: the deck's fly-away overlay renders this chip so
   *  the word beside it measures identically, but the overlay is inert. A
   *  no-op handler there would be a pressable that does nothing — and would
   *  have to be exempted from the "every pressable taps back" guard, which is
   *  a bad reason to weaken a guard. */
  onPress?: (e: GestureResponderEvent) => void;
  /** Renders the chip without making it pressable. */
  disabled?: boolean;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const tc = useThemeColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      style={[
        styles.chip,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: playing ? tc.gold : tc.goldWash,
          borderColor: playing ? tc.gold : tc.goldLine,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <SpeakerIcon
        size={Math.round(size * GLYPH_RATIO)}
        playing={playing}
        color={playing ? tc.goldDeep : tc.goldOnSurface}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    // The word yields, never the tap target: the whole point of the chip is a
    // size a thumb can hit, and a squeezed one puts us back where we started.
    flexShrink: 0,
  },
});
