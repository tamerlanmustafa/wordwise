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

  it('lifts by the keyboard height', () => {
    expect(panel).toContain('useKeyboardHeight');
    expect(panel).toContain('bottom: bottom + lift');
  });

  it('follows the keyboard rather than the create flag', () => {
    // Gating the lift on `creating` looks right and is not: submitting sets
    // it false the instant the request resolves, while the keyboard takes its
    // own ~250ms to retract — so the panel dropped *through* a keyboard still
    // on screen. Following the height means it travels with the keys, both
    // ways.
    expect(panel).toContain('keyboard > 0 ? keyboard + 8 : 0');
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
    expect(sheet).toContain('translateY: -keyboard');
  });

  it('keeps the entrance animation separate from the lift', () => {
    // Two transforms, not one summed value: `slide` is the show/hide spring
    // and is driven natively. Folding the keyboard offset into it would make
    // the sheet re-animate its entrance every time the keyboard moved.
    expect(sheet).toContain('{ translateY: slide }, { translateY: -keyboard }');
  });

  it('stops reserving the bottom bar while the keyboard is up', () => {
    // The bar is behind the keyboard then, so the space would be a dead gap
    // between the sheet and the keys.
    expect(sheet).toContain('keyboard > 0 ? 0 : bottomOffset');
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
