/**
 * ExploreScreen — the endless, level-mixed word feed.
 *
 * One word fills the viewport; a flick advances exactly one card. The
 * screen, the toast strip and the tab bar are one flat surface (`feedBg`):
 * no header, no title, no chips, no counter, no instructional text.
 *
 *   top spacer (Dynamic Island / status bar)
 *   FlatList — one WordCard per viewport, snapped
 *   toast strip (share failures only)
 *   bar spacer (the floating bottom bar's strip)
 *   [GlobalBottomBar is rendered by App.tsx, floating over that last band]
 *
 * Those four bands tile the measured container exactly — see explore/metrics.
 * The FlatList takes what is left over, so a band that is subtracted but not
 * rendered turns straight into a sliver of the next card.
 *
 * The action rail floats over the list on the right, sitting just above the
 * bottom bar — the Share glyph is the bar's neighbour. Two panels — the level
 * mix and add-to-list — slide in from the left into the same lane, stopping
 * one rail-lane short so the rail stays visible; only one is ever open. They
 * take the rail's height and bottom edge verbatim, so the three stay aligned
 * by construction. All of that geometry scales with the measured viewport
 * (see explore/metrics). While a panel is open a scrim makes the card inert
 * (the rail stays live on purpose) and any tap on it closes the panel.
 *
 * Known deviation: the scrim covers this screen only, so the tab bar stays
 * live while a panel is open (the bar is App-owned and renders below this
 * component). Switching tabs closes the panel via the `active` reset.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useWordFeedStore, PREFETCH_THRESHOLD, logFeedFlip } from '../stores/wordFeedStore';
import { dominantLevel } from '../utils/levelMix';
import type { FeedItem, LevelMix } from '../services/api';
import { WordCard, EXPLORE_EASING } from './explore/WordCard';
import { exploreMetrics } from './explore/metrics';
import { ActionRail } from './explore/ActionRail';
import { MixPanel } from './explore/MixPanel';
import { ListPanel } from './explore/ListPanel';
import { useListsStore } from '../stores/listsStore';
import { Skeleton } from './ui/Skeleton';

interface Props {
  /** Whether this tab is the visible one — drives panel reset on leave. */
  active: boolean;
  proficiencyLevel?: string | null;
  targetLanguage?: string | null;
  /**
   * Height the floating bottom bar reserves. Explore is a snap pager — one
   * card fills the viewport exactly — so unlike the scrolling tabs it does
   * *not* let content run under the glass: a card that extended behind the bar
   * would put its action rail underneath it, and there is no scrolling further
   * to bring it out. The bar's height comes off the viewport instead.
   */
  bottomOffset?: number;
}

export function ExploreScreen({
  active,
  proficiencyLevel,
  targetLanguage,
  bottomOffset = 0,
}: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const items = useWordFeedStore((st) => st.items);
  const mix = useWordFeedStore((st) => st.mix);
  const saved = useWordFeedStore((st) => st.saved);
  const activeIndex = useWordFeedStore((st) => st.activeIndex);
  const loading = useWordFeedStore((st) => st.loading);
  const exhausted = useWordFeedStore((st) => st.exhausted);
  const hydrate = useWordFeedStore((st) => st.hydrate);
  const fetchNext = useWordFeedStore((st) => st.fetchNext);
  const setMix = useWordFeedStore((st) => st.setMix);
  const favourite = useWordFeedStore((st) => st.favourite);
  // Panel state lives in the store so App's Android back handler can
  // close the panel before it leaves the tab.
  const openPanel = useWordFeedStore((st) => st.openPanel);
  const setOpenPanel = useWordFeedStore((st) => st.setPanelOpen);
  const listMembership = useWordFeedStore((st) => st.listMembership);
  const toggleList = useWordFeedStore((st) => st.toggleList);

  // Only word lists can hold a lemma, so film lists are filtered out rather
  // than shown as rows that cannot work.
  const allLists = useListsStore((st) => st.lists);
  const listsLoading = useListsStore((st) => st.status === 'loading');
  const wordLists = useMemo(() => allLists.filter((l) => l.kind === 'words'), [allLists]);

  const mixOpen = openPanel === 'mix';
  const listOpen = openPanel === 'list';
  const anyPanelOpen = openPanel !== null;

  const [available, setAvailable] = useState(0);
  const [draftMix, setDraftMix] = useState<LevelMix>(mix);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const panelAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const liftAnim = useRef(new Animated.Value(0)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;

  // Every fixed dimension the feed used to hard-code is derived from the
  // measured viewport, so a 4.7" phone gets a proportionally smaller rail
  // and lift instead of one tuned for a 6.7" screen.
  const m = useMemo(
    // The root View spans the full screen (the bar floats over it), so the
    // bar's strip is handed to the metrics as `bottomOffset` and comes back as
    // `barSpacer`, a band this screen actually renders. Subtracting it here and
    // *not* rendering it is what let the list window grow taller than a card.
    () =>
      exploreMetrics({
        viewport: available,
        width,
        topInset: insets.top,
        bottomOffset,
      }),
    [available, bottomOffset, width, insets.top],
  );
  const cardHeight = m.cardHeight;

  useEffect(() => {
    hydrate(proficiencyLevel, targetLanguage);
  }, [hydrate, proficiencyLevel, targetLanguage]);

  // Keep the panel's working copy in step when the committed mix changes.
  useEffect(() => {
    if (!mixOpen) setDraftMix(mix);
  }, [mix, mixOpen]);

  // Lists are fetched lazily — the feed shouldn't pay for them unless the
  // user actually opens the panel.
  useEffect(() => {
    if (listOpen && !useListsStore.getState().hydrated) {
      void useListsStore.getState().hydrate();
    }
  }, [listOpen]);

  // Panel slide + card lift share one curve and one duration so the word
  // rises exactly as the panel arrives.
  useEffect(() => {
    Animated.parallel([
      Animated.timing(panelAnim, {
        toValue: mixOpen ? 1 : 0,
        duration: 300,
        easing: EXPLORE_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(listAnim, {
        toValue: listOpen ? 1 : 0,
        duration: 300,
        easing: EXPLORE_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(liftAnim, {
        toValue: anyPanelOpen ? 1 : 0,
        duration: 300,
        easing: EXPLORE_EASING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [mixOpen, listOpen, anyPanelOpen, panelAnim, listAnim, liftAnim]);

  // Leaving the tab closes the panel — otherwise it would still be open,
  // and lifted, on the way back in.
  useEffect(() => {
    if (!active) setOpenPanel(null);
  }, [active, setOpenPanel]);

  // Prefetch while the user still has cards in hand, so a flick never
  // lands on a spinner.
  useEffect(() => {
    if (!exhausted && !loading && items.length > 0 &&
        activeIndex >= items.length - 1 - PREFETCH_THRESHOLD) {
      fetchNext();
    }
  }, [activeIndex, items.length, exhausted, loading, fetchNext]);

  const showToast = useCallback(
    (message: string) => {
      setToast(message);
      Animated.sequence([
        Animated.timing(toastAnim, {
          toValue: 1,
          duration: 220,
          easing: EXPLORE_EASING,
          useNativeDriver: true,
        }),
        Animated.delay(2200),
        Animated.timing(toastAnim, {
          toValue: 0,
          duration: 220,
          easing: EXPLORE_EASING,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setToast(null);
      });
    },
    [toastAnim],
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) {
        useWordFeedStore.getState().setActiveIndex(first.index);
      }
    },
  ).current;

  const current: FeedItem | undefined = items[activeIndex];

  const memberOf = useMemo(
    () => (current ? listMembership[current.lemma_id] ?? [] : []),
    [current, listMembership],
  );

  const handleToggleReveal = useCallback(
    (item: FeedItem) => {
      setRevealed((prev) => {
        const next = new Set(prev);
        if (next.has(item.lemma_id)) {
          next.delete(item.lemma_id);
        } else {
          next.add(item.lemma_id);
          logFeedFlip(item);
        }
        return next;
      });
    },
    [],
  );

  const handleShare = useCallback(async () => {
    if (!current) return;
    // A `wordwise://word/<id>` link is deliberately NOT used: the app has no
    // inbound URL routing yet, so it would open to whatever screen for people
    // who have the app and do nothing at all for everyone else. The public
    // site is the honest destination until a word route exists.
    try {
      await Share.share({
        message: `${current.word}\n\n"${current.sentence}"\n\nhttps://getwordwise.us`,
      });
    } catch {
      showToast("Couldn't open the share sheet");
    }
  }, [current, showToast]);

  const handleDone = useCallback(() => {
    setOpenPanel(null);
    setMix(draftMix);
  }, [draftMix, setMix, setOpenPanel]);

  const handleCreateList = useCallback(async (name: string) => {
    const created = await useListsStore.getState().create(name, 'words');
    // Creating a list from here means "put this word in it" — the extra tap
    // to then tick the row you just made would be pure ceremony.
    if (current) await toggleList(current, created.id);
  }, [current, toggleList]);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <WordCard
        item={item}
        height={cardHeight}
        lift={liftAnim}
        revealed={revealed.has(item.lemma_id)}
        onToggleReveal={() => handleToggleReveal(item)}
        liftDistance={m.cardLift}
        lane={m.railLane}
      />
    ),
    [cardHeight, liftAnim, revealed, handleToggleReveal, m.cardLift, m.railLane],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: cardHeight,
      offset: cardHeight * index,
      index,
    }),
    [cardHeight],
  );

  return (
    <View
      style={s.root}
      onLayout={(e) => setAvailable(e.nativeEvent.layout.height)}
    >
      <View style={{ height: m.topSpacer }} />

      <View style={s.listArea}>
        {cardHeight > 0 ? (
          <FlatList
            data={items}
            keyExtractor={(item) => String(item.lemma_id)}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            showsVerticalScrollIndicator={false}
            snapToInterval={cardHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            windowSize={3}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            removeClippedSubviews
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            // The panel's scrim already blocks touches, but stopping the
            // list outright avoids a half-scrolled card behind it.
            scrollEnabled={!anyPanelOpen}
            ListEmptyComponent={
              loading ? <CardSkeleton height={cardHeight} s={s} /> : null
            }
            ListFooterComponent={
              loading && items.length > 0 ? (
                <CardSkeleton height={cardHeight} s={s} />
              ) : null
            }
          />
        ) : null}
      </View>

      <View style={[s.toastStrip, { height: m.toastStrip }]} pointerEvents="none">
        {toast ? (
          <Animated.View
            style={[
              s.toast,
              {
                opacity: toastAnim,
                transform: [
                  {
                    translateY: toastAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={s.toastText}>{toast}</Text>
          </Animated.View>
        ) : null}
      </View>

      {/* The bar's own strip. It has to be a real band in this column, not a
          number subtracted from the card: `listArea` is flex:1 and takes
          whatever the column has left, so anything not rendered here ends up
          inside the pager as a window onto the next word. It also puts the
          toast above the glass instead of behind it. */}
      <View style={{ height: m.barSpacer }} />

      {/* Overlays, siblings of the whole column rather than children of the
          list. They are pinned to the bottom bar — `railBottom` is measured
          from the screen's bottom edge — and the card's frame stops a toast
          strip short of that, so anchoring them inside `listArea` would park
          them a strip too high and make the gap depend on the toast's size. */}
      {anyPanelOpen ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setOpenPanel(null)}
          accessibilityLabel="Close word mix"
        />
      ) : null}

      <ActionRail
        height={m.railHeight}
        bottom={m.railBottom}
        end={m.railEnd}
        mixLabel={dominantLevel(mix)}
        mixOpen={mixOpen}
        saved={current ? saved.has(current.lemma_id) : false}
        listCount={memberOf.length}
        listOpen={listOpen}
        onToggleMix={() => setOpenPanel(mixOpen ? null : 'mix')}
        onToggleList={() => setOpenPanel(listOpen ? null : 'list')}
        onFavourite={() => current && favourite(current)}
        onShare={handleShare}
      />

      <MixPanel
        draft={draftMix}
        onChange={setDraftMix}
        onDone={handleDone}
        progress={panelAnim}
        visible={mixOpen}
        height={m.railHeight}
        bottom={m.railBottom}
        lane={m.railLane}
      />

      <ListPanel
        word={current?.word ?? ''}
        lists={wordLists}
        memberOf={memberOf}
        onToggle={(listId) => current && toggleList(current, listId)}
        onCreate={handleCreateList}
        loading={listsLoading}
        progress={listAnim}
        visible={listOpen}
        height={m.railHeight}
        bottom={m.railBottom}
        lane={m.railLane}
      />
    </View>
  );
}

/** Shown only if paging somehow loses the race with the scroll — never a
 *  full-screen loader.
 *
 *  Bars were hand-rolled `View`s in `tc.skeleton`: correctly coloured, but
 *  completely static, so a card that stalled read as a broken render rather
 *  than a pending one. The `Skeleton` primitive carries the pulse and the
 *  reduce-motion fallback, which is the whole reason it exists. */
function CardSkeleton({ height, s }: { height: number; s: Styles }) {
  return (
    <View style={[s.skeleton, { height }]}>
      <Skeleton width="55%" height={44} radius={6} />
      <Skeleton width="90%" height={16} radius={6} delay={80} style={s.skelGapLarge} />
      <Skeleton width="72%" height={16} radius={6} delay={140} style={s.skelGapSmall} />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    // One flat surface, status bar to tab bar — no card, no border, no glow.
    root: { flex: 1, backgroundColor: tc.feedBg },
    listArea: { flex: 1 },
    toastStrip: {
      paddingHorizontal: 24,
      paddingBottom: 14,
      justifyContent: 'flex-end',
      backgroundColor: tc.feedBg,
    },
    toast: {
      alignSelf: 'flex-start',
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: tc.toastBg,
    },
    toastText: {
      fontSize: 12.5,
      fontWeight: '700',
      color: tc.toastText,
    },
    skeleton: {
      paddingTop: 18,
      paddingStart: 24,
      paddingEnd: 24,
      justifyContent: 'center',
    },
    // Spacing between the word block and the two sentence lines below it.
    skelGapLarge: { marginTop: 40 },
    skelGapSmall: { marginTop: 10 },
  });
