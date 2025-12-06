/**
 * Movie Difficulty Rating Engine for WordWise
 *
 * Computes a CEFR difficulty level for movies using vocabulary distribution,
 * confidence levels, and word frequency data.
 *
 * @module computeMovieDifficulty
 */

export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface WordData {
  word: string;
  count: number;
  cefr: CEFRLevel;
  confidenceLevel: number;  // 0.0 → 1.0
  frequencyRank: number;    // 1 = most common
}

export interface MovieDifficultyResult {
  difficultyLevel: CEFRLevel;
  difficultyScore: number;
  breakdown: Record<CEFRLevel, number>;
  rarityAdjustment: number;
  metadata: {
    averageConfidence: number;
    averageFrequencyRank: number;
    totalWords: number;
    uniqueWords: number;
  };
}

/**
 * CEFR level weights for difficulty calculation
 * A1 (beginner) = 1, C2 (proficient) = 6
 */
const CEFR_WEIGHTS: Record<CEFRLevel, number> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6
};

/**
 * Difficulty score ranges mapped to CEFR levels
 */
const DIFFICULTY_RANGES: Array<{ max: number; level: CEFRLevel }> = [
  { max: 1.7, level: 'A1' },
  { max: 2.4, level: 'A2' },
  { max: 3.1, level: 'B1' },
  { max: 3.8, level: 'B2' },
  { max: 4.5, level: 'C1' },
  { max: Infinity, level: 'C2' }
];

/**
 * Frequency rank thresholds for rarity adjustment
 */
const FREQUENCY_THRESHOLDS = {
  RARE: 15000,    // Words beyond this rank are considered rare
  COMMON: 5000    // Words below this rank are very common
};

/**
 * Computes the movie difficulty level using CEFR distribution and word-level data
 *
 * @param cefrBreakdown - Percentage distribution across CEFR levels (0-100%)
 * @param words - Array of word-level data including CEFR, confidence, and frequency
 * @returns Complete difficulty analysis with level, score, and metadata
 *
 * @example
 * ```ts
 * const result = computeMovieDifficulty(
 *   { A1: 22, A2: 18, B1: 25, B2: 20, C1: 10, C2: 5 },
 *   words
 * );
 * console.log(result.difficultyLevel); // "B1"
 * ```
 */
export function computeMovieDifficulty(
  cefrBreakdown: Record<CEFRLevel, number>,
  words: WordData[]
): MovieDifficultyResult {
  // Validate inputs
  if (!words || words.length === 0) {
    throw new Error('Cannot compute difficulty: no words provided');
  }

  // Group words by CEFR level
  const wordsByLevel: Record<CEFRLevel, WordData[]> = {
    A1: [],
    A2: [],
    B1: [],
    B2: [],
    C1: [],
    C2: []
  };

  words.forEach(word => {
    if (word.cefr && wordsByLevel[word.cefr]) {
      wordsByLevel[word.cefr].push(word);
    }
  });

  // Calculate average confidence per CEFR level
  const averageConfidenceByLevel: Record<CEFRLevel, number> = {} as Record<CEFRLevel, number>;

  (Object.keys(CEFR_WEIGHTS) as CEFRLevel[]).forEach(level => {
    const levelWords = wordsByLevel[level];
    if (levelWords.length > 0) {
      const totalConfidence = levelWords.reduce((sum, w) => sum + w.confidenceLevel, 0);
      averageConfidenceByLevel[level] = totalConfidence / levelWords.length;
    } else {
      averageConfidenceByLevel[level] = 0;
    }
  });

  // STEP 2: Calculate confidence-weighted contribution for each CEFR level
  let totalContribution = 0;

  (Object.keys(CEFR_WEIGHTS) as CEFRLevel[]).forEach(level => {
    const percentage = cefrBreakdown[level] || 0;
    const weight = CEFR_WEIGHTS[level];
    const avgConfidence = averageConfidenceByLevel[level];

    // Effective contribution = (percentage * weight) * avgConfidence
    // Convert percentage from 0-100 to 0-1 for calculation
    const effectiveContribution = (percentage / 100) * weight * avgConfidence;
    totalContribution += effectiveContribution;
  });

  // STEP 3: Calculate frequency rarity adjustment
  const totalFrequencyRank = words.reduce((sum, w) => sum + (w.frequencyRank || 0), 0);
  const averageRank = totalFrequencyRank / words.length;

  let rarityAdjustment = 0;
  if (averageRank > FREQUENCY_THRESHOLDS.RARE) {
    rarityAdjustment = 0.1;  // Rare words increase difficulty
  } else if (averageRank < FREQUENCY_THRESHOLDS.COMMON) {
    rarityAdjustment = -0.1;  // Common words decrease difficulty
  }

  // STEP 4: Calculate final score
  const finalScore = totalContribution + rarityAdjustment;

  // STEP 5: Map final score to CEFR level
  const difficultyLevel = mapScoreToLevel(finalScore);

  // Calculate metadata
  const totalConfidence = words.reduce((sum, w) => sum + w.confidenceLevel, 0);
  const totalWordCount = words.reduce((sum, w) => sum + w.count, 0);

  return {
    difficultyLevel,
    difficultyScore: Math.round(finalScore * 100) / 100, // Round to 2 decimals
    breakdown: cefrBreakdown,
    rarityAdjustment: Math.round(rarityAdjustment * 100) / 100,
    metadata: {
      averageConfidence: Math.round((totalConfidence / words.length) * 100) / 100,
      averageFrequencyRank: Math.round(averageRank),
      totalWords: totalWordCount,
      uniqueWords: words.length
    }
  };
}

/**
 * Maps a difficulty score to the corresponding CEFR level
 *
 * @param score - Calculated difficulty score
 * @returns CEFR level (A1-C2)
 */
function mapScoreToLevel(score: number): CEFRLevel {
  for (const range of DIFFICULTY_RANGES) {
    if (score < range.max) {
      return range.level;
    }
  }
  return 'C2'; // Fallback for extremely high scores
}

/**
 * Gets a human-readable description for a CEFR level
 *
 * @param level - CEFR level
 * @returns User-friendly description
 */
export function getLevelDescription(level: CEFRLevel): string {
  const descriptions: Record<CEFRLevel, string> = {
    A1: 'Beginner - Basic everyday expressions',
    A2: 'Elementary - Simple conversations',
    B1: 'Intermediate - Familiar topics',
    B2: 'Upper Intermediate - Complex texts',
    C1: 'Advanced - Flexible language use',
    C2: 'Proficient - Native-like fluency'
  };
  return descriptions[level];
}

/**
 * Gets a color code for visual representation of difficulty
 *
 * @param level - CEFR level
 * @returns Hex color code
 */
export function getLevelColor(level: CEFRLevel): string {
  const colors: Record<CEFRLevel, string> = {
    A1: '#4caf50',  // Green
    A2: '#8bc34a',  // Light green
    B1: '#ffc107',  // Yellow
    B2: '#ff9800',  // Orange
    C1: '#f44336',  // Red
    C2: '#9c27b0'   // Purple
  };
  return colors[level];
}
