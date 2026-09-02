import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, View, ViewStyle } from 'react-native';
import { colors } from '../../theme/palette';
import { tmdbApi } from '../../services/api';
import { FilmIcon } from '../ui/icons';

// Module-level cache of the resolved image URL. `tmdbApi.getMovieDetails`
// caches the metadata itself and coalesces the lookups a grid of posters
// raises into one request, so this layer only saves rebuilding the URL.
const tmdbPosterCache: Record<number, string | null> = {};

interface Props {
  tmdbId: number;
  // Callers pass either a View-shaped or Image-shaped style; both branches
  // render one or the other, so accept the superset.
  style: StyleProp<ViewStyle & ImageStyle>;
}

export const TmdbPoster = ({ tmdbId, style }: Props) => {
  const [uri, setUri] = useState<string | null>(tmdbPosterCache[tmdbId] ?? null);
  const [loaded, setLoaded] = useState(!!tmdbPosterCache[tmdbId]);

  useEffect(() => {
    if (tmdbPosterCache[tmdbId] !== undefined) {
      setUri(tmdbPosterCache[tmdbId]);
      setLoaded(true);
      return;
    }
    (async () => {
      try {
        const movie = await tmdbApi.getMovieDetails(tmdbId);
        const posterPath = tmdbApi.getPosterUrl(movie?.poster_path ?? null, 'w185');
        tmdbPosterCache[tmdbId] = posterPath;
        setUri(posterPath);
      } catch {
        tmdbPosterCache[tmdbId] = null;
      }
      setLoaded(true);
    })();
  }, [tmdbId]);

  if (!loaded) return <View style={[style, { backgroundColor: colors.border }]} />;
  if (!uri) {
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
        <FilmIcon size={26} />
      </View>
    );
  }
  return <Image source={{ uri }} style={style} />;
};
