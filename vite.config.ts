import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so dist/ can be served from any subdirectory.
  base: './',
  server: {
    port: 5120,
  },
  build: {
    // three.js alone is ~560 kB; that's expected.
    chunkSizeWarningLimit: 800,
  },
});
