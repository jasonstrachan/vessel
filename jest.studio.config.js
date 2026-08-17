const { realpathSync } = require('node:fs');
const path = require('node:path');

const base = require('./jest.config');
const extensionRoot = realpathSync('.vessel-studio/extension');

module.exports = {
  ...base,
  roots: [extensionRoot],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  moduleDirectories: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
};
