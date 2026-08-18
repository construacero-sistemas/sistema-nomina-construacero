export default {
  test: {
    environment: 'node',
    testTimeout: 15_000,
    include: ['api/lib/__tests__/**/*.test.js', 'api/handlers/__tests__/nomina.*.test.js', 'api/handlers/__tests__/worker.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
}
