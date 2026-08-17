/**
 * ListPanel — the left-edge slide-in that files the current word into lists.
 *
 * Geometry matches MixPanel and the action rail exactly (same height, same
 * bottom edge, same end inset), because they share one lane and only one is
 * ever open.
 *
 * Multi-select on purpose: a word belongs in as many lists as the user
 * wants, so tapping a row toggles that one membership and **leaves the panel
 * open**. There is no confirm — every tap is already committed optimistically.
 *
 * Only `words` lists appear. A film list can't hold a lemma, so showing them
 * would be offering an action that cannot work.
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { directionSign } from '../../i18n/rtl';
import type { ListSummary } from '../../core/types';

const SERIF_FAMILY = 'Source Serif 4';

interface Props {
  /** The word the panel is filing — its name is the panel's title. */
  word: string;
  lists: ListSummary[];
  /** List ids the current word is already in. */
  memberOf: number[];
  onToggle: (listId: number) => void;
  onCreate: (name: string) => Promise<void>;
  loading: boolean;
  progress: Animated.Value;
  visible: boolean;
  height: number;
  bottom: number;
  lane: number;
}

export function ListPanel({
  word,
  lists,
  memberOf,
  onToggle,
  onCreate,
  loading,
  progress,
  visible,
  height,
  bottom,
  lane,
}: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const name = draftName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
      setDraftName('');
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Animated.View
      style={[
        s.panel,
        {
          height,
          bottom,
          end: lane,
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-500 * directionSign, 0],
              }),
            },
          ],
        },
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityViewIsModal={visible}
    >
      {/* Curly quotes are deliberate — this is display copy, not code. */}
      <Text style={s.title} numberOfLines={1}>
        Save “{word}”
      </Text>
      <Text style={s.sub}>Pick as many lists as you like.</Text>

      <View style={s.rows}>
        {loading && lists.length === 0 ? (
          <ActivityIndicator color={tc.gold} style={s.spinner} />
        ) : lists.length === 0 ? (
          <Text style={s.empty}>No word lists yet — make one below.</Text>
        ) : (
          // Only the rows scroll; the panel itself never does, so the
          // create button below stays reachable however many lists exist.
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {lists.map((list, i) => (
              <ListRow
                key={list.id}
                list={list}
                selected={memberOf.includes(list.id)}
                onPress={() => onToggle(list.id)}
                showRule={i > 0}
                tc={tc}
                s={s}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {creating ? (
        <View style={s.createRow}>
          <TextInput
            style={s.input}
            value={draftName}
            onChangeText={setDraftName}
            placeholder="List name"
            placeholderTextColor={tc.textFaint}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            maxLength={40}
          />
          <TouchableOpacity
            style={[s.createBtn, s.createConfirm]}
            onPress={submit}
            disabled={busy || !draftName.trim()}
            accessibilityRole="button"
            accessibilityLabel="Create list"
          >
            <Text style={s.createConfirmText}>{busy ? '…' : 'Add'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={s.newList}
          onPress={() => setCreating(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="New list"
        >
          <Text style={s.newListText}>+ New list</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

function ListRow({
  list,
  selected,
  onPress,
  showRule,
  tc,
  s,
}: {
  list: ListSummary;
  selected: boolean;
  onPress: () => void;
  showRule: boolean;
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      style={[s.row, showRule ? s.rowRule : null]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={list.name}
    >
      <View style={[s.bookmark, selected ? s.bookmarkOn : s.bookmarkOff]}>
        <Svg width={13} height={13} viewBox="0 0 24 24" fill="none"
          stroke={selected ? tc.goldDeep : tc.textFaint}
          strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M6 3h12a1 1 0 0 1 1 1v17l-7-5-7 5V4a1 1 0 0 1 1-1z" />
        </Svg>
      </View>

      <View style={s.rowText}>
        <Text style={s.rowName} numberOfLines={1}>{list.name}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {list.count} {list.count === 1 ? 'word' : 'words'}
        </Text>
      </View>

      <View style={[s.check, selected ? s.checkOn : s.checkOff]}>
        {selected ? (
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none"
            stroke={tc.goldDeep} strokeWidth={3.2}
            strokeLinecap="round" strokeLinejoin="round">
            <Path d="M20 6L9 17l-5-5" />
          </Svg>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    panel: {
      position: 'absolute',
      start: 0,
      backgroundColor: tc.paper,
      borderTopEndRadius: 22,
      borderBottomEndRadius: 22,
      borderTopWidth: 1,
      borderEndWidth: 1,
      borderBottomWidth: 1,
      borderColor: tc.border,
      paddingTop: 14,
      paddingHorizontal: 18,
      paddingBottom: 16,
      overflow: 'hidden',
      shadowColor: tc.panelShadowColor,
      shadowOpacity: 1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 14 },
      elevation: 16,
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 18,
      fontWeight: '700',
      color: tc.text,
    },
    sub: {
      marginTop: 2,
      fontSize: 11.5,
      color: tc.textFaint,
    },
    rows: { flex: 1, marginTop: 6 },
    spinner: { marginTop: 20 },
    empty: {
      marginTop: 18,
      fontSize: 12,
      color: tc.textFaint,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 3,
      gap: 10,
    },
    rowRule: {
      borderTopWidth: 1,
      borderTopColor: tc.border,
    },
    bookmark: {
      width: 28,
      height: 28,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bookmarkOn: { backgroundColor: tc.gold },
    bookmarkOff: { backgroundColor: tc.chipBg },
    rowText: { flex: 1 },
    rowName: {
      fontSize: 13,
      fontWeight: '700',
      color: tc.text,
    },
    rowMeta: {
      fontSize: 10,
      color: tc.textFaint,
    },
    check: {
      width: 21,
      height: 21,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    checkOn: { backgroundColor: tc.gold, borderColor: tc.gold },
    checkOff: { backgroundColor: 'transparent', borderColor: tc.border },
    newList: {
      height: 34,
      borderRadius: 10,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: tc.goldLine,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newListText: {
      fontSize: 12.5,
      fontWeight: '800',
      color: tc.goldOnSurface,
    },
    createRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    input: {
      flex: 1,
      height: 34,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: tc.border,
      paddingHorizontal: 10,
      fontSize: 13,
      color: tc.text,
      backgroundColor: tc.chipBg,
    },
    createBtn: {
      height: 34,
      borderRadius: 10,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createConfirm: { backgroundColor: tc.gold },
    createConfirmText: {
      fontSize: 12.5,
      fontWeight: '800',
      color: tc.goldDeep,
    },
  });
