import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Studio server (see @sentinel/server) serves the built assets in production
// and proxies /api + /artifacts during `vite` dev. Default API port is 4300.
const API_TARGET = process.env.SENTINEL_STUDIO_API ?? 'http://localhost:4300';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4301,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/artifacts': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
