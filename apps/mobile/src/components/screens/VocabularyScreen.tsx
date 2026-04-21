import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme/palette';
import { wordwiseApi } from '../../services/api';
import { settingsStyles } from './settingsStyles';

interface Props {
  onBack: () => void;
  onNavigateToLearnedWords: () => void;
}

// Vocabulary hub — dedicated page under the user icon. Lists the user's
// vocabulary-related sub-sections (currently just Learned Words; room
// for future things like custom word lists, etc.).
export const VocabularyScreen = ({ onBack, onNavigateToLearnedWords }: Props) => {
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
          <Text style={settingsStyles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={settingsStyles.headerTitle}>Vocabulary</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={settingsStyles.scrollContent} contentContainerStyle={{ paddingTop: 12 }}>
        <TouchableOpacity style={settingsStyles.settingsLink} onPress={onNavigateToLearnedWords}>
          <View style={{ flex: 1 }}>
            <Text style={settingsStyles.settingsLinkText}>Learned Words</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              {learnedCount === null
                ? 'Words you already know'
                : `${learnedCount} word${learnedCount === 1 ? '' : 's'} hidden from movie lists`}
            </Text>
          </View>
          <Text style={settingsStyles.settingsLinkArrow}>→</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};
