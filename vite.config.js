import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Ensures assets are linked relatively so GitHub Pages can find them
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});