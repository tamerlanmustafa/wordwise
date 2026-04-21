import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../theme/palette';

interface Props {
  level: string;
  label: string;
  count: number;
  active: boolean;
  color: string;
  onPress: () => void;
}

export const CEFRTab = ({ level, active, color, onPress }: Props) => {
  const isIdioms = level === 'IDIOMS';
  const displayColor = isIdioms ? colors.warning : color;

  return (
    <TouchableOpacity
      style={[
        styles.tab,
        active && { backgroundColor: `${displayColor}20` },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {isIdioms ? (
        <View style={styles.idiomContent}>
          <Text
            style={[
              styles.idiomText,
              active && { color: displayColor },
              !active && styles.inactive,
            ]}
          >
            Idioms
          </Text>
        </View>
      ) : (
        <Text
          style={[
            styles.level,
            active && { color: displayColor },
            !active && styles.inactive,
          ]}
        >
          {level}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  tab: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 10,
    marginHorizontal: 1,
    borderRadius: 10,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  level: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  inactive: {
    opacity: 0.5,
  },
  idiomContent: {
    alignItems: 'center',
  },
  idiomText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
});
