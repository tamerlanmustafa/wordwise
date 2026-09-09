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
 *
 * ## The panel rides the keyboard; nothing else does
 *
 * Naming a new list puts a text field at the panel's bottom edge, which is
 * exactly where the keyboard arrives — so the field you were typing into was
 * the first thing hidden. The panel is absolutely positioned, so it lifts by
 * adding the keyboard's height to its own `bottom`, and the word card behind
 * it does not move at all. That is deliberate: the reader is filing *this*
 * word, and sliding the word off screen to make room for the panel filing it
 * would be a strange trade. It is also why this is not a
 * `KeyboardAvoidingView` — that moves a container, and the container here is
 * the whole card.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors, withAlpha, type ThemeColors } from '../../theme/tokens';
import { KEYBOARD_EASING, liftDuration, useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { directionSign } from '../../i18n/rtl';
import type { ListSummary } from '../../core/types';
import { Skeleton } from '../ui/Skeleton';

const SERIF_FAMILY = 'Source Serif 4';

/** Breathing room between the panel's bottom edge and the keyboard's top.
 *  Small enough to read as "resting on it" rather than floating above. */
const KEYBOARD_GAP = 6;

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

  /**
   * The panel rides up to sit on the keyboard.
   *
   * Two things this gets right that the obvious version does not.
   *
   * **The offset is absolute, not additive.** The panel rests at `bottom`,
   * which is the action rail's own inset from the screen edge. Adding the
   * keyboard height to that parked it a whole rail-height *above* the keys —
   * the "too much gap" this replaces. What we want is the panel's bottom edge
   * at `keyboard + KEYBOARD_GAP` from the screen edge whatever it rests at,
   * so the travel is the difference, floored at zero so it can never move
   * down for a short keyboard.
   *
   * **It is animated, not assigned, and it leads.** State lands in one frame
   * while the keyboard spends its own ~250ms sliding; setting the offset
   * directly made the panel teleport and then wait. Animating fixes that, but
   * animating on the keyboard's *exact* duration made the panel feel like it
   * was being dragged along by the keys — so `liftDuration` runs it at a
   * fraction of their time on the way up, and at their full time on the way
   * down, where getting there first would only mean sitting behind a keyboard
   * that has not finished leaving.
   *
   * Deliberately not gated on `creating`. That reads like the obvious guard
   * and is wrong: submitting sets it false the instant the request resolves,
   * while the keyboard is still retracting — so the panel dropped *through* a
   * keyboard still on screen.
   */
  const { height: keyboard, duration } = useKeyboardHeight();
  const lift = useRef(new Animated.Value(0)).current;
  const target = keyboard > 0 ? Math.max(0, keyboard + KEYBOARD_GAP - bottom) : 0;
  const travel = liftDuration(duration, keyboard > 0);

  useEffect(() => {
    Animated.timing(lift, {
      toValue: target,
      duration: travel,
      easing: KEYBOARD_EASING,
      useNativeDriver: true,
    }).start();
  }, [target, travel, lift]);

  /**
   * Whether the rows overflow their box — i.e. there is more list below.
   *
   * Measured rather than counted, because "too many" is not a number: it
   * depends on the panel's height, which the caller sets, and on the row
   * height, which the theme's font scaling can change. Comparing the two
   * onLayout answers the actual question.
   */
  const [rowsBoxH, setRowsBoxH] = useState(0);
  const [rowsContentH, setRowsContentH] = useState(0);
  const scrollable = rowsContentH > rowsBoxH + 1;

  /**
   * Closing the panel puts the keyboard away and throws the draft out.
   *
   * The panel is never unmounted — it hides by animating `opacity` and
   * `translateX` — so without this both survive the close. Two things went
   * wrong, and neither is visible from the opening path:
   *
   *   • the keyboard outlived the panel. Dismissing the panel while naming a
   *     list left the keys up over the word feed with nothing focused behind
   *     them, and no obvious way to get rid of them.
   *   • the draft outlived the word. Reopening the panel — on the *next*
   *     word, after swiping on — put the reader back in a half-typed create
   *     row belonging to a word they had left behind.
   *
   * Keyed on the panel closing rather than on the create row itself, because
   * "the user is done with this" is the panel's state, not the row's.
   */
  useEffect(() => {
    if (visible) return;
    Keyboard.dismiss();
    setCreating(false);
    setDraftName('');
    setBusy(false);
  }, [visible]);

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
            // Negative because `bottom`-anchored means up is -Y. A transform
            // rather than the `bottom` prop so it can run on the native
            // driver alongside the slide-in above it.
            { translateY: Animated.multiply(lift, -1) },
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

      <View style={s.rows} onLayout={(e) => setRowsBoxH(e.nativeEvent.layout.height)}>
        {loading && lists.length === 0 ? (
          /* Rows the shape of the list rows about to replace them, so the
             panel does not resize under the user's thumb mid-save. */
          <View>
            {Array.from({ length: 3 }).map((_, i) => (
              <View key={i} style={s.row}>
                <Skeleton width={22} height={22} radius={6} delay={i * 70} />
                <Skeleton width="55%" height={13} radius={4} delay={i * 70 + 40} />
              </View>
            ))}
          </View>
        ) : lists.length === 0 ? (
          <Text style={s.empty}>No word lists yet — make one below.</Text>
        ) : (
          // Only the rows scroll; the panel itself never does, so the
          // create button below stays reachable however many lists exist.
          <ScrollView
            // On, now that there can be enough lists to need it. It is a
            // hint while the thumb is down and nothing at rest, which is
            // why the fade below exists as well rather than instead.
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={(_w, h) => setRowsContentH(h)}
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

        {/* The standing sign that the list continues.
            A scrollbar only appears once you are already scrolling, which is
            no use to a reader deciding whether to: the last row simply looked
            like the last row. A row fading out under the panel's edge says
            "there is more" without spending a line of the panel on saying it,
            and it is drawn only when the rows actually overflow — a permanent
            fade would imply more list on a panel showing all three of them. */}
        {scrollable ? (
          <LinearGradient
            colors={[withAlpha(tc.paper, 0), tc.paper]}
            style={s.moreFade}
            pointerEvents="none"
          />
        ) : null}
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
    // Sits inside the rows box, over its bottom edge. 28 is a little over one
    // row, so the row beneath is half-visible rather than cleanly cut — a cut
    // reads as the end of the list, a fade reads as more of it.
    moreFade: {
      position: 'absolute',
      start: 0,
      end: 0,
      bottom: 0,
      height: 28,
    },
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
