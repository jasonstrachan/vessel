/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/__tests__', '<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx,js,jsx}', '**/tests/**/*.test.{ts,tsx,js,jsx}', '**/src/**/__tests__/**/*.test.{ts,tsx,js,jsx}'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/workers/colorCycleFillClient$': '<rootDir>/__mocks__/colorCycleFillClient.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
  silent: false,
};

module.exports = config;
