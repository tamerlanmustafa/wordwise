/**
 * NewListSheet — pick a kind, name it, create it.
 *
 * The kind tiles come first and the subtitle states the constraint outright
 * ("A list holds films or words, not both"), because kind is immutable once
 * the list exists — the server rejects a word added to a films list. Better
 * to make the choice legible up front than to explain a 409 afterwards.
 *
 * A duplicate name lands on the field, not in a toast: the user is still
 * looking at the input and can fix it in place.
 *
 * ## Also the rename sheet
 *
 * `mode="rename"` reuses the same field, error handling and keyboard lift for
 * renaming an existing list, minus the kind tiles — kind is fixed once a list
 * exists. Renaming was built in the store and the API, and translated in all
 * six locales (`rename.title`, `rename.submit`), but no screen ever offered
 * it: a typo in a list's name was permanent unless you deleted the list and
 * rebuilt it by hand. A second sheet would have been a second copy of every
 * rule this one already gets right.
 */

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { BottomSheet } from '../common/BottomSheet';
import { detailTitle, listName, metaText } from './listStyles';
import { newListErrorKey } from './newListError';
import type { ListKind } from '../../core/types';
import { withTap } from '../../utils/feedback';

type Props = {
  visible: boolean;
  onClose: () => void;
  bottomOffset: number;
} & (
  | {
      mode?: 'create';
      /** Rejects with a ListApiError so `duplicate_name` can land on the field. */
      onCreate: (name: string, kind: ListKind) => Promise<void>;
      /** Which kind to preselect — the segment the user is currently looking at. */
      initialKind?: ListKind;
    }
  | {
      mode: 'rename';
      /** The list's current name, pre-filled so a typo is one edit away. */
      initialName: string;
      /** Rejects with a ListApiError so `duplicate_name` can land on the field. */
      onRename: (name: string) => Promise<void>;
    }
);

export function NewListSheet(props: Props) {
  const { visible, onClose, bottomOffset } = props;
  const isRename = props.mode === 'rename';
  const initialKind = props.mode === 'rename' ? 'words' : props.initialKind ?? 'films';
  const initialName = props.mode === 'rename' ? props.initialName : '';

  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const [kind, setKind] = useState<ListKind>(initialKind);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reopening should be a clean slate, not the last attempt's error.
  useEffect(() => {
    if (visible) {
      setKind(initialKind);
      setName(initialName);
      setError(null);
      setBusy(false);
    }
  }, [visible, initialKind, initialName]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('new.errorEmpty'));
      return;
    }
    // Saving the name it already has is not an edit — close without a request
    // rather than round-trip to be told nothing changed.
    if (isRename && trimmed === initialName) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (props.mode === 'rename') await props.onRename(trimmed);
      else await props.onCreate(trimmed, kind);
      onClose();
    } catch (e) {
      // A known refusal gets our words. Anything else: a rename says so in the
      // user's language; create keeps its original fallback to the layer below.
      const key = newListErrorKey((e as { code?: string })?.code);
      setError(key ? t(key) : isRename ? t('error.renameFailed') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} bottomOffset={bottomOffset}>
      <Text style={s.title}>{isRename ? t('rename.title') : t('new.title')}</Text>
      {isRename ? null : <Text style={s.subtitle}>{t('new.subtitle')}</Text>}

      {isRename ? null : (
      <View style={s.tiles}>
        {/* Words first. A word list is the one people make — words are what
            you collect while reading, and a films list is the occasional
            deliberate act — so the common choice should be the one your thumb
            lands on first. */}
        {(['words', 'films'] as const).map((k) => {
          const selected = kind === k;
          return (
            <TouchableOpacity
              key={k}
              style={[s.tile, selected && s.tileSelected]}
              onPress={withTap(() => setKind(k))}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={[s.tileLabel, { color: selected ? tc.goldOnSurface : tc.text }]}>
                {k === 'films' ? t('new.kindFilms') : t('new.kindWords')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      )}

      <TextInput
        style={[s.input, error ? { borderColor: tc.error } : null]}
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (error) setError(null);
        }}
        placeholder={kind === 'films' ? t('new.placeholderFilms') : t('new.placeholderWords')}
        placeholderTextColor={tc.textFaint}
        maxLength={60}
        returnKeyType="done"
        onSubmitEditing={submit}
        autoCorrect={false}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[s.submit, busy && { opacity: 0.6 }]}
        onPress={withTap(submit)}
        disabled={busy}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <Text style={s.submitLabel}>{isRename ? t('rename.submit') : t('new.submit')}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  title: { ...detailTitle, fontSize: 24, color: tc.text },
  subtitle: { ...metaText, color: tc.textSecondary, marginTop: 6, letterSpacing: 0 },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 18 },
  tile: {
    flex: 1,
    height: 74,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tc.border,
    backgroundColor: tc.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileSelected: {
    backgroundColor: tc.goldWash,
    borderColor: tc.goldLine,
  },
  tileLabel: { ...listName },
  input: {
    height: 48,
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tc.border,
    backgroundColor: tc.background,
    paddingHorizontal: 14,
    color: tc.text,
    fontSize: 15,
  },
  error: { ...metaText, color: tc.error, marginTop: 8, letterSpacing: 0 },
  submit: {
    height: 48,
    marginTop: 16,
    borderRadius: 13,
    backgroundColor: tc.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Never white-on-gold: it fails contrast in both modes.
  submitLabel: { ...listName, color: tc.goldDeep },
});
