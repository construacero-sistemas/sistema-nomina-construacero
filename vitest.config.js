import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // A bounded worker thread avoids recurring Windows child-process startup
    // timeouts. Keep per-file isolation and the same execution mode in CI.
    pool: 'threads',
    isolate: true,
    maxWorkers: 1,
    testTimeout: 15_000,
    projects: [
      {
        test: {
          name: 'server',
          pool: 'threads',
          isolate: true,
          environment: 'node',
          testTimeout: 15_000,
          include: [
            'server/lib/__tests__/**/*.test.js',
            'server/handlers/__tests__/**/*.test.js',
          ],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'client',
          pool: 'threads',
          isolate: true,
          environment: 'jsdom',
          testTimeout: 15_000,
          include: ['src/**/*.test.{js,jsx}', 'compat/**/*.test.{js,jsx}'],
          setupFiles: ['src/test/setup.js'],
        },
      },
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/outputs/**'],
  },
})
