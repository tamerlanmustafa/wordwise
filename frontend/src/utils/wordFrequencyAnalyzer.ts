import type { WordFrequency, DifficultyCategory } from '../types/script';

/**
 * Tokenizes text into words, removing punctuation and converting to lowercase
 */
export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ') // Keep hyphens and apostrophes in words
    .split(/\s+/)
    .filter(word => word.length > 0 && /[a-z]/.test(word)); // Filter out numbers-only
}

/**
 * Counts word frequencies in the given text
 */
export function countWordFrequencies(text: string): Map<string, number> {
  const words = tokenizeText(text);
  const frequencies = new Map<string, number>();

  words.forEach(word => {
    frequencies.set(word, (frequencies.get(word) || 0) + 1);
  });

  return frequencies;
}

/**
 * Normalizes frequencies to a 0-1 scale
 */
export function normalizeFrequencies(frequencies: Map<string, number>): WordFrequency[] {
  const maxFreq = Math.max(...Array.from(frequencies.values()));

  return Array.from(frequencies.entries())
    .map(([word, count]) => ({
      word,
      lemma: word, // Use word as lemma for local analysis
      count,
      frequency: count / maxFreq,
      confidence: 1.0, // Default confidence for local analysis
      frequency_rank: null // No rank data for local analysis
    }))
    .sort((a, b) => b.count - a.count); // Sort by count descending
}

/**
 * Assigns CEFR levels based on word frequency in the script
 * More frequent = easier level, less frequent = harder level
 */
export function categorizeWordsByFrequency(
  wordFrequencies: WordFrequency[]
): DifficultyCategory[] {
  const totalWords = wordFrequencies.length;

  if (totalWords === 0) {
    return [];
  }

  // Define percentile thresholds for each level
  // A1: Top 15% most frequent words
  // A2: Next 15%
  // B1: Next 20%
  // B2: Next 20%
  // C1: Next 15%
  // C2: Bottom 15% (rarest words)
  const thresholds = {
    A1: 0.15,
    A2: 0.30,
    B1: 0.50,
    B2: 0.70,
    C1: 0.85,
    C2: 1.00
  };

  const categories: DifficultyCategory[] = [
    { level: 'A1', words: [], description: 'Most frequent words (easiest)' },
    { level: 'A2', words: [], description: 'Very common words' },
    { level: 'B1', words: [], description: 'Common words' },
    { level: 'B2', words: [], description: 'Less common words' },
    { level: 'C1', words: [], description: 'Uncommon words' },
    { level: 'C2', words: [], description: 'Rarest words (hardest)' }
  ];

  wordFrequencies.forEach((wordFreq, index) => {
    const percentile = (index + 1) / totalWords;

    if (percentile <= thresholds.A1) {
      categories[0].words.push(wordFreq);
    } else if (percentile <= thresholds.A2) {
      categories[1].words.push(wordFreq);
    } else if (percentile <= thresholds.B1) {
      categories[2].words.push(wordFreq);
    } else if (percentile <= thresholds.B2) {
      categories[3].words.push(wordFreq);
    } else if (percentile <= thresholds.C1) {
      categories[4].words.push(wordFreq);
    } else {
      categories[5].words.push(wordFreq);
    }
  });

  return categories;
}

/**
 * Main function to analyze script text and categorize words by difficulty
 */
export function analyzeScriptDifficulty(scriptText: string, movieTitle: string) {
  const frequencies = countWordFrequencies(scriptText);
  const normalized = normalizeFrequencies(frequencies);
  const categories = categorizeWordsByFrequency(normalized);

  return {
    title: movieTitle,
    totalWords: tokenizeText(scriptText).length,
    uniqueWords: frequencies.size,
    categories
  };
}
