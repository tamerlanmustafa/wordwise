/**
 * The add-to-list panel, with a keyboard in front of it.
 *
 * Naming a new list opens a text field at the bottom edge of a panel that is
 * itself pinned to the bottom of the screen — so the keyboard covered the one
 * thing the reader was looking at, on the word feed and in the Lists tab
 * alike. Both surfaces now rise; nothing else does.
 *
 * These are source guards because the behaviour is layout on absolutely
 * positioned overlays, which the logic-only suite cannot render (see
 * CLAUDE.md, "Mobile test conventions"). The arithmetic that matters lives in
 * `hooks/useKeyboardHeight`, which is tested properly.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..', '..');

/** Comments stripped, so a guard never trips on the prose explaining it. */
function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the word-feed list panel clears the keyboard', () => {
  const panel = read('components', 'wordFeed', 'ListPanel.tsx');

  it('lifts to sit on the keyboard, not on top of its own inset', () => {
    // The offset is absolute, not additive. The panel rests at `bottom` —
    // the action rail's inset from the screen edge — and adding the keyboard
    // height to that parked it a whole rail-height above the keys. The travel
    // is the difference, floored so a short keyboard can never push it down.
    expect(panel).toContain('useKeyboardHeight');
    expect(panel).toContain('Math.max(0, keyboard + KEYBOARD_GAP - bottom)');
    expect(panel).not.toContain('bottom: bottom + lift');
  });

  it('animates the lift instead of assigning it', () => {
    // State lands in one frame while the keyboard spends its own ~250ms
    // sliding, so assigning the offset made the panel teleport and then wait
    // for the keys to catch up.
    expect(panel).toContain('Animated.timing');
    expect(panel).toContain('easing: KEYBOARD_EASING');
    expect(panel).toContain('duration,');
  });

  it('follows the keyboard rather than the create flag', () => {
    // Gating the lift on `creating` looks right and is not: submitting sets
    // it false the instant the request resolves, while the keyboard takes its
    // own ~250ms to retract — so the panel dropped *through* a keyboard still
    // on screen. Following the height means it travels with the keys, both
    // ways.
    expect(panel).toContain('keyboard > 0 ? Math.max(0');
    expect(panel).not.toContain('creating && keyboard');
  });

  it('does not wrap the card in a KeyboardAvoidingView', () => {
    // That moves a container, and the container here is the whole word card.
    // The word being filed should stay where the reader left it.
    expect(panel).not.toContain('KeyboardAvoidingView');
  });
});

describe('the panel says when the list continues below', () => {
  const panel = read('components', 'wordFeed', 'ListPanel.tsx');

  it('shows the scroll indicator', () => {
    expect(panel).toContain('showsVerticalScrollIndicator');
    expect(panel).not.toContain('showsVerticalScrollIndicator={false}');
  });

  it('measures overflow rather than counting lists', () => {
    // "Too many" is not a number: it depends on the panel height the caller
    // sets and the row height the theme's font scaling can change. Comparing
    // the box to its content answers the actual question.
    expect(panel).toContain('onContentSizeChange');
    expect(panel).toContain('rowsContentH > rowsBoxH');
  });

  it('draws the fade only when there is more to see', () => {
    // A permanent fade would imply more list on a panel showing all three of
    // them, which is worse than no sign at all.
    expect(panel).toContain('scrollable ?');
    expect(panel).toContain('moreFade');
  });
});

describe('every bottom sheet clears the keyboard', () => {
  const sheet = read('components', 'common', 'BottomSheet.tsx');

  it('lifts the sheet, once, for all of them', () => {
    // Handled in the shared container rather than per sheet: the geometry is
    // this component's, and its children know nothing about where it is
    // pinned. NewListSheet surfaced it; the fix belongs here.
    expect(sheet).toContain('useKeyboardHeight');
    expect(sheet).toContain('keyboard + KEYBOARD_GAP');
  });

  it('keeps the entrance animation separate from the lift', () => {
    // Two transforms, not one summed value: `slide` is the show/hide spring
    // and is driven natively. Folding the keyboard offset into it would make
    // the sheet re-animate its entrance every time the keyboard moved.
    expect(sheet).toContain('{ translateY: slide }, { translateY: Animated.multiply(lift, -1) }');
  });

  it('gives back the bar strip as it rises, rather than snapping it shut', () => {
    // The bar is behind the keyboard, so its reserved strip is a gap rather
    // than clearance. It is an animated child height, not padding, because
    // padding is layout and cannot share the native driver the sheet's own
    // transform runs on — before this, the strip snapped shut under a sheet
    // that was still gliding.
    expect(sheet).toContain('barSpace');
    expect(sheet).toContain('useNativeDriver: false');
    expect(sheet).not.toContain('keyboard > 0 ? 0 : bottomOffset');
  });

  it('rounds all four corners', () => {
    // Lifted over a keyboard the bottom pair are the sheet's visible edge,
    // and two hard corners there made it look torn off rather than floating.
    expect(sheet).toContain('borderRadius: 24');
    expect(sheet).not.toContain('borderTopStartRadius');
  });
});

/**
 * Closing, which is where the interesting failures were.
 *
 * Both panels hide without unmounting — one animates opacity and translate,
 * the other slides on a transform — so anything they hold survives the close
 * unless something clears it. Neither the keyboard nor a half-typed draft was
 * being cleared, and no amount of testing the *opening* path shows either.
 */
describe('closing a panel takes the keyboard with it', () => {
  const panel = read('components', 'wordFeed', 'ListPanel.tsx');
  const sheet = read('components', 'common', 'BottomSheet.tsx');

  it('the word-feed panel dismisses the keyboard when it hides', () => {
    // Otherwise the keys stay up over the word feed with nothing focused
    // behind them, and no obvious way to be rid of them.
    expect(panel).toContain('Keyboard.dismiss()');
    expect(panel).toContain('if (visible) return;');
  });

  it('the word-feed panel throws the draft away with it', () => {
    // The panel is never unmounted, so a half-typed name outlived the word it
    // belonged to: swipe on, reopen, and you are back in someone else's
    // create row.
    expect(panel).toContain("setDraftName('')");
    expect(panel).toContain('setCreating(false)');
  });

  it('every bottom sheet dismisses the keyboard when it closes', () => {
    // All three exits leave a focused field: the scrim tap, hardware back,
    // and a successful create — which calls onClose mid-focus and is the one
    // a user actually hits.
    expect(sheet).toContain('if (!visible) Keyboard.dismiss()');
  });
});

/**
 * Both backdrops are dimmed and blurred.
 *
 * A panel opening over a full-contrast page is two things competing for the
 * same attention, and on the word feed the page wins: it is large type on a
 * dark ground. Dimming alone leaves every edge behind it sharp; blurring
 * alone leaves the text legible enough to keep reading, which is the opposite
 * of what a modal surface is for.
 */
describe('the page behind a panel recedes', () => {
  const feed = read('components', 'WordFeedScreen.tsx');
  const sheet = read('components', 'common', 'BottomSheet.tsx');

  it.each([
    ['word feed', 'components/WordFeedScreen.tsx'],
    ['bottom sheet', 'components/common/BottomSheet.tsx'],
  ])('%s blurs and tints', (_name, file) => {
    const src = file.includes('WordFeed') ? feed : sheet;
    expect(src).toContain('BlurView');
    expect(src).toContain('intensity=');
    expect(src).toContain("tint={scheme === 'dark' ? 'dark' : 'light'}");
  });

  it('the word feed fades its backdrop with whichever panel opened', () => {
    // Appearing on mount would pop a dark sheet of glass over the card a beat
    // before the panel arrived on it — and the value has to be the one that
    // tracks *any* panel. `panelAnim` is the mix panel's own progress and
    // `listAnim` the list's, so either of those leaves the backdrop at zero
    // opacity for the other panel. That shipped for one screenshot: the panel
    // opened over a perfectly sharp word card.
    expect(feed).toContain('opacity: liftAnim');
    expect(feed).not.toContain('opacity: panelAnim');
  });

  it('the word feed keeps the whole backdrop as the dismiss target', () => {
    // Visuals inside the Pressable, not over it, or they swallow the tap that
    // closes the panel.
    expect(feed).toContain('<Pressable');
    expect(feed).toContain('panelScrim');
  });
});
