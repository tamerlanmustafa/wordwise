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
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { wordwiseApi } from '../../services/api';
import { makeSettingsStyles } from './settingsStyles';
import { BACK_ARROW } from '../../i18n/rtl';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';

interface Props {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
}

// Shows every word the user has globally marked "never show again".
// Tap a row to unlearn it (word reappears in movie lists on next load).
export const LearnedWordsScreen = ({ onBack, backLabel }: Props) => {
  // The tab bar is an absolute overlay, so every scroller reserves its height
  // itself or its last rows sit behind the floating capsule.
  const barInset = useBottomBarInset();
  const { t } = useTranslation();
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
      Alert.alert(t('vocabulary:learned.restoreErrorTitle'), t('vocabulary:learned.restoreErrorBody'));
    }
  };

  return (
    <SafeAreaView style={settingsStyles.container} edges={['top']}>
      <View style={settingsStyles.header}>
        <TouchableOpacity onPress={onBack} style={settingsStyles.backButton}>
          <Text style={settingsStyles.backButtonText}>{BACK_ARROW} {backLabel ?? t('action.back')}</Text>
        </TouchableOpacity>
        <Text style={settingsStyles.headerTitle}>{t('vocabulary:learnedWords')}</Text>
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
            {t('vocabulary:learned.empty')}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: barInset + 24 }}>
          <Text style={{ color: tc.textSecondary, fontSize: 12, paddingHorizontal: 20, paddingBottom: 6 }}>
            {t('vocabulary:learned.hiddenCount', { count: words.length })}
          </Text>
          {words.map((w) => (
            <TouchableOpacity
              key={w.id}
              style={styles.row}
              onPress={() =>
                Alert.alert(
                  t('vocabulary:learned.restoreTitle'),
                  t('vocabulary:learned.restoreBody', { word: w.word }),
                  [
                    { text: t('action.cancel'), style: 'cancel' },
                    { text: t('vocabulary:learned.restore'), onPress: () => handleUnlearn(w.word) },
                  ],
                )
              }
            >
              <Text style={styles.rowWord}>{w.word}</Text>
              <Text style={styles.rowAction}>{t('vocabulary:learned.restore')}</Text>
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
