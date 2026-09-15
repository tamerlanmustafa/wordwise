import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served at the root of getwordwise.us (a GitHub Pages custom domain). It
  // was the project path /wordwise/ while the site lived on github.io (issue
  // #85); the app stores need the privacy, terms and account-deletion pages on
  // the app's own domain.
  base: '/',
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