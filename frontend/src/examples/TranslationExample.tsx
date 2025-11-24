/**
 * Example demonstrating the complete translation UI flow
 *
 * This file shows how all translation components work together.
 * Copy this pattern when implementing translation in other parts of the app.
 */

import { useState } from 'react';
import { Box, Container, Typography, Paper, Stack } from '@mui/material';
import WordCard from '../components/WordCard';
import TranslationModal from '../components/TranslationModal';
import LanguageSelector from '../components/LanguageSelector';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../hooks/useTranslation';
import type { WordFrequency } from '../types/script';

// Example word data
const EXAMPLE_WORDS: WordFrequency[] = [
  {
    word: 'escape',
    lemma: 'escape',
    count: 12,
    frequency: 0.0045,
    confidence: 0.95,
    frequency_rank: 2341
  },
  {
    word: 'adventure',
    lemma: 'adventure',
    count: 8,
    frequency: 0.0032,
    confidence: 0.92,
    frequency_rank: 3122
  },
  {
    word: 'mysterious',
    lemma: 'mysterious',
    count: 5,
    frequency: 0.0019,
    confidence: 0.88,
    frequency_rank: 4567
  }
];

export default function TranslationExample() {
  const { targetLanguage } = useLanguage();
  const [selectedWord, setSelectedWord] = useState<WordFrequency | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());

  const handleOpenDetails = (word: WordFrequency) => {
    setSelectedWord(word);
    setModalOpen(true);
  };

  const handleToggleSaved = (word: WordFrequency) => {
    setSavedWords(prev => {
      const next = new Set(prev);
      if (next.has(word.lemma)) {
        next.delete(word.lemma);
      } else {
        next.add(word.lemma);
      }
      return next;
    });
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h3" gutterBottom>
        Translation UI Example
      </Typography>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Language Preference
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select your target language for translations:
        </Typography>
        <LanguageSelector fullWidth />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Current selection: {targetLanguage}
        </Typography>
      </Paper>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Word Cards with Translation
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Click the translate icon to see inline translation. Click info icon for full modal.
        </Typography>

        <Stack spacing={2}>
          {EXAMPLE_WORDS.map((word) => (
            <WordCard
              key={word.lemma}
              word={word}
              levelColor="#4caf50"
              targetLang={targetLanguage}
              onOpenDetails={handleOpenDetails}
              onToggleSaved={handleToggleSaved}
              isSaved={savedWords.has(word.lemma)}
              variant="full"
            />
          ))}
        </Stack>
      </Paper>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Compact Grid View
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 1.5,
            mt: 2
          }}
        >
          {EXAMPLE_WORDS.map((word) => (
            <WordCard
              key={word.lemma}
              word={word}
              levelColor="#ff9800"
              targetLang={targetLanguage}
              onOpenDetails={handleOpenDetails}
              onToggleSaved={handleToggleSaved}
              isSaved={savedWords.has(word.lemma)}
              variant="compact"
            />
          ))}
        </Box>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Direct Translation Hook Usage
        </Typography>
        <DirectTranslationExample targetLang={targetLanguage} />
      </Paper>

      {/* Translation Modal */}
      <TranslationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        word={selectedWord}
        levelColor="#4caf50"
        targetLang={targetLanguage}
        exampleSentence={
          selectedWord?.word === 'escape'
            ? 'They tried to escape from the prison.'
            : undefined
        }
      />
    </Container>
  );
}

/**
 * Example showing direct use of useTranslation hook
 */
function DirectTranslationExample({ targetLang }: { targetLang: string }) {
  const { translated, translate, loading, error, cached } = useTranslation();

  const handleTranslate = () => {
    translate('hello', targetLang);
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Direct hook usage without components:
      </Typography>

      <Stack direction="row" spacing={2} alignItems="center">
        <button onClick={handleTranslate} disabled={loading}>
          {loading ? 'Translating...' : 'Translate "hello"'}
        </button>

        {translated && (
          <Typography variant="body1">
            → {translated} {cached && '(cached)'}
          </Typography>
        )}

        {error && (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        )}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
        Target language: {targetLang}
      </Typography>
    </Box>
  );
}
