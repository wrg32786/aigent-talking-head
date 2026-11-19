// Builds the Studio page into ../public, which is committed so people who install Studio never run a build.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { astryxStylex } from '@astryxdesign/build/vite';
export default defineConfig({
  plugins: [...astryxStylex(), react()],
  publicDir: 'static',
  base: '/',
  build: {
    outDir: '../public', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1200, reportCompressedSize: false,
    rolldownOptions: { output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' } },
  },
});
