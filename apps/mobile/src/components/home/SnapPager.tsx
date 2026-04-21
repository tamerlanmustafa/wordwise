import React, { useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../theme/palette';

const SNAP_CARD_WIDTH = 150;
const SNAP_CARD_GAP = 12;
const SNAP_INTERVAL = SNAP_CARD_WIDTH + SNAP_CARD_GAP;

interface Props {
  movies: any[];
  onMoviePress: (movie: any) => void;
}

export const SnapPager = ({ movies, onMoviePress }: Props) => {
  const [activeIndex, setActiveIndex] = useState(0);
  if (movies.length === 0) return null;

  const dotCount = Math.ceil(movies.length / 3);
  const activeDot = Math.floor(activeIndex / 3);

  return (
    <View>
      <FlatList
        data={movies}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => String(item.id)}
        snapToInterval={SNAP_INTERVAL}
        decelerationRate="fast"
        snapToAlignment="start"
        contentContainerStyle={{ paddingRight: 16 }}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SNAP_INTERVAL);
          setActiveIndex(idx);
        }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={snapStyles.card}
            onPress={() => onMoviePress(item)}
            activeOpacity={0.8}
          >
            <Image
              source={{ uri: `https://image.tmdb.org/t/p/w300${item.poster_path}` }}
              style={snapStyles.poster}
            />
            <Text style={snapStyles.title} numberOfLines={2}>{item.title}</Text>
            <Text style={snapStyles.year}>{item.release_date?.slice(0, 4)}</Text>
          </TouchableOpacity>
        )}
      />
      <View style={snapStyles.dots}>
        {Array.from({ length: dotCount }).map((_, i) => (
          <View
            key={i}
            style={[
              snapStyles.dot,
              i === activeDot && snapStyles.dotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
};

const snapStyles = StyleSheet.create({
  card: {
    width: SNAP_CARD_WIDTH,
    marginRight: SNAP_CARD_GAP,
  },
  poster: {
    width: SNAP_CARD_WIDTH,
    height: SNAP_CARD_WIDTH * 1.5,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 8,
  },
  year: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 18,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
});
