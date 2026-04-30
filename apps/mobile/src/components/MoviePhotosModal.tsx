/**
 * MoviePhotosModal — admin-only image browser.
 * Shows all TMDB images for a movie: backdrops, posters, logos.
 * Tap any thumbnail to view full-size.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tmdbApi } from '../services/api';
import { colors } from '../theme/palette';

const SCREEN_W = Dimensions.get('window').width;
const THUMB_W  = (SCREEN_W - 48) / 3;   // 3-column grid
const TMDB_BASE = 'https://image.tmdb.org/t/p/';

interface ImageItem {
  file_path: string;
  width: number;
  height: number;
  vote_average: number;
  vote_count: number;
}

interface Props {
  visible: boolean;
  tmdbId: number | null;
  movieTitle: string;
  onClose: () => void;
}

type Section = 'backdrops' | 'posters' | 'logos';

export function MoviePhotosModal({ visible, tmdbId, movieTitle, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [backdrops, setBackdrops] = useState<ImageItem[]>([]);
  const [posters, setPosters]     = useState<ImageItem[]>([]);
  const [logos, setLogos]         = useState<ImageItem[]>([]);
  const [activeSection, setActiveSection] = useState<Section>('backdrops');
  const [fullImage, setFullImage]  = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !tmdbId) return;
    let cancelled = false;
    setLoading(true);
    tmdbApi.getMovieImages(tmdbId)
      .then((data) => {
        if (cancelled) return;
        setBackdrops(data.backdrops);
        setPosters(data.posters);
        setLogos(data.logos);
      })
      .catch((e) => console.warn('[MoviePhotos]', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, tmdbId]);

  const items = activeSection === 'backdrops' ? backdrops
              : activeSection === 'posters'   ? posters
              : logos;

  // Landscape sections use w780; portrait (posters/logos) use w500.
  const thumbSize = activeSection === 'backdrops' ? 'w300' : 'w185';
  const fullSize  = activeSection === 'backdrops' ? 'original' : 'w780';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{movieTitle} · Photos</Text>
          <Text style={styles.count}>{items.length}</Text>
        </View>

        {/* Section tabs */}
        <View style={styles.tabs}>
          {(['backdrops', 'posters', 'logos'] as Section[]).map((s) => {
            const n = s === 'backdrops' ? backdrops.length : s === 'posters' ? posters.length : logos.length;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.tab, activeSection === s && styles.tabActive]}
                onPress={() => setActiveSection(s)}
              >
                <Text style={[styles.tabText, activeSection === s && styles.tabTextActive]}>
                  {s.charAt(0).toUpperCase() + s.slice(1)} ({n})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Grid */}
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.empty}>No {activeSection} available.</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item, i) => `${item.file_path}-${i}`}
            numColumns={3}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => {
              const ar = item.width / item.height;
              const h  = activeSection === 'backdrops' ? THUMB_W / ar : THUMB_W * 1.4;
              return (
                <TouchableOpacity
                  style={[styles.thumb, { width: THUMB_W, height: h }]}
                  onPress={() => setFullImage(`${TMDB_BASE}${fullSize}${item.file_path}`)}
                  activeOpacity={0.8}
                >
                  <Image
                    source={{ uri: `${TMDB_BASE}${thumbSize}${item.file_path}` }}
                    style={StyleSheet.absoluteFillObject}
                    resizeMode="cover"
                  />
                  {item.vote_count > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        ★ {item.vote_average.toFixed(1)} · {item.vote_count}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </SafeAreaView>

      {/* Full-size lightbox */}
      {fullImage && (
        <Modal visible animationType="fade" onRequestClose={() => setFullImage(null)}>
          <TouchableOpacity
            style={styles.lightbox}
            onPress={() => setFullImage(null)}
            activeOpacity={1}
          >
            <Image
              source={{ uri: fullImage }}
              style={styles.lightboxImg}
              resizeMode="contain"
            />
            <Text style={styles.lightboxHint}>Tap anywhere to close</Text>
          </TouchableOpacity>
        </Modal>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  header:  {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  close:   { fontSize: 18, color: colors.primary, width: 30 },
  title:   { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  count:   { fontSize: 13, color: colors.textSecondary },

  tabs:    { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab:     {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.paper,
  },
  tabActive:     { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText:       { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#FFFFFF' },

  grid:    { padding: 12, gap: 4 },
  thumb:   {
    margin: 2,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  badge:   {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6,
  },
  badgeText: { fontSize: 9, color: '#FFD166', fontWeight: '700' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:    { color: colors.textSecondary },

  lightbox:    {
    flex: 1, backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
  },
  lightboxImg: { width: '100%', height: '90%' },
  lightboxHint:{ color: 'rgba(255,255,255,0.5)', marginTop: 8, fontSize: 12 },
});
