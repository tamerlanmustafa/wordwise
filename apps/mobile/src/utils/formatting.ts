// Pure formatting / score helpers. No React Native imports, so safe to unit-test
// directly without pulling in native modules.

/**
 * A count shortened to **at most four characters**: 907 stays 907, 1,667
 * becomes "1.7k", 12,345 becomes "12k".
 *
 * The four-character ceiling is the contract, not a side effect. This exists
 * for the home card's vocabulary ring, whose hole is 36pt across — "1,667" at
 * 12pt mono is wider than that and painted over the gold arc. Dropping the
 * decimal past 10k is what makes the bound hold across the whole plausible
 * range (up to 999,499) rather than only for the sizes the catalogue happens to
 * contain today — the largest film speaks 3,390 distinct words. A guarantee
 * that depends on your data staying small is not one.
 *
 * It is also honest about precision: nobody choosing a film needs 1,667 rather
 * than "about 1.7 thousand".
 */
export const formatCompactCount = (count: number): string => {
  if (count < 1000) return `${count}`;
  const k = count / 1000;
  // Threshold on the *rounded* value, not the raw one: 9,999 is under 10,000
  // but `toFixed(1)` turns it into "10.0", so a raw check would still emit the
  // five-character "10.0k" it was meant to prevent.
  return k >= 9.95 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
};

/**
 * Vote counts, which sit on a card row with room to spare and so keep their
 * decimal all the way up ("12.3k").
 *
 * Deliberately not an alias of {@link formatCompactCount}: that one trades
 * precision for a hard width bound because it renders inside a 36pt circle,
 * and this one has no such box to fit.
 */
export const formatVoteCount = (count: number): string => {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
};

/**
 * Maps a film's 0–100 difficulty score onto a CEFR band.
 *
 * **This is a mirror, not the source.** The boundaries live in
 * `backend/src/services/movie_cefr.py` (`CEFR_SCORE_RANGES`), which is what
 * decides *which films are on a level's shelf*; this copy only decides what
 * the card prints next to the year. Let the two drift and a B1 shelf shows
 * cards labelled B2 — the same class of bug #103 fixed inside the backend,
 * except across the API boundary where no single source is possible.
 * `utils/__tests__/formatting.test.ts` pins the numbers on this side.
 *
 * Recalibrated 2026-09-03 alongside the backend. The old bands assumed the
 * scorer used the full 0–100 range; it doesn't — the hardest film in the
 * catalogue scores 72, so the old C2 floor of 70 held 7 films. See the Python
 * constant for the measured distribution behind these cuts.
 *
 * Prefer `movie.cefr_level` from the API when the payload carries it: that is
 * the server's own answer and cannot disagree with the shelf the film is on.
 * This function is the fallback for payloads that don't.
 */
export const scoreToCefr = (score: number | null | undefined): string | null => {
  if (score == null) return null;
  if (score <= 24) return 'A1';
  if (score <= 34) return 'A2';
  if (score <= 44) return 'B1';
  if (score <= 52) return 'B2';
  if (score <= 57) return 'C1';
  return 'C2';
};
