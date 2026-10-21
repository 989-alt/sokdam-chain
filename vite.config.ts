import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves under /<repo>/; set VITE_BASE at build time.
  base: loadEnv(mode, '.', '').VITE_BASE || '/',
  plugins: [preact()],
}));
