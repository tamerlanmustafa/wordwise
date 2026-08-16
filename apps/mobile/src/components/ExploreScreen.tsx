/**
 * ExploreScreen — the endless, level-mixed word feed.
 *
 * One word fills the viewport; a flick advances exactly one card. The
 * screen, the toast strip and the tab bar are one flat surface (`feedBg`):
 * no header, no title, no chips, no counter, no instructional text.
 *
 *   62px spacer (Dynamic Island / status bar)
 *   FlatList — one WordCard per viewport, snapped
 *   toast strip (share failures only)
 *   [GlobalBottomBar is rendered by App.tsx below this]
 *
 * The action rail floats over the list on the right; the mix panel slides in
 * from the left and stops 76px short so the rail stays visible. While a
 * panel is open a scrim makes the card and the rail inert, and any tap on it
 * closes the panel.
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
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useWordFeedStore, PREFETCH_THRESHOLD, logFeedFlip } from '../stores/wordFeedStore';
import { dominantLevel } from '../utils/levelMix';
import type { FeedItem, LevelMix } from '../services/api';
import { WordCard, EXPLORE_EASING } from './explore/WordCard';
import { ActionRail } from './explore/ActionRail';
import { MixPanel } from './explore/MixPanel';

/** Clears the Dynamic Island / notch. Larger insets win on devices that
 *  report more (spec's floor is 62). */
const TOP_SPACER = 62;

/** Reserved so the surface never reflows when a toast comes and goes. */
const TOAST_STRIP_HEIGHT = 46;

interface Props {
  /** Whether this tab is the visible one — drives panel reset on leave. */
  active: boolean;
  proficiencyLevel?: string | null;
  targetLanguage?: string | null;
}

export function ExploreScreen({ active, proficiencyLevel, targetLanguage }: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const insets = useSafeAreaInsets();

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
  const mixOpen = useWordFeedStore((st) => st.panelOpen);
  const setMixOpen = useWordFeedStore((st) => st.setPanelOpen);

  const [available, setAvailable] = useState(0);
  const [draftMix, setDraftMix] = useState<LevelMix>(mix);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const panelAnim = useRef(new Animated.Value(0)).current;
  const liftAnim = useRef(new Animated.Value(0)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;

  const topSpacer = Math.max(TOP_SPACER, insets.top);
  const cardHeight = Math.max(0, available - topSpacer - TOAST_STRIP_HEIGHT);

  useEffect(() => {
    hydrate(proficiencyLevel, targetLanguage);
  }, [hydrate, proficiencyLevel, targetLanguage]);

  // Keep the panel's working copy in step when the committed mix changes.
  useEffect(() => {
    if (!mixOpen) setDraftMix(mix);
  }, [mix, mixOpen]);

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
      Animated.timing(liftAnim, {
        toValue: mixOpen ? 1 : 0,
        duration: 300,
        easing: EXPLORE_EASING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [mixOpen, panelAnim, liftAnim]);

  // Leaving the tab closes the panel — otherwise it would still be open,
  // and lifted, on the way back in.
  useEffect(() => {
    if (!active) setMixOpen(false);
  }, [active, setMixOpen]);

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
    setMixOpen(false);
    setMix(draftMix);
  }, [draftMix, setMix, setMixOpen]);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <WordCard
        item={item}
        height={cardHeight}
        lift={liftAnim}
        revealed={revealed.has(item.lemma_id)}
        onToggleReveal={() => handleToggleReveal(item)}
      />
    ),
    [cardHeight, liftAnim, revealed, handleToggleReveal],
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
      <View style={{ height: topSpacer }} />

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
            scrollEnabled={!mixOpen}
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

        {/* Scrim — above the card and the rail, below the panel. Any tap
            closes the panel and does nothing else. */}
        {mixOpen ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setMixOpen(false)}
            accessibilityLabel="Close word mix"
          />
        ) : null}

        <ActionRail
          mixLabel={dominantLevel(mix)}
          mixOpen={mixOpen}
          saved={current ? saved.has(current.lemma_id) : false}
          onToggleMix={() => setMixOpen(!mixOpen)}
          onFavourite={() => current && favourite(current)}
          onShare={handleShare}
        />

        <MixPanel
          draft={draftMix}
          onChange={setDraftMix}
          onDone={handleDone}
          progress={panelAnim}
          visible={mixOpen}
        />
      </View>

      <View style={s.toastStrip} pointerEvents="none">
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
    </View>
  );
}

/** Shown only if paging somehow loses the race with the scroll — never a
 *  full-screen loader. */
function CardSkeleton({ height, s }: { height: number; s: Styles }) {
  return (
    <View style={[s.skeleton, { height }]}>
      <View style={[s.skelBar, { width: '55%', height: 44 }]} />
      <View style={[s.skelBar, { width: '90%', height: 16, marginTop: 40 }]} />
      <View style={[s.skelBar, { width: '72%', height: 16, marginTop: 10 }]} />
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
      height: TOAST_STRIP_HEIGHT,
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
      paddingEnd: 76,
      paddingStart: 24,
      justifyContent: 'center',
    },
    skelBar: {
      borderRadius: 6,
      backgroundColor: tc.skeleton,
    },
  });
