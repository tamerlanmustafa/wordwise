module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    // The react-native preset stubs image requires but does not list audio,
    // so a required .wav (utils/feedback.ts) would be parsed as JavaScript.
    // Same stub as the images: `require('x.wav')` becomes `{ testUri }`.
    // Merged with the preset's transform, not replacing it.
    '^.+\\.(wav|mp3|m4a|aac|caf)$': require.resolve('react-native/jest/assetFileTransformer.js'),
  },
  moduleNameMapper: {
    // Keep in sync with tsconfig.json paths and metro/vite resolver aliases.
    '^@wordwise/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
};
