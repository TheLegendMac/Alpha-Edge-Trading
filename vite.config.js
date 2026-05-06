import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Relative asset paths so the built site works at any URL depth —
  // including GitHub Pages project URLs like https://user.github.io/repo/.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: true,
  },
});
