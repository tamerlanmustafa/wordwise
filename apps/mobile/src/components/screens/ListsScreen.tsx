import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { wordwiseApi } from '../../services/api';
import { styles } from '../../core/styles';
import { useThemeColors } from '../../theme/tokens';
import type { ListFilter } from '../../core/types';

interface Props {
  onBack: () => void;
  onOpenList: (filter: ListFilter) => void;
}

export const ListsScreen = ({ onBack, onOpenList }: Props) => {
  const tc = useThemeColors();
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [learnedCount, setLearnedCount] = useState<number | null>(null);
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
  }, []);

  const lists: Array<{
    key: ListFilter;
    icon: string;
    name: string;
    description: string;
    count: number | null;
    color: string;
  }> = [
    {
      key: 'saved',
      icon: '🔖',
      name: 'Saved Words',
      description: 'All words you have saved from movies',
      count: savedCount,
      color: '#F4A261',
    },
    {
      key: 'learned',
      icon: '✅',
      name: 'Learned Words',
      description: 'Words you have marked as learned',
      count: learnedCount,
      color: '#4CAF9A',
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tc.background }]} edges={['top']}>
      <View style={[styles.detailHeader, { backgroundColor: tc.paper, borderBottomColor: tc.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={[styles.backButtonText, { color: tc.primary }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.detailHeaderTitle, { color: tc.text }]} numberOfLines={1}>My Lists</Text>
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
              <Text style={{ fontSize: 22 }}>{list.icon}</Text>
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
      </ScrollView>
    </SafeAreaView>
  );
};
