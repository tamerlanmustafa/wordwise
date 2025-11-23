import {
  Box,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Paper,
  Divider,
  Stack
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ScriptAnalysisResult, CEFRLevel } from '../types/script';
import WordCarousel from './WordCarousel';

interface DifficultyCategoriesProps {
  analysis: ScriptAnalysisResult;
}

const LEVEL_COLORS: Record<CEFRLevel, string> = {
  A1: '#4caf50', // Green - easiest
  A2: '#8bc34a', // Light green
  B1: '#ffc107', // Amber
  B2: '#ff9800', // Orange
  C1: '#ff5722', // Deep orange
  C2: '#f44336', // Red - hardest
};

const LEVEL_LABELS: Record<CEFRLevel, string> = {
  A1: 'A1 - Beginner',
  A2: 'A2 - Elementary',
  B1: 'B1 - Intermediate',
  B2: 'B2 - Upper Intermediate',
  C1: 'C1/C2 - Advanced',
  C2: 'C2 - Proficient',  // Not displayed (merged into C1)
};

export default function DifficultyCategories({ analysis }: DifficultyCategoriesProps) {
  return (
    <Box>
      {/* Summary Stats */}
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h5" gutterBottom fontWeight="bold">
          {analysis.title}
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={4}>
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

      {/* Difficulty Categories */}
      <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
        Vocabulary by Difficulty Level
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Words are classified using CEFR wordlists (Oxford 3000/5000, EFLLex) and frequency analysis.
        Words are sorted from easier to harder within each level based on frequency ranking.
      </Typography>

      {analysis.categories.map((category) => (
        <Accordion
          key={category.level}
          defaultExpanded={category.level === 'A1'}
          sx={{
            mb: 2,
            '&:before': { display: 'none' },
            boxShadow: 2,
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{
              backgroundColor: `${LEVEL_COLORS[category.level]}15`,
              borderLeft: `4px solid ${LEVEL_COLORS[category.level]}`,
              '&:hover': {
                backgroundColor: `${LEVEL_COLORS[category.level]}25`,
              },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
              <Chip
                label={LEVEL_LABELS[category.level]}
                sx={{
                  backgroundColor: LEVEL_COLORS[category.level],
                  color: 'white',
                  fontWeight: 'bold',
                  minWidth: 120,
                }}
              />
              <Typography variant="body2" color="text.secondary">
                {category.description}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ ml: 'auto', fontWeight: 'medium' }}
              >
                {category.words.length} words
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 2 }}>
            <WordCarousel
              words={category.words}
              levelColor={LEVEL_COLORS[category.level]}
              wordsPerPage={30}
            />
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}
