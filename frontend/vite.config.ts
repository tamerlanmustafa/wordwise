import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the project site under /wordwise/ (issue #85)
  base: '/wordwise/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@wordwise/types': path.resolve(__dirname, '../packages/types/src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})