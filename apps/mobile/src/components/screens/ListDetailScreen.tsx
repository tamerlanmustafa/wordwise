/**
 * ListDetailScreen — one open list.
 *
 * A list is a collection, not a quiz. It shows what is in it and lets you
 * reorder, remove and delete; practice lives on the Practice tab and nowhere
 * else. The screen used to carry a gold "Practice these words" button that
 * started an SRS session scoped to this list — films lists lost their version
 * of it first, and words lists have now followed.
 *
 * There is deliberately no primary action left. Every control here is a small
 * one in the corner, because the content *is* the screen.
 *
 * The overflow button is absent entirely on the two pinned lists rather than
 * present-and-disabled: there is nothing behind it for them, and a dead
 * button invites a tap that does nothing.
 *
 * ## Every removal can be undone
 *
 * Removing an item used to be one silent tap: the row vanished, the request
 * went out, and nothing on the screen could bring it back. On a list the user
 * made, the control that did it was an empty heart — which reads as "favourite
 * this" — so the words people were trying to keep were the ones they deleted.
 * Removals now go through `removeItemWithUndo`: the row goes at once, the
 * delete waits out the toast, and Undo puts the item back exactly where it was.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TopInsetView } from '../common/TopInsetView';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { BackButton } from '../common/BackButton';
import { SortSheet } from '../lists/SortSheet';
import { ListActionsSheet } from '../lists/ListActionsSheet';
import { NewListSheet } from '../lists/NewListSheet';
import { FilmItemRow, ListItemsSkeleton, WordItemRow } from '../lists/ListItemRows';
import { useListDisplayName } from '../lists/ListRow';
import {
  METRICS,
  META_SEPARATOR,
  detailTitle,
  listName,
  metaText,
} from '../lists/listStyles';
import { REMOVE_UNDO_MS, useListsStore } from '../../stores/listsStore';
import { showConfirm } from '../../stores/confirmStore';
import { showToast } from '../../stores/toastStore';
import { track } from '../../services/analytics';
import {
  ConnectionError,
  ConnectionStrip,
  SlowConnectionStrip,
} from '../common/ConnectionError';
import { useSlowConnection } from '../../hooks/useSlowConnection';
import type {
  ListFilmItem,
  ListSort,
  ListSummary,
  ListWordItem,
} from '../../core/types';
import { withTap } from '../../utils/feedback';

interface Props {
  list: ListSummary;
  onBack: () => void;
  onOpenFilm: (item: ListFilmItem) => void;
  bottomOffset: number;
}

export function ListDetailScreen({
  list,
  onBack,
  onOpenFilm,
  bottomOffset,
}: Props) {
  const { t } = useTranslation('lists');
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const detail = useListsStore((st) => st.byId[list.id]);
  const indexRow = useListsStore((st) => st.lists.find((l) => l.id === list.id));
  const failure = useListsStore((st) => st.detailFailure[list.id] ?? null);
  const fetchDetail = useListsStore((st) => st.fetchDetail);
  const removeItemWithUndo = useListsStore((st) => st.removeItemWithUndo);
  const destroy = useListsStore((st) => st.destroy);
  const rename = useListsStore((st) => st.rename);

  // 'added' for both kinds now. A words list opened on "soonest due", which
  // ordered the reader's own collection by a schedule they never set and put
  // whatever the algorithm wanted first — the order a list is *built* in is the
  // one its owner recognises.
  const [sort, setSort] = useState<ListSort>('added');
  const [sortOpen, setSortOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  // Freshest first: the open page's own summary, then the index row (kept
  // current by every mutation), and only then the copy handed over at
  // navigation time, which is frozen at the moment of the tap.
  const summary = detail?.summary ?? indexRow ?? list;
  const name = useListDisplayName(summary);
  const isSystem = summary.systemKey !== null;
  const isFilms = summary.kind === 'films';

  const load = useCallback(() => { void fetchDetail(list.id, sort); }, [fetchDetail, list.id, sort]);
  useEffect(() => { load(); }, [load]);

  const meta = useMemo(() => {
    const parts: string[] = [];
    if (isFilms) {
      parts.push(t('meta.filmCount', { count: summary.count }));
      if (summary.totalWords) parts.push(t('meta.wordCount', { count: summary.totalWords }));
      if (summary.systemKey === 'reel') parts.push(t('meta.addedFromHome'));
    } else {
      parts.push(t('meta.wordCount', { count: summary.count }));
    }
    return parts.join(META_SEPARATOR);
  }, [isFilms, summary, t]);

  const confirmDelete = useCallback(() => {
    showConfirm({
      title: t('delete.title'),
      message: t('delete.body'),
      confirmLabel: t('delete.confirm'),
      tone: 'destructive',
      onConfirm: () => {
        // Leave at once — the list is already gone from the index — but only
        // SAY it is deleted once the server agrees. This toast used to fire
        // before the request resolved, so a failed delete read "List deleted",
        // then "Couldn't delete that list", and the list came back.
        onBack();
        void destroy(list.id).then((deleted) => {
          if (!deleted) return; // the store has already said why
          track('list_deleted');
          showToast({ message: t('delete.done'), tone: 'success' });
        });
      },
    });
  }, [destroy, list.id, onBack, t]);

  /** Remove one item, with an Undo that lasts exactly as long as the toast. */
  const removeWithUndo = useCallback(
    (key: number | string) => {
      const undo = removeItemWithUndo(list.id, key);
      showToast({
        message: t('removed.fromList', { name }),
        actionLabel: t('delete.undo'),
        onAction: undo,
        duration: REMOVE_UNDO_MS,
      });
    },
    [removeItemWithUndo, list.id, name, t],
  );

  const items = detail?.items ?? [];
  const loading = !detail && !failure;
  // Only while there is nothing to show — a slow refresh behind rows the
  // reader can already see is not worth a banner.
  const slow = useSlowConnection(loading);

  return (
    <TopInsetView style={s.container}>
      <View style={s.topRow}>
        {/* The app's one back control — a circle with a text arrow in it was
            a fourth variant of the same affordance. */}
        <BackButton onPress={onBack} />

        {/* Absent, not disabled, on the pinned lists — there is nothing to
            rename or delete there.

            Opens options, as "⋯" promises everywhere else. It used to go
            straight to "Delete this list?", which put the tab's only
            destructive action behind the glyph people tap to look around. */}
        {isSystem ? <View style={{ width: METRICS.circleBtn }} /> : (
          <TouchableOpacity
            style={s.circleBtn}
            onPress={withTap(() => setActionsOpen(true))}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.options')}
          >
            <Text style={s.circleGlyph}>⋯</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.headerBlock}>
        <Text style={s.title} numberOfLines={2}>{name}</Text>
        <Text style={s.meta}>{meta}</Text>
      </View>

      {/* Sort only. A list used to carry a gold "Practice these words" button
          that started an SRS session scoped to the list; films lists lost the
          equivalent first, and now words lists have too. Practice is the
          Practice tab's job — one deck, one place, one streak — and a second
          entry point into the same machinery from a screen whose purpose is
          *keeping* words was a second thing to reason about for both the
          reader and the session-credit rules. A list is a collection you
          revise from, not a quiz. */}
      <View style={s.actionRow}>
        <TouchableOpacity
          style={s.sortBtn}
          onPress={withTap(() => setSortOpen(true))}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.sort')}
        >
          <Text style={s.circleGlyph}>⇅</Text>
        </TouchableOpacity>
      </View>

      {/* A refresh that failed behind items already on screen: say so, keep
          them. Only when there IS a page — without one, the full view below
          takes the whole body instead. */}
      {detail && failure ? <ConnectionStrip failure={failure} onRetry={load} /> : null}
      {slow ? <SlowConnectionStrip /> : null}

      {!detail && failure ? (
        // Nothing to show and the request failed. This used to be the skeleton
        // for ever: "loading" was simply "no page yet", so a list opened
        // offline shimmered with no error and no retry — measured at 15s and
        // still going.
        <ConnectionError failure={failure} onRetry={load} />
      ) : (
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: bottomOffset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ListItemsSkeleton kind={isFilms ? 'films' : 'words'} />
        ) : items.length === 0 ? (
          <Text style={s.empty}>
            {isFilms ? t('empty.films') : t('empty.words')}
          </Text>
        ) : isFilms ? (
          (items as ListFilmItem[]).map((item) => (
            <FilmItemRow
              key={item.tmdbId}
              item={item}
              // Bare: the row wraps it.
              onRemove={() => removeWithUndo(item.tmdbId)}
              onPress={withTap(() => onOpenFilm(item))}
            />
          ))
        ) : (
          (items as ListWordItem[]).map((item) => (
            <WordItemRow
              key={item.word}
              item={item}
              // A heart only where it means Favourites. On a list the user made
              // this used to be an EMPTY heart — "favourite this" — whose tap
              // deleted the word from the list. See WordItemRow.
              control={summary.systemKey === 'favourites' ? 'favourite' : 'member'}
              // Bare: the row wraps it.
              onRemove={() => removeWithUndo(item.word)}
            />
          ))
        )}
      </ScrollView>
      )}

      <SortSheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        bottomOffset={bottomOffset}
        kind={summary.kind}
        value={sort}
        onChange={setSort}
      />

      {isSystem ? null : (
        <>
          <ListActionsSheet
            visible={actionsOpen}
            onClose={() => setActionsOpen(false)}
            bottomOffset={bottomOffset}
            title={name}
            onRename={() => setRenameOpen(true)}
            onDelete={confirmDelete}
          />
          <NewListSheet
            mode="rename"
            visible={renameOpen}
            onClose={() => setRenameOpen(false)}
            bottomOffset={bottomOffset}
            initialName={summary.name}
            onRename={(next) => rename(list.id, next)}
          />
        </>
      )}
    </TopInsetView>
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
    // Trailing edge. The row holds only the sort control now, so this is what
    // parks it in the corner instead of stranding it on the left where the
    // practice button used to start.
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  // Gold-on-dark text is goldDeep, never white — white fails contrast.
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
