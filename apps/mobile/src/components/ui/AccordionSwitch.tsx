import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity, View } from 'react-native';
import { colors } from '../../theme/palette';

interface Props {
  value: boolean;
  onToggle: () => void;
}

export const AccordionSwitch = ({ value, onToggle }: Props) => {
  const translate = useRef(new Animated.Value(value ? 16 : 0)).current;
  useEffect(() => {
    Animated.timing(translate, {
      toValue: value ? 16 : 0,
      duration: 80,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [value, translate]);
  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.8}>
      <View style={[styles.track, value && styles.trackOn]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX: translate }] }]} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  track: {
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#D4D2CC',
    padding: 2,
    justifyContent: 'center',
  },
  trackOn: {
    backgroundColor: colors.primary,
  },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignSelf: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1.5,
    elevation: 2,
  },
});
