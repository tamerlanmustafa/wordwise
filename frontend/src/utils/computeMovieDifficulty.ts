/**
 * Movie Difficulty Calculation Utilities
 *
 * Provides types and functions for computing CEFR-based movie difficulty ratings.
 */

export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface MovieDifficultyResult {
  level: CEFRLevel;
  score: number;
  breakdown: Record<string, number>;
}

export interface WordData {
  cefrLevel: CEFRLevel;
  confidence: number;
  frequencyRank?: number;
}

/**
 * CEFR level weights for difficulty calculation
 */
const LEVEL_WEIGHTS: Record<CEFRLevel, number> = {
  A1: 1.0,
  A2: 2.0,
  B1: 3.0,
  B2: 4.0,
  C1: 5.0,
  C2: 6.0
};

/**
 * Map difficulty score (0-100) to CEFR level
 */
function scoreToLevel(score: number): CEFRLevel {
  if (score < 20) return 'A1';
  if (score < 35) return 'A2';
  if (score < 50) return 'B1';
  if (score < 65) return 'B2';
  if (score < 80) return 'C1';
  return 'C2';
}

/**
 * Compute movie difficulty using confidence-weighted CEFR levels and frequency rarity.
 *
 * @param cefrBreakdown - Distribution of words across CEFR levels
 * @param words - Individual word data with confidence and frequency information
 * @returns Movie difficulty result with level, score, and breakdown
 */
export function computeMovieDifficulty(
  cefrBreakdown: Record<CEFRLevel, number>,
  words: WordData[]
): MovieDifficultyResult {
  const RARE_WORD_THRESHOLD = 5000;
  const RARITY_BOOST = 0.1;

  if (words.length === 0) {
    return {
      level: 'B1',
      score: 50,
      breakdown: cefrBreakdown
    };
  }

  let totalWeightedScore = 0;
  let totalWeight = 0;

  // Calculate confidence-weighted difficulty
  for (const word of words) {
    let baseWeight = LEVEL_WEIGHTS[word.cefrLevel] || 3.0;

    // Apply frequency rarity adjustment
    if (word.frequencyRank && word.frequencyRank > RARE_WORD_THRESHOLD) {
      baseWeight += RARITY_BOOST;
    }

    // Weight by confidence
    const weightedContribution = baseWeight * word.confidence;
    totalWeightedScore += weightedContribution;
    totalWeight += word.confidence;
  }

  // Calculate average difficulty (1-6 scale)
  const avgDifficulty = totalWeight > 0 ? totalWeightedScore / totalWeight : 3.0;

  // Map to 0-100 scale
  const score = Math.round(((avgDifficulty - 1.0) / 5.0) * 100);
  const clampedScore = Math.max(0, Math.min(100, score));

  // Determine CEFR level
  const level = scoreToLevel(clampedScore);

  return {
    level,
    score: clampedScore,
    breakdown: cefrBreakdown
  };
}
