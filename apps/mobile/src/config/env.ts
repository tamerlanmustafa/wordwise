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

// Google OAuth Client IDs
export const GOOGLE_CLIENT_ID_WEB = '400446242104-gvfqp0soikdji99132k59nlh88moucpt.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID_IOS = '400446242104-a9laa57dook0og2k93g9amjgieqo2mj7.apps.googleusercontent.com';
// For backwards compatibility
export const GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID_WEB;

const configs = {
  development: {
    API_URL: 'http://localhost:8000', // localhost works for iOS simulator
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
