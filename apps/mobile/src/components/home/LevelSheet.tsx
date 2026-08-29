/**
 * LevelSheet — the CEFR picker behind the gold level chip in the Home header.
 *
 * Deliberately its own sheet rather than a third section of FeedFilterSheet:
 * the level is what the feed *is* (every card is a film graded for it) and it
 * defaults to the user's `proficiency_level` rather than to a constant, so it
 * has no "off" position and doesn't belong in a group you can Reset.
 *
 * Picking a level closes the sheet — one group, one choice, same as the
 * dropdown it replaces.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { cefrColors } from '../../theme/palette';
import { BottomSheet } from '../common/BottomSheet';
import { SheetOptionRow } from './SheetOptionRow';
import { LEVEL_OPTIONS } from './filterOptions';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Height of GlobalBottomBar — sheet and scrim stop above it. */
  bottomOffset?: number;
  level: string;
  onLevelChange: (level: string) => void;
}

export function LevelSheet({
  visible,
  onClose,
  bottomOffset,
  level,
  onLevelChange,
}: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <BottomSheet visible={visible} onClose={onClose} bottomOffset={bottomOffset}>
      <View style={s.head}>
        <Text style={s.title}>{t('home:level.title')}</Text>
        <Text style={s.subtitle}>{t('home:level.subtitle')}</Text>
      </View>

      {LEVEL_OPTIONS.map((opt, i) => (
        <SheetOptionRow
          key={opt.value}
          label={opt.label}
          active={opt.value === level}
          swatch={cefrColors[opt.value] ?? tc.gold}
          divider={i < LEVEL_OPTIONS.length - 1}
          onPress={() => {
            onClose();
            if (opt.value !== level) onLevelChange(opt.value);
          }}
        />
      ))}
    </BottomSheet>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    head: {
      paddingHorizontal: 12,
      paddingBottom: 6,
    },
    title: {
      fontSize: 17,
      fontWeight: '800',
      color: tc.text,
      letterSpacing: -0.2,
    },
    subtitle: {
      fontSize: 12.5,
      color: tc.textSecondary,
      marginTop: 3,
    },
  });
