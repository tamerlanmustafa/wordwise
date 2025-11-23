export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface ScriptSearchResult {
  title: string;
  subtitle?: string;
  writer?: string;
  link: string;
}

export interface WordFrequency {
  word: string;
  lemma: string;
  count: number;
  frequency: number;
  confidence: number;
  frequency_rank?: number | null;
}

export interface DifficultyCategory {
  level: CEFRLevel;
  words: WordFrequency[];
  description: string;
}

export interface ScriptAnalysisResult {
  title: string;
  totalWords: number;
  uniqueWords: number;
  categories: DifficultyCategory[];
}
