import React from 'react';
import {
  Image,
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../../theme/palette';

interface Props {
  movie: any | null;
  onPress: (movie: any) => void;
  continueMovie?: any | null;
  onContinuePress?: (movie: any) => void;
}

export const MobileHeroSection = ({
  movie,
  onPress,
  continueMovie,
  onContinuePress,
}: Props) => {
  if (!movie) return null;
  const backdrop = movie.backdrop_path
    ? `https://image.tmdb.org/t/p/w780${movie.backdrop_path}`
    : null;

  const continuePill = continueMovie ? (
    <TouchableOpacity
      style={heroStyles.continuePill}
      onPress={(e) => {
        e.stopPropagation();
        onContinuePress?.(continueMovie);
      }}
      activeOpacity={0.85}
    >
      {continueMovie.poster_path ? (
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w92${continueMovie.poster_path}` }}
          style={heroStyles.continuePillPoster}
        />
      ) : (
        <View style={[heroStyles.continuePillPoster, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />
      )}
      <View style={heroStyles.continuePillText}>
        <Text style={heroStyles.continuePillLabel}>CONTINUE</Text>
        <Text style={heroStyles.continuePillTitle} numberOfLines={1}>
          {continueMovie.title}
        </Text>
      </View>
      <Text style={heroStyles.continuePillArrow}>▶</Text>
    </TouchableOpacity>
  ) : null;

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={() => onPress(movie)}>
      <View style={heroStyles.container}>
        {backdrop ? (
          <ImageBackground source={{ uri: backdrop }} style={heroStyles.backdrop} resizeMode="cover">
            <View style={heroStyles.overlayBottom} />
            {continuePill}
            <View style={heroStyles.content}>
              <Text style={heroStyles.title} numberOfLines={1}>{movie.title}</Text>
              {movie.overview ? (
                <Text style={heroStyles.overview} numberOfLines={1}>
                  {movie.overview}
                </Text>
              ) : null}
              <TouchableOpacity
                style={heroStyles.ctaButton}
                onPress={() => onPress(movie)}
                activeOpacity={0.85}
              >
                <Text style={heroStyles.ctaText}>▶  Start Learning</Text>
              </TouchableOpacity>
            </View>
          </ImageBackground>
        ) : (
          <View style={[heroStyles.backdrop, { backgroundColor: colors.primary }]}>
            {continuePill}
            <View style={heroStyles.content}>
              <Text style={heroStyles.title}>{movie.title}</Text>
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const heroStyles = StyleSheet.create({
  container: { width: '100%', height: 360 },
  backdrop: { width: '100%', height: '100%', justifyContent: 'flex-end' },
  continuePill: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 22,
    paddingVertical: 4,
    paddingHorizontal: 4,
    paddingRight: 12,
    maxWidth: 240,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  continuePillPoster: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 10,
  },
  continuePillText: {
    flexShrink: 1,
    marginRight: 8,
  },
  continuePillLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFD166',
    letterSpacing: 1,
  },
  continuePillTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  continuePillArrow: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  overlayBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '38%',
    backgroundColor: 'rgba(0,0,0,0.78)',
    zIndex: 1,
  },
  content: {
    zIndex: 2,
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
    lineHeight: 27,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  overview: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 16,
    marginBottom: 10,
  },
  ctaButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
