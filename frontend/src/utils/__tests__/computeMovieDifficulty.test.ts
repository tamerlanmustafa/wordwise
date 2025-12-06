/**
 * Tests for Movie Difficulty Rating Engine
 */

import {
  computeMovieDifficulty,
  getLevelDescription,
  getLevelColor,
  type WordData,
  type CEFRLevel
} from '../computeMovieDifficulty';

describe('computeMovieDifficulty', () => {
  describe('basic CEFR level mapping', () => {
    test('all A1 words should result in A1 difficulty', () => {
      const cefrBreakdown = {
        A1: 100,
        A2: 0,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 0
      };

      const words: WordData[] = [
        { word: 'hello', count: 50, cefr: 'A1', confidenceLevel: 0.95, frequencyRank: 100 },
        { word: 'world', count: 40, cefr: 'A1', confidenceLevel: 0.92, frequencyRank: 150 },
        { word: 'yes', count: 30, cefr: 'A1', confidenceLevel: 0.98, frequencyRank: 80 }
      ];

      const result = computeMovieDifficulty(cefrBreakdown, words);

      expect(result.difficultyLevel).toBe('A1');
      expect(result.difficultyScore).toBeLessThan(1.7);
    });

    test('all C2 words should result in C2 difficulty', () => {
      const cefrBreakdown = {
        A1: 0,
        A2: 0,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 100
      };

      const words: WordData[] = [
        { word: 'quintessential', count: 5, cefr: 'C2', confidenceLevel: 0.88, frequencyRank: 25000 },
        { word: 'ubiquitous', count: 3, cefr: 'C2', confidenceLevel: 0.85, frequencyRank: 22000 },
        { word: 'ephemeral', count: 2, cefr: 'C2', confidenceLevel: 0.90, frequencyRank: 28000 }
      ];

      const result = computeMovieDifficulty(cefrBreakdown, words);

      expect(result.difficultyLevel).toBe('C2');
      expect(result.difficultyScore).toBeGreaterThan(4.5);
    });

    test('mixed distribution should result in B1/B2 difficulty', () => {
      const cefrBreakdown = {
        A1: 22,
        A2: 18,
        B1: 25,
        B2: 20,
        C1: 10,
        C2: 5
      };

      const words: WordData[] = [
        // A1 words (22%)
        { word: 'the', count: 500, cefr: 'A1', confidenceLevel: 0.99, frequencyRank: 1 },
        { word: 'is', count: 400, cefr: 'A1', confidenceLevel: 0.98, frequencyRank: 2 },
        // A2 words (18%)
        { word: 'because', count: 80, cefr: 'A2', confidenceLevel: 0.95, frequencyRank: 150 },
        { word: 'after', count: 70, cefr: 'A2', confidenceLevel: 0.94, frequencyRank: 200 },
        // B1 words (25%)
        { word: 'investigate', count: 50, cefr: 'B1', confidenceLevel: 0.90, frequencyRank: 2000 },
        { word: 'analyze', count: 45, cefr: 'B1', confidenceLevel: 0.88, frequencyRank: 2500 },
        // B2 words (20%)
        { word: 'contemplate', count: 30, cefr: 'B2', confidenceLevel: 0.85, frequencyRank: 5000 },
        { word: 'hypothesize', count: 25, cefr: 'B2', confidenceLevel: 0.82, frequencyRank: 6000 },
        // C1 words (10%)
        { word: 'paradigm', count: 15, cefr: 'C1', confidenceLevel: 0.80, frequencyRank: 12000 },
        // C2 words (5%)
        { word: 'ineffable', count: 5, cefr: 'C2', confidenceLevel: 0.75, frequencyRank: 20000 }
      ];

      const result = computeMovieDifficulty(cefrBreakdown, words);

      expect(['B1', 'B2']).toContain(result.difficultyLevel);
      expect(result.difficultyScore).toBeGreaterThan(2.4);
      expect(result.difficultyScore).toBeLessThan(3.8);
    });
  });

  describe('rarity adjustment', () => {
    test('high frequencyRank words should add +0.1 adjustment', () => {
      const cefrBreakdown = {
        A1: 50,
        A2: 50,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 0
      };

      const words: WordData[] = [
        { word: 'obscure1', count: 10, cefr: 'A1', confidenceLevel: 0.90, frequencyRank: 18000 },
        { word: 'obscure2', count: 10, cefr: 'A2', confidenceLevel: 0.90, frequencyRank: 19000 },
        { word: 'obscure3', count: 10, cefr: 'A1', confidenceLevel: 0.90, frequencyRank: 20000 }
      ];

      const result = computeMovieDifficulty(cefrBreakdown, words);

      expect(result.rarityAdjustment).toBe(0.1);
      expect(result.metadata.averageFrequencyRank).toBeGreaterThan(15000);
    });

    test('low frequencyRank words should add -0.1 adjustment', () => {
      const cefrBreakdown = {
        A1: 50,
        A2: 50,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 0
      };

      const words: WordData[] = [
        { word: 'the', count: 100, cefr: 'A1', confidenceLevel: 0.99, frequencyRank: 1 },
        { word: 'is', count: 90, cefr: 'A2', confidenceLevel: 0.98, frequencyRank: 2 },
        { word: 'and', count: 85, cefr: 'A1', confidenceLevel: 0.99, frequencyRank: 3 }
      ];

      const result = computeMovieDifficulty(cefrBreakdown, words);

      expect(result.rarityAdjustment).toBe(-0.1);
      expect(result.metadata.averageFrequencyRank).toBeLessThan(5000);
    });

    test('medium frequencyRank words should have 0 adjustment', () => {
      const cefrBreakdown = {
        A1: 50,
        A2: 50,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 0
      };

      const words: WordData[] = [
        { word: 'word1', count: 50, cefr: 'A1', confidenceLevel: 0.90, frequencyRank: 7000 },
        { word: 'word2', count: 50, cefr: 'A2', confidenceLevel: 0.90, frequencyRank: 8000 },
        { word: 'word3', count: 50, cefr: 'A1', confidenceLevel: 0.90, frequencyRank: 9000 }
      ];

      const result = computeMovieDifficulty(cefrBreakdown, words);

      expect(result.rarityAdjustment).toBe(0);
    });
  });

  describe('confidence weighting', () => {
    test('low confidence should reduce effective contribution', () => {
      const cefrBreakdown = {
        A1: 0,
        A2: 0,
        B1: 0,
        B2: 100,
        C1: 0,
        C2: 0
      };

      const highConfidenceWords: WordData[] = [
        { word: 'word1', count: 10, cefr: 'B2', confidenceLevel: 0.95, frequencyRank: 5000 },
        { word: 'word2', count: 10, cefr: 'B2', confidenceLevel: 0.93, frequencyRank: 5100 }
      ];

      const lowConfidenceWords: WordData[] = [
        { word: 'word1', count: 10, cefr: 'B2', confidenceLevel: 0.50, frequencyRank: 5000 },
        { word: 'word2', count: 10, cefr: 'B2', confidenceLevel: 0.48, frequencyRank: 5100 }
      ];

      const highConfResult = computeMovieDifficulty(cefrBreakdown, highConfidenceWords);
      const lowConfResult = computeMovieDifficulty(cefrBreakdown, lowConfidenceWords);

      expect(lowConfResult.difficultyScore).toBeLessThan(highConfResult.difficultyScore);
    });
  });

  describe('edge cases', () => {
    test('should throw error for empty word array', () => {
      const cefrBreakdown = {
        A1: 100,
        A2: 0,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 0
      };

      expect(() => {
        computeMovieDifficulty(cefrBreakdown, []);
      }).toThrow('Cannot compute difficulty: no words provided');
    });

    test('should handle words with missing CEFR data gracefully', () => {
      const cefrBreakdown = {
        A1: 100,
        A2: 0,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 0
      };

      const words: WordData[] = [
        { word: 'hello', count: 50, cefr: 'A1', confidenceLevel: 0.95, frequencyRank: 100 },
        { word: 'unknown', count: 10, cefr: '' as any, confidenceLevel: 0.50, frequencyRank: 0 }
      ];

      const result = computeMovieDifficulty(cefrBreakdown, words);
      expect(result.difficultyLevel).toBeDefined();
    });
  });

  describe('metadata calculation', () => {
    test('should calculate correct metadata', () => {
      const cefrBreakdown = {
        A1: 50,
        A2: 50,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 0
      };

      const words: WordData[] = [
        { word: 'word1', count: 100, cefr: 'A1', confidenceLevel: 0.90, frequencyRank: 1000 },
        { word: 'word2', count: 50, cefr: 'A2', confidenceLevel: 0.80, frequencyRank: 2000 }
      ];

      const result = computeMovieDifficulty(cefrBreakdown, words);

      expect(result.metadata.uniqueWords).toBe(2);
      expect(result.metadata.totalWords).toBe(150);
      expect(result.metadata.averageConfidence).toBe(0.85);
      expect(result.metadata.averageFrequencyRank).toBe(1500);
    });
  });
});

describe('getLevelDescription', () => {
  test('should return correct descriptions for all levels', () => {
    expect(getLevelDescription('A1')).toContain('Beginner');
    expect(getLevelDescription('B1')).toContain('Intermediate');
    expect(getLevelDescription('C2')).toContain('Proficient');
  });
});

describe('getLevelColor', () => {
  test('should return hex color codes', () => {
    expect(getLevelColor('A1')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getLevelColor('C2')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('A1 should be green, C2 should be purple', () => {
    expect(getLevelColor('A1')).toBe('#4caf50');
    expect(getLevelColor('C2')).toBe('#9c27b0');
  });
});
