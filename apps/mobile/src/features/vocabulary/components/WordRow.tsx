import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { Word } from '../../../types';
import { colors, typography, spacing, cefrColors } from '../../../theme';

interface WordRowProps {
  word: Word;
  onPress?: (word: Word) => void;
}

// Fixed height for FlashList optimization
export const WORD_ROW_HEIGHT = 72;

export const WordRow = memo(({ word, onPress }: WordRowProps) => {
  const levelColor = cefrColors[word.cefr_level] || colors.light.textSecondary;

  const content = (
    <View style={styles.container}>
      <View style={styles.leftSection}>
        <Text style={styles.word}>{word.word}</Text>
        {word.part_of_speech && (
          <Text style={styles.partOfSpeech}>{word.part_of_speech}</Text>
        )}
      </View>

      <View style={[styles.levelBadge, { backgroundColor: levelColor }]}>
        <Text style={styles.levelText}>{word.cefr_level}</Text>
      </View>

      <View style={styles.rightSection}>
        <Text style={styles.translation} numberOfLines={2}>
          {word.translation || '—'}
        </Text>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={() => onPress(word)} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
});

WordRow.displayName = 'WordRow';

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: WORD_ROW_HEIGHT,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.light.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.light.border,
  },
  leftSection: {
    flex: 2,
    justifyContent: 'center',
  },
  word: {
    ...typography.body,
    fontWeight: '500',
    color: colors.light.text,
  },
  partOfSpeech: {
    ...typography.caption,
    color: colors.light.textTertiary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginHorizontal: spacing.sm,
  },
  levelText: {
    ...typography.caption,
    fontWeight: '600',
    color: '#fff',
  },
  rightSection: {
    flex: 2,
    alignItems: 'flex-end',
  },
  translation: {
    ...typography.bodySmall,
    color: colors.light.textSecondary,
    textAlign: 'right',
  },
});
