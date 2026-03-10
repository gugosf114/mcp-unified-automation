/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Strip .js extensions from imports so ts-jest resolves .ts files
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.json',
        diagnostics: { ignoreDiagnostics: [151002, 1343] },
      },
    ],
  },
  testMatch: ['**/tests/**/*.test.ts'],
  // Ignore dist and node_modules
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
