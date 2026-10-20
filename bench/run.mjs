import { build } from 'vite';
import { fileURLToPath } from 'node:url';
// Bundle bench/frames.ts the way the app is built, then run it.
const dir = fileURLToPath(new URL('.', import.meta.url));
await build({ configFile: false, logLevel: 'warn', build: { outDir: dir + 'dist', emptyOutDir: true, minify: false,
  lib: { entry: dir + 'frames.ts', formats: ['es'], fileName: 'frames' } } });
await import(dir + 'dist/frames.js');
