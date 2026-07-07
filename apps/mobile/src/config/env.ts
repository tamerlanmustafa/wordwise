type Environment = 'development' | 'production';

export const GOOGLE_CLIENT_ID_IOS = '400446242104-a9laa57dook0og2k93g9amjgieqo2mj7.apps.googleusercontent.com';

// TMDB key — single source of truth (was hard-coded in 4 separate files; UX
// audit F-037). NOTE: as a client key it's still shipped in the bundle. Fully
// securing it needs a backend proxy for TMDB calls (ops follow-up) + key
// rotation; centralizing it here is the prerequisite (one place to change).
// (Deliberately a plain literal, not `process.env.EXPO_PUBLIC_*`: that form
// makes babel-preset-expo pull in `expo/virtual/env`, which breaks Jest.)
export const TMDB_API_KEY = '1870027496e94e64c86a36fbcb709320';

const configs = {
  development: {
    API_URL: 'http://localhost:8000',
    DEBUG: true,
  },
  production: {
    API_URL: 'https://api.getwordwise.us',
    DEBUG: false,
  },
} as const;

// @ts-ignore - __DEV__ is defined by React Native
const env: Environment = (__DEV__ ? 'development' : 'production') as Environment;

export const config = configs[env];
