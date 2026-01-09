import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainStackParamList } from './types';
import { MovieSearchScreen } from '../features/movies/screens/MovieSearchScreen';
import { WordListScreen } from '../features/vocabulary/screens/WordListScreen';

const Stack = createNativeStackNavigator<MainStackParamList>();

export const MainNavigator = () => (
  <Stack.Navigator
    screenOptions={{
      headerStyle: { backgroundColor: '#fff' },
      headerShadowVisible: false,
      headerTitleStyle: { fontWeight: '600' },
    }}
  >
    <Stack.Screen
      name="MovieSearch"
      component={MovieSearchScreen}
      options={{ title: 'Search Movies' }}
    />
    <Stack.Screen
      name="WordList"
      component={WordListScreen}
      options={({ route }) => ({ title: route.params.title })}
    />
  </Stack.Navigator>
);
