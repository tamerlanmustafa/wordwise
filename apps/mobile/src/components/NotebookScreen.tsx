import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BACK_ARROW } from '../i18n/rtl';
import { wordwiseApi, type SavedWordEntry } from '../services/api';
import { swr, writeCache } from '../services/swrCache';
import { Skeleton } from './ui/Skeleton';
import { StarIcon } from './ui/icons';
import { useBottomBarInset } from '../hooks/useBottomBarInset';

const COLORS = {
  primary: '#7C5CBF',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  textTertiary: '#9AA0AE',
  border: '#E8E8EC',
  success: '#4CAF9A',
};

type GroupMode = 'all' | 'movie';
type ListFilter = 'saved' | 'learned';

export interface NotebookScreenProps {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
  filter?: ListFilter;
  title?: string;
}

export function NotebookScreen({ onBack, backLabel, filter = 'saved', title }: NotebookScreenProps) {
  // The tab bar is an absolute overlay, so every scroller reserves its height
  // itself or its last rows sit behind the floating capsule.
  const barInset = useBottomBarInset();
  const { t } = useTranslation();
  const [words, setWords] = useState<SavedWordEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupMode, setGroupMode] = useState<GroupMode>('all');

  const headerTitle = title ?? (filter === 'learned' ? t('vocabulary:learnedWords') : t('vocabulary:savedWords'));

  // Cache the already-filtered list per filter so each view stays self-consistent.
  const cacheKey = `saved_words_${filter}`;

  // Stale-while-revalidate: show last-known words instantly from disk, then
  // refresh from the network (playbook §7 instant loads, §9 offline resilience).
  const load = useCallback(async () => {
    setLoading(true);
    await swr<SavedWordEntry[]>(
      cacheKey,
      async () => {
        const data = await wordwiseApi.getSavedWords();
        return filter === 'learned' ? data.filter((w) => w.is_learned) : data;
      },
      {
        onData: (data) => { setWords(data); setLoading(false); },
        onError: () => setLoading(false),
      },
    );
  }, [filter, cacheKey]);

  useEffect(() => { load(); }, [load]);

  // Optimistic unsave: drop the word from the list immediately so the tap feels
  // instant, then fire the toggle in the background. We also write the trimmed
  // list back to the cache so it doesn't briefly reappear on the next open. On
  // failure we re-sync from the server rather than leaving a phantom removal
  // (playbook §1).
  const handleUnsave = useCallback((entry: SavedWordEntry) => {
    setWords((prev) => {
      const next = prev.filter((w) => w.id !== entry.id);
      writeCache(cacheKey, next).catch(() => {});
      return next;
    });
    wordwiseApi.saveWord(entry.word, entry.movie_id).catch(() => { load(); });
  }, [load, cacheKey]);

  const movieGrouped = useMemo(() => {
    const map = new Map<string, SavedWordEntry[]>();
    for (const w of words) {
      if (w.saved_in_movies?.length) {
        for (const m of w.saved_in_movies) {
          const key = m.title;
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(w);
        }
      } else {
        const key = 'No movie';
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(w);
      }
    }
    return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
  }, [words]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={onBack} backLabel={backLabel} title={headerTitle} />
        {/* Skeleton rows mirror the real word list so nothing shifts when the
            data lands, and read as "almost there" rather than a blank spinner. */}
        <View style={styles.listContent}>
          {Array.from({ length: 8 }).map((_, i) => (
            <View key={i} style={styles.wordItem}>
              <Skeleton width={140} height={16} radius={5} color={COLORS.border} />
              <Skeleton width={44} height={11} radius={5} color={COLORS.border} />
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (words.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={onBack} backLabel={backLabel} title={headerTitle} />
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>
            {filter === 'learned' ? t('vocabulary:learned.emptyShort') : t('vocabulary:notebook.emptySaved')}
          </Text>
          <Text style={styles.emptyBody}>
            {filter === 'learned'
              ? 'Words you mark as learned during review will appear here.'
              : "Tap the star icon on any word in a movie's vocabulary list to save it here."}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onBack}>
            <Text style={styles.primaryBtnText}>{t('vocabulary:notebook.browseMovies')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header onBack={onBack} backLabel={backLabel} title={headerTitle} />

      {/* Toggle + count */}
      <View style={styles.toolbar}>
        <Text style={styles.wordCount}>{t('wordCount', { count: words.length })}</Text>
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, groupMode === 'all' && styles.toggleBtnActive]}
            onPress={() => setGroupMode('all')}
          >
            <Text style={[styles.toggleText, groupMode === 'all' && styles.toggleTextActive]}>{t('vocabulary:notebook.all')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, groupMode === 'movie' && styles.toggleBtnActive]}
            onPress={() => setGroupMode('movie')}
          >
            <Text style={[styles.toggleText, groupMode === 'movie' && styles.toggleTextActive]}>{t('vocabulary:notebook.byMovie')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {groupMode === 'all' ? (
        <FlatList
          data={words}
          keyExtractor={(item) => `${item.id}`}
          contentContainerStyle={[styles.listContent, { paddingBottom: barInset + 24 }]}
          renderItem={({ item }) => <WordItem word={item} onUnsave={handleUnsave} />}
        />
      ) : (
        <FlatList
          data={movieGrouped}
          keyExtractor={(item) => item.title}
          contentContainerStyle={[styles.listContent, { paddingBottom: barInset + 24 }]}
          renderItem={({ item }) => (
            <View style={styles.movieGroup}>
              <Text style={styles.movieGroupTitle}>{item.title}</Text>
              <Text style={styles.movieGroupCount}>{t('wordCount', { count: item.items.length })}</Text>
              {item.items.map((w) => (
                <WordItem key={w.id} word={w} onUnsave={handleUnsave} compact />
              ))}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Header({ onBack, backLabel, title }: { onBack: () => void; backLabel?: string; title?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={8}>
        <Text style={styles.backText}>{BACK_ARROW} {backLabel ?? t('action.back')}</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title ?? 'My Words'}</Text>
      <View style={{ width: 60 }} />
    </View>
  );
}

function WordItem({ word, onUnsave, compact }: { word: SavedWordEntry; onUnsave: (word: SavedWordEntry) => void; compact?: boolean }) {
  const date = new Date(word.created_at);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;

  return (
    <View style={[styles.wordItem, compact && styles.wordItemCompact]}>
      <View style={styles.wordItemLeft}>
        <Text style={styles.wordItemWord}>{word.word}</Text>
        {!compact && word.saved_in_movies?.length > 0 && (
          <Text style={styles.wordItemMovie}>
            {word.saved_in_movies.map((m) => m.title).join(', ')}
          </Text>
        )}
      </View>
      <View style={styles.wordItemRight}>
        <Text style={styles.wordItemDate}>{dateStr}</Text>
        <TouchableOpacity onPress={() => onUnsave(word)} hitSlop={8}>
          <StarIcon size={18} filled animate={false} style={styles.unsaveIcon} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.paper,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backText: { fontSize: 16, color: COLORS.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.paper,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  wordCount: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', gap: 4 },
  toggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#F0EDE8',
  },
  toggleBtnActive: { backgroundColor: COLORS.primary },
  toggleText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  toggleTextActive: { color: '#FFFFFF' },
  listContent: { padding: 16, paddingBottom: 32 },
  wordItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.paper,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  wordItemCompact: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 10,
    marginBottom: 0,
  },
  wordItemLeft: { flex: 1 },
  wordItemWord: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  wordItemMovie: { fontSize: 12, color: COLORS.textTertiary, marginTop: 2 },
  wordItemRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wordItemDate: { fontSize: 11, color: COLORS.textTertiary },
  unsaveIcon: {},
  movieGroup: {
    backgroundColor: COLORS.paper,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  movieGroupTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  movieGroupCount: { fontSize: 12, color: COLORS.textTertiary, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
