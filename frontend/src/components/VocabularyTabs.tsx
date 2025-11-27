import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Tabs,
  Tab,
  List,
  ListItem,
  Typography,
  Paper,
  Stack,
  Chip,
  Skeleton,
  Container,
  IconButton,
  Divider,
  Pagination
} from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import type { DifficultyCategory, WordFrequency } from '../types/script';
import { translateBatch } from '../services/scriptService';

interface VocabularyTabsProps {
  categories: DifficultyCategory[];
  targetLang: string;
  userId?: number;
}

interface TranslatedWord {
  word: string;
  lemma: string;
  translation: string;
  confidence?: number;
  cached: boolean;
  provider?: string | null;
}

interface CEFRGroup {
  level: string;
  description: string;
  words: WordFrequency[];
  translatedWords: Map<string, TranslatedWord>;
  color: string;
  currentPage: number;
  totalPages: number;
}

const LEVEL_COLORS: Record<string, string> = {
  A1: '#4caf50',
  A2: '#8bc34a',
  B1: '#ffc107',
  B2: '#ff9800',
  C1: '#f44336',
  C2: '#9c27b0'
};

const WORDS_PER_PAGE = 10;

export default function VocabularyTabs({
  categories,
  targetLang,
  userId
}: VocabularyTabsProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [groups, setGroups] = useState<CEFRGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Merge C1 and C2 into single "Advanced" category
  const mergedCategories = useMemo(() => {
    return categories.reduce((acc, category) => {
      if (category.level === 'C1' || category.level === 'C2') {
        const advancedIndex = acc.findIndex(c => c.level === 'C1');
        if (advancedIndex === -1) {
          acc.push({
            ...category,
            level: 'C1' as const,
            description: 'Advanced vocabulary (C1 & C2)'
          });
        } else {
          acc[advancedIndex].words.push(...category.words);
        }
      } else {
        acc.push(category);
      }
      return acc;
    }, [] as DifficultyCategory[]);
  }, [categories]);

  // Initialize groups with pagination info
  useEffect(() => {
    const initialGroups: CEFRGroup[] = mergedCategories.map(category => ({
      level: category.level,
      description: category.description,
      words: category.words,
      translatedWords: new Map(),
      color: LEVEL_COLORS[category.level] || '#4caf50',
      currentPage: 1,
      totalPages: Math.ceil(category.words.length / WORDS_PER_PAGE)
    }));
    setGroups(initialGroups);
  }, [mergedCategories]);

  // Clear translations when target language changes
  useEffect(() => {
    if (groups.length === 0) return;

    setGroups(prevGroups =>
      prevGroups.map(group => ({
        ...group,
        translatedWords: new Map() // Clear all translations
      }))
    );
  }, [targetLang]);

  // Load translations for current page of active tab
  useEffect(() => {
    if (groups.length === 0) return;

    const loadPageTranslations = async () => {
      const activeGroup = groups[activeTab];
      if (!activeGroup) return;

      const { currentPage, words, translatedWords } = activeGroup;
      const startIdx = (currentPage - 1) * WORDS_PER_PAGE;
      const endIdx = startIdx + WORDS_PER_PAGE;
      const pageWords = words.slice(startIdx, endIdx);

      // Check if we already have translations for this page
      const wordsToTranslate = pageWords.filter(w =>
        w.word && w.word.trim() && !translatedWords.has(w.word.toLowerCase())
      );

      if (wordsToTranslate.length === 0) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const uniqueWords = Array.from(new Set(wordsToTranslate.map(w => w.word)))
          .filter(w => w != null && typeof w === 'string' && w.trim().length > 0);

        if (uniqueWords.length === 0) {
          setLoading(false);
          return;
        }

        const batchResponse = await translateBatch(
          uniqueWords,
          targetLang,
          'auto',
          userId
        );

        // Update the translatedWords map for this group
        setGroups(prevGroups => {
          const newGroups = [...prevGroups];
          const newMap = new Map(newGroups[activeTab].translatedWords);

          batchResponse.results.forEach((result) => {
            newMap.set(result.source.toLowerCase(), {
              word: result.source,
              lemma: result.source,
              translation: result.translated,
              confidence: undefined,
              cached: result.cached,
              provider: result.provider || undefined
            });
          });

          newGroups[activeTab] = {
            ...newGroups[activeTab],
            translatedWords: newMap
          };

          return newGroups;
        });
      } catch (err: any) {
        console.error('Failed to load translations:', err);
        setError('Failed to load translations. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadPageTranslations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, groups[activeTab]?.currentPage, targetLang, userId]);

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handlePageChange = (_: React.ChangeEvent<unknown>, page: number) => {
    setGroups(prevGroups => {
      const newGroups = [...prevGroups];
      newGroups[activeTab] = {
        ...newGroups[activeTab],
        currentPage: page
      };
      return newGroups;
    });
  };

  if (groups.length === 0) {
    return (
      <Box sx={{ width: '100%' }}>
        <Paper elevation={2} sx={{ borderRadius: 2, mb: 3 }}>
          <Skeleton variant="rectangular" height={64} />
        </Paper>
        <Container maxWidth="lg">
          <Stack spacing={1}>
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} variant="rectangular" height={48} />
            ))}
          </Stack>
        </Container>
      </Box>
    );
  }

  if (error) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="error">{error}</Typography>
      </Paper>
    );
  }

  const activeGroup = groups[activeTab];
  if (!activeGroup) return null;

  const startIdx = (activeGroup.currentPage - 1) * WORDS_PER_PAGE;
  const endIdx = startIdx + WORDS_PER_PAGE;
  const currentPageWords = activeGroup.words.slice(startIdx, endIdx);

  return (
    <Box sx={{ width: '100%' }}>
      {/* Tabs Navigation */}
      <Paper elevation={2} sx={{ borderRadius: 2, mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            px: 2,
            '& .MuiTab-root': {
              minHeight: 64,
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '1rem'
            }
          }}
        >
          {groups.map((group) => (
            <Tab
              key={group.level}
              label={
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography variant="h6" fontWeight={700}>
                    {group.level}
                  </Typography>
                  <Chip
                    label={group.words.length}
                    size="small"
                    sx={{
                      bgcolor: `${group.color}20`,
                      color: group.color,
                      fontWeight: 600,
                      fontSize: '0.875rem'
                    }}
                  />
                </Stack>
              }
              sx={{
                color: 'text.secondary',
                '&.Mui-selected': {
                  color: group.color
                }
              }}
            />
          ))}
        </Tabs>
      </Paper>

      {/* Active Tab Content */}
      <Container maxWidth="lg">
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
          <Box>
            <Typography variant="h5" fontWeight={700} sx={{ color: activeGroup.color }}>
              {activeGroup.level} Level
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {activeGroup.description}
            </Typography>
          </Box>
          <Chip
            label={`${activeGroup.words.length} words`}
            sx={{
              bgcolor: `${activeGroup.color}15`,
              color: activeGroup.color,
              fontWeight: 600
            }}
          />
        </Stack>

        {/* Word List */}
        <Paper elevation={1} sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
          <List sx={{ py: 0 }}>
            {currentPageWords.length === 0 ? (
              <ListItem>
                <Typography variant="body2" color="text.secondary">
                  No words in this level
                </Typography>
              </ListItem>
            ) : (
              currentPageWords.map((wordFreq, index) => {
                const translatedWord = activeGroup.translatedWords.get(wordFreq.word.toLowerCase());
                const isLoading = !translatedWord && loading;

                return (
                  <Box key={`${wordFreq.lemma}-${index}`}>
                    <ListItem
                      sx={{
                        py: 2,
                        px: 3,
                        '&:hover': {
                          bgcolor: `${activeGroup.color}08`
                        }
                      }}
                    >
                      {isLoading ? (
                        <Stack sx={{ width: '100%' }} spacing={1}>
                          <Skeleton variant="text" width="60%" />
                          <Skeleton variant="text" width="40%" />
                        </Stack>
                      ) : (
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={2}
                          sx={{ width: '100%' }}
                        >
                          {/* Word and Translation */}
                          <Box sx={{ flexGrow: 1 }}>
                            <Typography
                              variant="body1"
                              sx={{
                                fontWeight: 500,
                                color: 'text.primary'
                              }}
                            >
                              {wordFreq.word}
                              <Typography
                                component="span"
                                variant="body1"
                                sx={{
                                  mx: 2,
                                  color: 'text.disabled',
                                  fontWeight: 300
                                }}
                              >
                                —
                              </Typography>
                              <Typography
                                component="span"
                                variant="body1"
                                sx={{
                                  color: activeGroup.color,
                                  fontWeight: 500
                                }}
                              >
                                {translatedWord?.translation || wordFreq.word}
                              </Typography>
                            </Typography>

                            {/* Metadata */}
                            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                              {wordFreq.confidence && (
                                <Chip
                                  label={`${Math.round(wordFreq.confidence * 100)}% confidence`}
                                  size="small"
                                  sx={{
                                    height: 20,
                                    fontSize: '0.7rem',
                                    bgcolor: 'action.hover'
                                  }}
                                />
                              )}
                              {translatedWord?.cached && (
                                <Chip
                                  label="cached"
                                  size="small"
                                  sx={{
                                    height: 20,
                                    fontSize: '0.7rem',
                                    bgcolor: 'action.hover'
                                  }}
                                />
                              )}
                              {translatedWord?.provider && (
                                <Chip
                                  label={translatedWord.provider}
                                  size="small"
                                  sx={{
                                    height: 20,
                                    fontSize: '0.7rem',
                                    bgcolor: translatedWord.provider === 'google' ? '#4285f420' : '#0A84FF20',
                                    color: translatedWord.provider === 'google' ? '#4285f4' : '#0A84FF'
                                  }}
                                />
                              )}
                            </Stack>
                          </Box>

                          {/* Action Buttons (Placeholder for future features) */}
                          <Stack direction="row" spacing={0.5}>
                            <IconButton
                              size="small"
                              sx={{
                                color: 'action.disabled',
                                '&:hover': {
                                  color: activeGroup.color
                                }
                              }}
                              title="Save for later (coming soon)"
                            >
                              <BookmarkBorderIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </Stack>
                      )}
                    </ListItem>
                    {index < currentPageWords.length - 1 && <Divider />}
                  </Box>
                );
              })
            )}
          </List>
        </Paper>

        {/* Pagination */}
        {activeGroup.totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
            <Pagination
              count={activeGroup.totalPages}
              page={activeGroup.currentPage}
              onChange={handlePageChange}
              color="primary"
              size="large"
              showFirstButton
              showLastButton
            />
          </Box>
        )}

        {/* Stats Footer */}
        <Box sx={{ mt: 3, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            Showing {currentPageWords.length} of {activeGroup.words.length} words •
            Page {activeGroup.currentPage} of {activeGroup.totalPages} •
            Translations loaded on demand
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}
