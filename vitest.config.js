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
          // Valores ficticios: CI no tiene .env y los tests nunca deben llegar a un
          // Supabase real, aunque el desarrollador tenga uno configurado en local.
          env: {
            VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
            VITE_SUPABASE_ANON_KEY: 'test-anon-key',
          },
        },
      },
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/outputs/**'],
  },
})
