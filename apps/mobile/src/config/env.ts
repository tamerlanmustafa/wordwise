import AsyncStorage from '@react-native-async-storage/async-storage';

// Simple storage wrapper (can be replaced with MMKV for production)
export const storage = {
  getString: (key: string): string | null => {
    // Sync method not available with AsyncStorage, return null
    // Use getStringAsync for actual usage
    return null;
  },
  getStringAsync: async (key: string): Promise<string | null> => {
    return await AsyncStorage.getItem(key);
  },
  set: (key: string, value: string): void => {
    AsyncStorage.setItem(key, value);
  },
  delete: (key: string): void => {
    AsyncStorage.removeItem(key);
  },
};

type Environment = 'development' | 'staging' | 'production';

const configs = {
  development: {
    API_URL: 'http://10.0.2.2:8000', // Android emulator localhost
    DEBUG: true,
  },
  staging: {
    API_URL: 'https://staging-api.wordwise.app',
    DEBUG: true,
  },
  production: {
    API_URL: 'https://api.wordwise.app',
    DEBUG: false,
  },
} as const;

// @ts-ignore - __DEV__ is defined by React Native
const env: Environment = (__DEV__ ? 'development' : 'production') as Environment;

export const config = configs[env];
export const isDev = env === 'development';
