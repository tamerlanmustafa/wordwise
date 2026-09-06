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
 * word deck's backdrop and poster stay tappable and clearly *there*, just no
 * longer competing.
 *
 * ## The two are different shapes, not just different strengths
 *
 * The first pass had ambient uniformly lighter than modal, on the reasoning
 * that it sits over live controls. That was wrong on a device: a mid alpha of
 * black over a bright film still does not read as *dark*, it reads as **grey**
 * — the poster is knocked back toward the middle of the range rather than into
 * the background, and the whole screen looks washed rather than focused.
 *
 * So ambient is now the steeper of the two. Its base stays lighter than
 * modal's, because the centre of the screen is the deck and nothing should be
 * fighting it there; its edge goes considerably darker, because the edges are
 * where the poster and the backdrop actually live. That is what a vignette is
 * for, and it is why the pairing cannot be described as one number.
 *
 * A flat scrim and a focus vignette are answering different questions: modal
 * asks "can I touch this?", ambient asks "where do I look?".
 *
 * The edge is always darker than the base — equal values would render two flat
 * layers and read as a grey sheet rather than as depth.
 *
 * Light mode needs a lighter hand at both strengths: the same alpha that reads
 * as "behind something" on a dark ground reads as "broken" on a pale one.
 * Ambient uses plain black in both, unlike modal's warm brown — over film
 * artwork a tinted dim reads as a colour cast rather than as shadow.
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
    ? { base: 'rgba(0,0,0,0.55)', edge: 'rgba(0,0,0,0.88)' }
    : { base: 'rgba(0,0,0,0.30)', edge: 'rgba(0,0,0,0.62)' };
}
