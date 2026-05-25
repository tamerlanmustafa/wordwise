type Environment = 'development' | 'production';

export const GOOGLE_CLIENT_ID_IOS = '400446242104-a9laa57dook0og2k93g9amjgieqo2mj7.apps.googleusercontent.com';

const configs = {
  development: {
    API_URL: 'http://localhost:8000',
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
