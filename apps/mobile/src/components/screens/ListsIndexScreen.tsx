/**
 * ListsIndexScreen — the Lists tab's root.
 *
 * Everything the user has kept, split by the one axis that matters: films or
 * words. The two pinned lists are always present, so the tab is never empty
 * on day one — a fresh account sees `Saved from Home` and `Favourites` with
 * their empty-state instructions rather than a blank screen.
 *
 * States (§8) are real screens, not spinners: skeleton rows at the true row
 * height while loading, a retry line above kept content when a refresh
 * fails, and per-row instructions when a pinned list has nothing in it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { Skeleton } from '../ui/Skeleton';
import { SegmentedControl } from '../lists/SegmentedControl';
import { ListRow } from '../lists/ListRow';
import { NewListSheet } from '../lists/NewListSheet';
import { METRICS, listName, metaText, screenTitle } from '../lists/listStyles';
import { useListsStore, subscribeToReel } from '../../stores/listsStore';
import { track } from '../../services/analytics';
import type { ListKind, ListSummary } from '../../core/types';

interface Props {
  /** True while this tab is the visible one — the screen stays mounted
   *  (App's keep-alive) so scroll position and segment survive a switch. */
  active: boolean;
  onOpenList: (list: ListSummary) => void;
  /** Height of GlobalBottomBar, so nothing hides behind it. */
  bottomOffset: number;
}

export function ListsIndexScreen({ active, onOpenList, bottomOffset }: Props) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const lists = useListsStore((st) => st.lists);
  const status = useListsStore((st) => st.status);
  const loadError = useListsStore((st) => st.loadError);
  const activeKind = useListsStore((st) => st.activeKind);
  const setActiveKind = useListsStore((st) => st.setActiveKind);
  const hydrate = useListsStore((st) => st.hydrate);
  const fetchLists = useListsStore((st) => st.fetchLists);
  const syncFromReel = useListsStore((st) => st.syncFromReel);
  const create = useListsStore((st) => st.create);

  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => { void hydrate(); }, [hydrate]);

  // `Saved from Home` is reel-backed, so it can go stale while the user is
  // on Home. Re-read it on focus, and keep it live via the reel subscription
  // for adds that happen while the tab is already open.
  useEffect(() => {
    if (!active) return;
    track('lists_tab_opened');
    void syncFromReel();
    return subscribeToReel();
  }, [active, syncFromReel]);

  const films = useMemo(() => lists.filter((l) => l.kind === 'films'), [lists]);
  const words = useMemo(() => lists.filter((l) => l.kind === 'words'), [lists]);
  const shown = activeKind === 'films' ? films : words;

  const onSegmentChange = useCallback((kind: ListKind) => {
    setActiveKind(kind);
    track('lists_segment_changed', { kind });
  }, [setActiveKind]);

  const onCreate = useCallback(async (name: string, kind: ListKind) => {
    const created = await create(name, kind);
    track('list_created', { kind });
    // Land the user in the list they just made — it's empty, and the empty
    // state is what tells them how to fill it.
    onOpenList(created);
  }, [create, onOpenList]);

  const openList = useCallback((list: ListSummary) => {
    track('list_opened', { kind: list.kind, system_key: list.systemKey });
    onOpenList(list);
  }, [onOpenList]);

  const loading = status === 'loading' && lists.length === 0;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>{t('title')}</Text>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => setSheetOpen(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('new.title')}
        >
          <Text style={s.addGlyph}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={s.segmentWrap}>
        <SegmentedControl
          segments={[
            { key: 'words', label: t('segment.words'), count: words.length },
            { key: 'films', label: t('segment.films'), count: films.length },
          ]}
          value={activeKind}
          onChange={onSegmentChange}
        />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: bottomOffset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* A failed refresh never blanks kept content — the retry line sits
            above whatever is already on screen. */}
        {loadError ? (
          <TouchableOpacity style={s.retry} onPress={() => void fetchLists()} activeOpacity={0.7}>
            <Text style={s.retryText}>{t('error.retry')}</Text>
          </TouchableOpacity>
        ) : null}

        {loading
          ? [0, 1, 2].map((i) => (
              <Skeleton key={i} height={METRICS.rowMinHeight} radius={METRICS.rowRadius} />
            ))
          : shown.map((list) => (
              <View key={list.id}>
                <ListRow list={list} onPress={() => openList(list)} />
                {list.count === 0 && list.systemKey ? (
                  <Text style={s.hint}>
                    {list.systemKey === 'reel' ? t('empty.reel') : t('empty.favourites')}
                  </Text>
                ) : null}
              </View>
            ))}
      </ScrollView>

      <NewListSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        bottomOffset={bottomOffset}
        onCreate={onCreate}
        initialKind={activeKind}
      />
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: tc.feedBg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
  },
  title: { ...screenTitle, color: tc.text },
  addBtn: {
    width: METRICS.circleBtn,
    height: METRICS.circleBtn,
    borderRadius: METRICS.circleBtn / 2,
    borderWidth: 1,
    borderColor: tc.goldLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addGlyph: { color: tc.goldOnSurface, fontSize: 20, lineHeight: 22, fontWeight: '500' },
  segmentWrap: { paddingHorizontal: 18, paddingBottom: 14 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, gap: 0 },
  hint: {
    ...metaText,
    letterSpacing: 0,
    color: tc.textFaint,
    marginBottom: METRICS.rowGap,
    marginTop: -4,
    paddingHorizontal: 4,
  },
  retry: {
    paddingVertical: 10,
    marginBottom: 8,
    alignItems: 'center',
  },
  retryText: { ...listName, fontSize: 13, color: tc.goldOnSurface },
});
