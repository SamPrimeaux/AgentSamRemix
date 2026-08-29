import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Self-contained Studio CMS editor bundle.
 * React is inlined so this never races Mac vs CF Builds on shared vendor-react.js.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, '..'),
    },
  },
  css: {
    // globals.css may include @import "tailwindcss" — strip at inject time in main.tsx
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/cms'),
    emptyOutDir: false,
    sourcemap: true,
    minify: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'main.tsx'),
      output: {
        format: 'es',
        entryFileNames: 'studio-cms.js',
        inlineDynamicImports: true,
      },
    },
  },
});
