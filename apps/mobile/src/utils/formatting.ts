// Pure formatting / score helpers. No React Native imports, so safe to unit-test
// directly without pulling in native modules.

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
