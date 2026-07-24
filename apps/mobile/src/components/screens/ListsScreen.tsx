import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { wordwiseApi, watchedApi } from '../../services/api';
import { styles } from '../../core/styles';
import { useThemeColors } from '../../theme/tokens';
import type { ListFilter } from '../../core/types';
import { BACK_ARROW } from '../../i18n/rtl';

interface Props {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
  onOpenList: (filter: ListFilter) => void;
  onOpenWatched: () => void;
}

export const ListsScreen = ({ onBack, backLabel, onOpenList, onOpenWatched }: Props) => {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [learnedCount, setLearnedCount] = useState<number | null>(null);
  const [watchedCount, setWatchedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const words = await wordwiseApi.getSavedWords();
        setSavedCount(words.length);
        setLearnedCount(words.filter((w) => w.is_learned).length);
      } catch {
        setSavedCount(0);
        setLearnedCount(0);
      } finally {
        setLoading(false);
      }
    })();
    watchedApi.list().then((m) => setWatchedCount(m.length)).catch(() => setWatchedCount(0));
  }, []);

  const lists: Array<{
    key: ListFilter;
    icon: keyof typeof Ionicons.glyphMap;
    name: string;
    description: string;
    count: number | null;
    color: string;
  }> = [
    {
      key: 'saved',
      icon: 'bookmark-outline',
      name: t('vocabulary:savedWords'),
      description: 'All words you have saved from movies',
      count: savedCount,
      color: '#F4A261',
    },
    {
      key: 'learned',
      icon: 'checkmark-circle-outline',
      name: t('vocabulary:learnedWords'),
      description: 'Words you have marked as learned',
      count: learnedCount,
      color: '#4CAF9A',
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tc.background }]} edges={['top']}>
      <View style={[styles.detailHeader, { backgroundColor: tc.paper, borderBottomColor: tc.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={[styles.backButtonText, { color: tc.primary }]}>{BACK_ARROW} {backLabel ?? t('action.back')}</Text>
        </TouchableOpacity>
        <Text style={[styles.detailHeaderTitle, { color: tc.text }]} numberOfLines={1}>{t('vocabulary:lists.title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {lists.map((list) => (
          <TouchableOpacity
            key={list.key}
            style={[styles.listsCard, { backgroundColor: tc.paper, borderColor: tc.border }]}
            onPress={() => onOpenList(list.key)}
            activeOpacity={0.75}
          >
            <View style={[styles.listsCardIcon, { backgroundColor: list.color + '22' }]}>
              <Ionicons name={list.icon} size={22} color={list.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.listsCardName, { color: tc.text }]}>{list.name}</Text>
              <Text style={[styles.listsCardDesc, { color: tc.textSecondary }]}>{list.description}</Text>
            </View>
            <View style={[styles.listsCardBadge, { backgroundColor: list.color }]}>
              <Text style={styles.listsCardBadgeText}>
                {loading ? '…' : list.count ?? 0}
              </Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* Watched Films — a movie list (not a word list), so it navigates on
            its own path rather than through onOpenList(ListFilter). */}
        <TouchableOpacity
          style={[styles.listsCard, { backgroundColor: tc.paper, borderColor: tc.border }]}
          onPress={onOpenWatched}
          activeOpacity={0.75}
        >
          <View style={[styles.listsCardIcon, { backgroundColor: '#6C8EBF22' }]}>
            <Ionicons name="film-outline" size={22} color="#6C8EBF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.listsCardName, { color: tc.text }]}>{t('vocabulary:lists.watchedFilms')}</Text>
            <Text style={[styles.listsCardDesc, { color: tc.textSecondary }]}>
              {t('vocabulary:lists.watchedFilmsSub')}
            </Text>
          </View>
          <View style={[styles.listsCardBadge, { backgroundColor: '#6C8EBF' }]}>
            <Text style={styles.listsCardBadgeText}>
              {watchedCount === null ? '…' : watchedCount}
            </Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};
