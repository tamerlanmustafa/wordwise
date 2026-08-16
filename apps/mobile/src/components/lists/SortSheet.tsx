/**
 * SortSheet — the options behind the square button beside a list's gold
 * action. Which options appear depends on the list's kind: `due` is
 * meaningless for films (the server 422s it), and `rating` is meaningless
 * for words.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { BottomSheet } from '../common/BottomSheet';
import { detailTitle, listName } from './listStyles';
import type { ListKind, ListSort } from '../../core/types';

const FILM_SORTS: ListSort[] = ['added', 'title', 'rating'];
const WORD_SORTS: ListSort[] = ['due', 'added', 'alpha'];

export function sortsFor(kind: ListKind): ListSort[] {
  return kind === 'films' ? FILM_SORTS : WORD_SORTS;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  bottomOffset: number;
  kind: ListKind;
  value: ListSort;
  onChange: (sort: ListSort) => void;
}

export function SortSheet({ visible, onClose, bottomOffset, kind, value, onChange }: Props) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const labels: Record<ListSort, string> = {
    added: t('sort.added'),
    title: t('sort.titleAZ'),
    rating: t('sort.rating'),
    due: t('sort.due'),
    alpha: t('sort.alpha'),
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} bottomOffset={bottomOffset}>
      <Text style={s.title}>{t('sort.title')}</Text>
      <View style={s.options}>
        {sortsFor(kind).map((sort) => {
          const selected = sort === value;
          return (
            <TouchableOpacity
              key={sort}
              style={s.option}
              onPress={() => {
                onChange(sort);
                onClose();
              }}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={[s.optionLabel, { color: selected ? tc.goldOnSurface : tc.text }]}>
                {labels[sort]}
              </Text>
              {selected ? <Text style={s.check}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  title: { ...detailTitle, fontSize: 21, color: tc.text },
  options: { marginTop: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tc.divider,
  },
  optionLabel: { ...listName, fontWeight: '400' },
  check: { color: tc.goldOnSurface, fontSize: 16, fontWeight: '700' },
});
