import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/main/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    outDir: 'dist/main',
    rollupOptions: {
      external: [
        'electron',
        'extract-zip',
        'node-pty',
        'tree-kill',
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ],
    },
    target: 'node20',
  },
});