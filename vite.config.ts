import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { visualApi } from './scripts/visual-api'

export default defineConfig({
  server: { proxy: { '/ollama': { target: 'http://127.0.0.1:11434', rewrite: (p) => p.replace(/^\/ollama/, '') } } },
  plugins: [react(), tailwindcss(), visualApi()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
