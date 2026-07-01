import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { wordwiseApi } from '../../services/api';
import { makeSettingsStyles } from './settingsStyles';

interface Props {
  onBack: () => void;
}

// Shows every word the user has globally marked "never show again".
// Tap a row to unlearn it (word reappears in movie lists on next load).
export const LearnedWordsScreen = ({ onBack }: Props) => {
  const tc = useThemeColors();
  const settingsStyles = useMemo(() => makeSettingsStyles(tc), [tc]);
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const [words, setWords] = useState<Array<{ id: number; word: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const data = await wordwiseApi.getLearnedWords();
      setWords(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load learned words');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUnlearn = async (word: string) => {
    // Optimistic remove.
    const snapshot = words;
    setWords((prev) => prev.filter((w) => w.word !== word));
    try {
      await wordwiseApi.unlearnWord(word);
    } catch {
      setWords(snapshot);
      Alert.alert('Error', 'Could not restore that word. Try again.');
    }
  };

  return (
    <SafeAreaView style={settingsStyles.container} edges={['top']}>
      <View style={settingsStyles.header}>
        <TouchableOpacity onPress={onBack} style={settingsStyles.backButton}>
          <Text style={settingsStyles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={settingsStyles.headerTitle}>Learned Words</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={tc.primaryOnSurface} />
        </View>
      ) : error ? (
        <View style={{ padding: 20 }}>
          <Text style={{ color: tc.textSecondary }}>{error}</Text>
        </View>
      ) : words.length === 0 ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={{ color: tc.textSecondary, fontSize: 14, textAlign: 'center' }}>
            No learned words yet. Swipe left on a word in any movie to mark it as known.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
          <Text style={{ color: tc.textSecondary, fontSize: 12, paddingHorizontal: 20, paddingBottom: 6 }}>
            {words.length} word{words.length === 1 ? '' : 's'} hidden from movie lists. Tap to restore.
          </Text>
          {words.map((w) => (
            <TouchableOpacity
              key={w.id}
              style={styles.row}
              onPress={() =>
                Alert.alert(
                  'Restore word?',
                  `"${w.word}" will reappear in movie vocabulary lists.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Restore', onPress: () => handleUnlearn(w.word) },
                  ],
                )
              }
            >
              <Text style={styles.rowWord}>{w.word}</Text>
              <Text style={styles.rowAction}>Restore</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tc.divider,
  },
  rowWord: {
    fontSize: 16,
    color: tc.text,
    fontWeight: '500',
  },
  rowAction: {
    fontSize: 13,
    color: tc.primaryOnSurface,
    fontWeight: '600',
  },
});
