import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

const apiTarget = `http://localhost:${process.env.VITE_API_PORT || '8000'}`;

export default defineConfig({
  plugins: [solidPlugin()],
  // Ship source maps so dev tools show original, un-minified source.
  build: {
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: ['@arminmajerie/dockview-solid'],
  },
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        ws: true,
      },
    },
  },
});
