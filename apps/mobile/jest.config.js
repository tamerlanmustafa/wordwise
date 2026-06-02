module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // Keep in sync with tsconfig.json paths and metro/vite resolver aliases.
    '^@wordwise/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
};
