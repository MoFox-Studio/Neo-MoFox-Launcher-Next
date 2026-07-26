import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    outDir: 'dist/preload',
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    },
    target: 'node20',
  },
});