export default {
  test: {
    environment: 'node',
    testTimeout: 15_000,
    include: ['server/lib/__tests__/**/*.test.js', 'server/handlers/__tests__/*.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
}
