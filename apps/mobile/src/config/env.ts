type Environment = 'development' | 'production';

export const GOOGLE_CLIENT_ID_IOS = '400446242104-a9laa57dook0og2k93g9amjgieqo2mj7.apps.googleusercontent.com';

// Web client ID — required on Android for GoogleSignin to mint an ID token
// (the token's audience = this ID; the backend trusts it as GOOGLE_CLIENT_ID).
// Without it, Android gets a null idToken and login 401s with "Invalid Google token".
export const GOOGLE_CLIENT_ID_WEB = '400446242104-gvfqp0soikdji99132k59nlh88moucpt.apps.googleusercontent.com';

// No TMDB key here any more (issue #125). Every TMDB call now goes through
// `${API_URL}/api/tmdb/*`, which holds the key server-side, so it is no longer
// extractable from the shipped bundle and can be rotated without a release.
// Don't reintroduce a client key: `services/api.ts` → `tmdbApi` is the only
// way the app should reach TMDB.

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
