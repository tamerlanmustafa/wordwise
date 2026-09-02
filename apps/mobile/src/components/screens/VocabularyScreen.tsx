import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors } from '../../theme/tokens';
import { wordwiseApi } from '../../services/api';
import { makeSettingsStyles } from './settingsStyles';
import { BACK_ARROW, FORWARD_ARROW } from '../../i18n/rtl';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';

interface Props {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
  onNavigateToLearnedWords: () => void;
}

// Vocabulary hub — dedicated page under the user icon. Lists the user's
// vocabulary-related sub-sections (currently just Learned Words; room
// for future things like custom word lists, etc.).
export const VocabularyScreen = ({ onBack, backLabel, onNavigateToLearnedWords }: Props) => {
  // The tab bar is an absolute overlay, so every scroller reserves its height
  // itself or its last rows sit behind the floating capsule.
  const barInset = useBottomBarInset();
  const { t } = useTranslation();
  const tc = useThemeColors();
  const settingsStyles = useMemo(() => makeSettingsStyles(tc), [tc]);
  const [learnedCount, setLearnedCount] = useState<number | null>(null);

  useEffect(() => {
    wordwiseApi.getLearnedWords()
      .then((w) => setLearnedCount(w.length))
      .catch(() => setLearnedCount(null));
  }, []);

  return (
    <SafeAreaView style={settingsStyles.container} edges={['top']}>
      <View style={settingsStyles.header}>
        <TouchableOpacity onPress={onBack} style={settingsStyles.backButton}>
          <Text style={settingsStyles.backButtonText}>{BACK_ARROW} {backLabel ?? t('action.back')}</Text>
        </TouchableOpacity>
        <Text style={settingsStyles.headerTitle}>{t('vocabulary:screenTitle')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={settingsStyles.scrollContent}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: barInset + 24 }}
      >
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToLearnedWords}>
          <View style={{ flex: 1 }}>
            <Text style={settingsStyles.settingsLinkText}>{t('vocabulary:learnedWords')}</Text>
            <Text style={{ color: tc.textSecondary, fontSize: 12, marginTop: 2 }}>
              {learnedCount === null
                ? t('vocabulary:wordsYouKnow')
                : t('vocabulary:learned.hiddenSummary', { count: learnedCount })}
            </Text>
          </View>
          <Text style={settingsStyles.settingsLinkArrow}>{FORWARD_ARROW}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};
