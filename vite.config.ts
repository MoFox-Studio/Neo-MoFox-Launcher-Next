import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Treat all Material Web components as custom elements.
          isCustomElement: (tag) => tag.startsWith('md-'),
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5199,
    strictPort: true,
  },
});
