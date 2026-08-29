import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname) } },
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/agents': { target: 'ws://127.0.0.1:8787', ws: true, changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'index.html'),
        login: path.resolve(__dirname, 'auth/login.html'),
        signup: path.resolve(__dirname, 'auth/signup.html'),
        reset: path.resolve(__dirname, 'auth/reset.html'),
      },
    },
  },
});
