/**
 * How dark "behind something" is, at the two strengths this app uses.
 *
 * Here rather than beside the `Vignette` that consumes it, for a reason worth
 * keeping: that component imports `expo-linear-gradient`, a native module jest
 * cannot load, so a pure function living next to it could not be unit tested
 * at all. Colour decisions belong in `theme/` and drawing belongs in a
 * component; the split is what makes the numbers checkable.
 *
 * Both surfaces that recede read this, so they agree with each other. They had
 * one copy of these values and a second would have drifted — a screen that
 * dims to one depth behind a sheet and another behind a wash reads as two
 * different states rather than one idea.
 *
 * **modal** — something is over this and you cannot touch it. Search's panel,
 * a bottom sheet. Heavy on purpose: the dim is also the promise that taps land
 * on the scrim rather than on what is under it.
 *
 * **ambient** — nothing is covering this; it is simply not the subject. The
 * word deck's backdrop and poster stay legible, tappable and clearly *there*,
 * just no longer competing. Modal weight here would read as a screen waiting
 * for a dialog that never arrives, and would bury the back button with it.
 *
 * The edge is always darker than the base — that difference is the vignette,
 * and equal values would render two flat layers and read as a grey sheet
 * rather than as depth.
 *
 * Light mode needs a lighter hand at both strengths: the same alpha that reads
 * as "behind something" on a dark ground reads as "broken" on a pale one.
 */
export function dimColors(
  strength: 'modal' | 'ambient',
  scheme: 'light' | 'dark',
): { base: string; edge: string } {
  if (strength === 'modal') {
    return scheme === 'dark'
      ? { base: 'rgba(0,0,0,0.62)', edge: 'rgba(0,0,0,0.72)' }
      : { base: 'rgba(20,16,10,0.38)', edge: 'rgba(20,16,10,0.46)' };
  }
  return scheme === 'dark'
    ? { base: 'rgba(0,0,0,0.34)', edge: 'rgba(0,0,0,0.58)' }
    : { base: 'rgba(20,16,10,0.16)', edge: 'rgba(20,16,10,0.30)' };
}
