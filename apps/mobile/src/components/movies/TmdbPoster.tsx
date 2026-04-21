import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, Text, View, ViewStyle } from 'react-native';
import { colors } from '../../theme/palette';

// Module-level cache: same tmdbId fetched from several screens only hits TMDB once.
const tmdbPosterCache: Record<number, string | null> = {};

// TODO: move the TMDB API key to config/env instead of hard-coding it here.
const TMDB_API_KEY = '9dece7a38786ac0c58794d6db4af3d51';

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
        const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
        const data = await res.json();
        const posterPath = data.poster_path
          ? `https://image.tmdb.org/t/p/w185${data.poster_path}`
          : null;
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
        <Text style={{ fontSize: 24 }}>🎬</Text>
      </View>
    );
  }
  return <Image source={{ uri }} style={style} />;
};
