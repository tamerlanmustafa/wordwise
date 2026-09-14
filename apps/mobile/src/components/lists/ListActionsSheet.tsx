/**
 * ListActionsSheet — what is behind a list's "⋯".
 *
 * "⋯" means "more options" on every platform, and on this screen it used to
 * mean exactly one thing: tapping it went straight to "Delete this list?".
 * The only destructive action in the Lists tab sat behind the glyph people tap
 * to *look* for options, and the one non-destructive option a list owner
 * needs — renaming it — was not offered anywhere at all, though the store,
 * the API and the copy for it all existed.
 *
 * So the glyph now opens options, as it promises. Rename first; Delete last
 * and in the error colour, so the destructive row is the one you have to
 * reach for rather than the one under your thumb. Delete still asks for
 * confirmation after this — the sheet is where you find it, the dialog is
 * where you commit.
 *
 * Built on `BottomSheet` with the same row shape as `SortSheet`, so the two
 * sheets a list opens look like one family.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { BottomSheet } from '../common/BottomSheet';
import { detailTitle, listName } from './listStyles';
import { withTap } from '../../utils/feedback';

interface Props {
  visible: boolean;
  onClose: () => void;
  bottomOffset: number;
  /** The list's display name, as the sheet's title. */
  title: string;
  onRename: () => void;
  onDelete: () => void;
}

export function ListActionsSheet({
  visible,
  onClose,
  bottomOffset,
  title,
  onRename,
  onDelete,
}: Props) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Close first, then act: both actions open something of their own (a sheet,
  // a dialog), and two overlays animating at once reads as the screen
  // stuttering.
  const choose = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} bottomOffset={bottomOffset}>
      <Text style={s.title} numberOfLines={1}>{title}</Text>
      <View style={s.options}>
        <TouchableOpacity
          style={s.option}
          onPress={withTap(choose(onRename))}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Text style={[s.optionLabel, { color: tc.text }]}>{t('menu.rename')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.option, s.optionLast]}
          onPress={withTap(choose(onDelete))}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Text style={[s.optionLabel, { color: tc.error }]}>{t('menu.delete')}</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  title: { ...detailTitle, fontSize: 21, color: tc.text },
  options: { marginTop: 10 },
  option: {
    minHeight: 48,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tc.divider,
  },
  optionLast: { borderBottomWidth: 0 },
  optionLabel: { ...listName, fontWeight: '400' },
});
