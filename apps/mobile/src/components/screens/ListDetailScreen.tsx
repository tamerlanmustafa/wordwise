/**
 * ListDetailScreen — one open list.
 *
 * Exactly one gold action, and it always means the same thing: hand this
 * list to Practice. Its label changes with what the list actually holds
 * (`Practice 6 due` reads as a specific job; `Practice this list` as a
 * general one), but there is never a second competing primary action.
 *
 * The overflow button is absent entirely on the two pinned lists rather than
 * present-and-disabled: there is nothing behind it for them, and a dead
 * button invites a tap that does nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { BACK_ARROW } from '../../i18n/rtl';
import { Skeleton } from '../ui/Skeleton';
import { SortSheet } from '../lists/SortSheet';
import { FilmItemRow, WordItemRow } from '../lists/ListItemRows';
import { useListDisplayName } from '../lists/ListRow';
import {
  METRICS,
  META_SEPARATOR,
  detailTitle,
  listName,
  metaText,
} from '../lists/listStyles';
import { useListsStore } from '../../stores/listsStore';
import { showConfirm } from '../../stores/confirmStore';
import { showToast } from '../../stores/toastStore';
import { listsApi, ListApiError, SrsPaywallError } from '../../services/api';
import { track } from '../../services/analytics';
import type {
  ListFilmItem,
  ListSort,
  ListSummary,
  ListWordItem,
} from '../../core/types';
import type { SrsSessionStart } from '../../services/api';

interface Props {
  list: ListSummary;
  onBack: () => void;
  /** Hands the started session to the review screen. */
  onStartSession: (session: SrsSessionStart, listId: number) => void;
  onOpenFilm: (item: ListFilmItem) => void;
  onOpenWord: (item: ListWordItem) => void;
  onPaywall: () => void;
  bottomOffset: number;
}

export function ListDetailScreen({
  list,
  onBack,
  onStartSession,
  onOpenFilm,
  onOpenWord,
  onPaywall,
  bottomOffset,
}: Props) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const detail = useListsStore((st) => st.byId[list.id]);
  const fetchDetail = useListsStore((st) => st.fetchDetail);
  const removeItem = useListsStore((st) => st.removeItem);
  const destroy = useListsStore((st) => st.destroy);
  const rename = useListsStore((st) => st.rename);

  const [sort, setSort] = useState<ListSort>(list.kind === 'words' ? 'due' : 'added');
  const [sortOpen, setSortOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  // The summary on the store is fresher than the one we were handed.
  const summary = detail?.summary ?? list;
  const name = useListDisplayName(summary);
  const isSystem = summary.systemKey !== null;
  const isFilms = summary.kind === 'films';

  useEffect(() => { void fetchDetail(list.id, sort); }, [fetchDetail, list.id, sort]);

  const meta = useMemo(() => {
    const parts: string[] = [];
    if (isFilms) {
      parts.push(t('meta.filmCount', { count: summary.count }));
      if (summary.totalWords) parts.push(t('meta.wordCount', { count: summary.totalWords }));
      if (summary.systemKey === 'reel') parts.push(t('meta.addedFromHome'));
    } else {
      parts.push(t('meta.wordCount', { count: summary.count }));
      if (summary.dueCount) parts.push(t('meta.dueCount', { count: summary.dueCount }));
    }
    return parts.join(META_SEPARATOR);
  }, [isFilms, summary, t]);

  const practiceLabel = useMemo(() => {
    if (summary.count === 0) return t('practice.empty');
    if (isFilms) return t('practice.films');
    return summary.dueCount ? t('practice.due', { count: summary.dueCount }) : t('practice.none');
  }, [isFilms, summary.count, summary.dueCount, t]);

  const startPractice = useCallback(async () => {
    if (summary.count === 0 || starting) return;
    setStarting(true);
    try {
      const session = await listsApi.practice(list.id);
      track('list_practice_started', {
        kind: summary.kind,
        item_count: summary.count,
        due_count: summary.dueCount ?? 0,
      });
      onStartSession(session, list.id);
    } catch (e) {
      // A free user who already did today's session hits the same daily cap
      // here as on the Practice tab — same paywall, not a list-specific error.
      if (e instanceof SrsPaywallError) {
        onPaywall();
      } else {
        showToast({
          message: e instanceof ListApiError ? e.message : t('practice.empty'),
          tone: 'error',
        });
      }
    } finally {
      setStarting(false);
    }
  }, [summary, starting, list.id, onStartSession, onPaywall, t]);

  const confirmDelete = useCallback(() => {
    showConfirm({
      title: t('delete.title'),
      message: t('delete.body'),
      confirmLabel: t('delete.confirm'),
      tone: 'destructive',
      onConfirm: () => {
        void destroy(list.id);
        track('list_deleted');
        onBack();
        showToast({ message: t('delete.done'), tone: 'success' });
      },
    });
  }, [destroy, list.id, onBack, t]);

  const items = detail?.items ?? [];
  const loading = !detail;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.topRow}>
        <TouchableOpacity
          style={s.circleBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common:action.back')}
        >
          <Text style={s.circleGlyph}>{BACK_ARROW}</Text>
        </TouchableOpacity>

        {/* Absent, not disabled, on the pinned lists. */}
        {isSystem ? <View style={{ width: METRICS.circleBtn }} /> : (
          <TouchableOpacity style={s.circleBtn} onPress={confirmDelete} activeOpacity={0.7}>
            <Text style={s.circleGlyph}>⋯</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.headerBlock}>
        <Text style={s.title} numberOfLines={2}>{name}</Text>
        <Text style={s.meta}>{meta}</Text>
      </View>

      <View style={s.actionRow}>
        <TouchableOpacity
          style={[s.practiceBtn, summary.count === 0 && s.practiceBtnDisabled]}
          onPress={startPractice}
          disabled={summary.count === 0 || starting}
          activeOpacity={0.85}
        >
          <Text
            style={[
              s.practiceLabel,
              summary.count === 0 && { color: tc.textFaint },
            ]}
            numberOfLines={1}
          >
            {practiceLabel}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.sortBtn} onPress={() => setSortOpen(true)} activeOpacity={0.7}>
          <Text style={s.circleGlyph}>⇅</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: bottomOffset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} height={74} radius={8} />)
        ) : items.length === 0 ? (
          <Text style={s.empty}>
            {isFilms ? t('empty.films') : t('empty.words')}
          </Text>
        ) : isFilms ? (
          (items as ListFilmItem[]).map((item) => (
            <FilmItemRow
              key={item.tmdbId}
              item={item}
              inList
              onToggle={() => void removeItem(list.id, item.tmdbId)}
              onPress={() => onOpenFilm(item)}
            />
          ))
        ) : (
          (items as ListWordItem[]).map((item) => (
            <WordItemRow
              key={item.word}
              item={item}
              // Inside Favourites every row is by definition favourited, so
              // the heart is the remove control.
              favourite={summary.systemKey === 'favourites'}
              onToggleFavourite={() => void removeItem(list.id, item.word)}
              onPress={() => onOpenWord(item)}
            />
          ))
        )}
      </ScrollView>

      <SortSheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        bottomOffset={bottomOffset}
        kind={summary.kind}
        value={sort}
        onChange={setSort}
      />
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: tc.feedBg },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  circleBtn: {
    width: METRICS.circleBtn,
    height: METRICS.circleBtn,
    borderRadius: METRICS.circleBtn / 2,
    backgroundColor: tc.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleGlyph: { color: tc.text, fontSize: 15 },
  headerBlock: { paddingHorizontal: 18, paddingTop: 12, gap: 6 },
  title: { ...detailTitle, color: tc.text },
  meta: { ...metaText, color: tc.goldOnSurface },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  practiceBtn: {
    flex: 1,
    height: 44,
    borderRadius: 13,
    backgroundColor: tc.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  practiceBtnDisabled: { backgroundColor: tc.chipBg },
  // Gold-on-dark text is goldDeep, never white — white fails contrast.
  practiceLabel: { ...listName, fontSize: 15, color: tc.goldDeep },
  sortBtn: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: tc.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18 },
  empty: {
    ...listName,
    fontWeight: '400',
    fontSize: 14,
    color: tc.textFaint,
    textAlign: 'center',
    marginTop: 40,
  },
});
