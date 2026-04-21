import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors } from '../../theme/palette';

interface Book {
  title: string;
  author?: string;
  cover?: string;
}

interface Props {
  book: Book;
  onPress: () => void;
}

export const BookCard = ({ book, onPress }: Props) => (
  <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
    <Image source={{ uri: book.cover }} style={styles.poster} />
    <Text style={styles.title} numberOfLines={2}>{book.title}</Text>
    <Text style={styles.author}>{book.author}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    width: 130,
    marginRight: 12,
  },
  poster: {
    width: 130,
    height: 195,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 8,
  },
  author: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
