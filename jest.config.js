/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/__tests__', '<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx,js,jsx}', '**/tests/**/*.test.{ts,tsx,js,jsx}', '**/src/**/__tests__/**/*.test.{ts,tsx,js,jsx}'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
};

module.exports = config;