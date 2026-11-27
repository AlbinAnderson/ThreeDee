import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = process.env.VTT_SERVER ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  // '/assets' is reserved for user uploads served by the game server.
  build: {
    assetsDir: 'static',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|zustand|immer)[\\/]/ },
            { name: 'vendor-zod', test: /node_modules[\\/]zod[\\/]/ },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'pf1e-shared', test: /packages[\\/]shared[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Listen on the LAN too so friends on your network can test against your dev box.
    host: true,
    proxy: {
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
      '/api': SERVER,
      '/assets': SERVER,
    },
  },
});
