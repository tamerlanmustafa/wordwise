import {
  Box,
  Typography,
  Paper,
  Divider,
  Stack
} from '@mui/material';
import type { ScriptAnalysisResult } from '../types/script';
import VocabularyTabs from './VocabularyTabs';
import LanguageSelector from './LanguageSelector';
import { useLanguage } from '../contexts/LanguageContext';

interface DifficultyCategoriesProps {
  analysis: ScriptAnalysisResult;
  userId?: number;
}

export default function DifficultyCategories({ analysis, userId }: DifficultyCategoriesProps) {
  const { targetLanguage } = useLanguage();

  return (
    <Box>
      {/* Summary Stats */}
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ xs: 'flex-start', md: 'center' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 2 }}
        >
          <Typography variant="h5" fontWeight="bold">
            {analysis.title}
          </Typography>

          <LanguageSelector size="small" showLabel={false} />
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              Total Words in Script
            </Typography>
            <Typography variant="h6" fontWeight="medium">
              {analysis.totalWords.toLocaleString()}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              Unique Words Classified
            </Typography>
            <Typography variant="h6" fontWeight="medium">
              {analysis.uniqueWords.toLocaleString()}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              Vocabulary Richness
            </Typography>
            <Typography variant="h6" fontWeight="medium">
              {((analysis.uniqueWords / analysis.totalWords) * 100).toFixed(1)}%
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* Vocabulary Tabs - On-Demand Translations */}
      <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
        Vocabulary by Difficulty Level
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Words are classified using CEFR wordlists (Oxford 3000/5000, EFLLex) and frequency analysis.
        Translations are loaded on-demand (10 words per page) to optimize API usage.
      </Typography>

      <VocabularyTabs
        categories={analysis.categories}
        targetLang={targetLanguage}
        userId={userId}
      />
    </Box>
  );
}
