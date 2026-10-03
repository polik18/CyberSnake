import { defineConfig } from 'vite';

// Supports both root deployment and GitHub Pages /CyberSnake/ subpath.
export default defineConfig({
  base: './',
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
    open: false,
  },
});
