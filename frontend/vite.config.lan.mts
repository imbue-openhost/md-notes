// LAN-testing config: listens on all interfaces and injects the OpenHost
// owner header so the local backend accepts requests. Local testing only —
// do not expose beyond a trusted network.
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

const apiTarget = `http://localhost:${process.env.VITE_API_PORT || '8000'}`;

export default defineConfig({
  plugins: [solidPlugin()],
  optimizeDeps: {
    exclude: ['@arminmajerie/dockview-solid'],
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: apiTarget,
        ws: true,
        headers: { 'x-openhost-is-owner': 'true' },
      },
    },
  },
});
