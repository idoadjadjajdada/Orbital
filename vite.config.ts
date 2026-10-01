/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so the build works from a GitHub Pages project path or a file share.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'] },
});
