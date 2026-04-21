import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../../theme/palette';

export const LoadingScreen = () => (
  <View style={styles.root}>
    <Text style={styles.logo}>WordWise</Text>
    <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 8,
  },
  spinner: {
    marginTop: 20,
  },
});
