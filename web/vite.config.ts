import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { browserValidation } from './scripts/browser-validation.js';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [browserValidation(), react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api/v2': { target: 'http://127.0.0.1:4311', changeOrigin: false } } },
  build: { outDir: 'dist', emptyOutDir: true },
});
