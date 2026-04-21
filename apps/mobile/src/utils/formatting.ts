// Pure formatting / score helpers. No React Native imports, so safe to unit-test
// directly without pulling in native modules.

export const formatVoteCount = (count: number): string => {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
};

// Maps a 0–100 difficulty score onto a CEFR band. Bucket boundaries match
// backend/src/services/difficulty_scorer.py — don't drift without updating both.
export const scoreToCefr = (score: number | null | undefined): string | null => {
  if (score == null) return null;
  if (score <= 24) return 'A1';
  if (score <= 34) return 'A2';
  if (score <= 44) return 'B1';
  if (score <= 54) return 'B2';
  if (score <= 69) return 'C1';
  return 'C2';
};
