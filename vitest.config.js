import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    testTimeout: 15_000,
    include: [
      'server/lib/__tests__/**/*.test.js',
      'server/handlers/__tests__/*.test.js',
      'src/**/__tests__/**/*.test.jsx',
      'compat/**/__tests__/**/*.test.jsx',
    ],
    // 组件测试跑 jsdom，server 测试保持 node（environmentMatchGlobs 优先于 environment）
    environmentMatchGlobs: [
      ['src/**/__tests__/**/*.test.jsx', 'jsdom'],
      ['compat/**/__tests__/**/*.test.jsx', 'jsdom'],
    ],
    setupFiles: ['src/test/setup.js'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
})
