module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // Keep in sync with tsconfig.json paths and metro/vite resolver aliases.
    '^@wordwise/types$': '<rootDir>/../../packages/types/src/index.ts',
    // Metro turns an asset `require` into an opaque numeric handle; jest would
    // try to parse the file as JavaScript. The stub stands in for any binary
    // asset, which is all a test can meaningfully assert about one anyway.
    '\\.(wav|mp3|m4a|png|jpg|jpeg|gif|svg|ttf|otf)$': '<rootDir>/__mocks__/assetStub.js',
  },
};
