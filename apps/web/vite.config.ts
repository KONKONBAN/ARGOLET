import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` makes the build work from any static host or sub-path (GitHub Pages, CDN, file share).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: process.env.ARGOLET_API ? { '/v1': { target: process.env.ARGOLET_API, changeOrigin: true } } : undefined,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    testTimeout: 30000,
    setupFiles: ['test/setup.ts'],
  },
});
