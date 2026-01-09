import type { NativeStackScreenProps } from '@react-navigation/native-stack';

// Auth Stack
export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

// Main Stack
export type MainStackParamList = {
  Home: undefined;
  MovieSearch: undefined;
  MovieDetail: { tmdbId: number; title: string };
  WordList: { contentId: number; contentType: 'movie' | 'book'; title: string };
  BookSearch: undefined;
  BookDetail: { bookId: number; title: string };
  SavedWords: undefined;
  Settings: undefined;
};

// Root Stack
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

// Screen props helpers
export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;

export type MainScreenProps<T extends keyof MainStackParamList> = NativeStackScreenProps<
  MainStackParamList,
  T
>;
