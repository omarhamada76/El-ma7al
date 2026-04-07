import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    ...(mode === 'development'
      ? {
          proxy: {
            '/api': {
              target: 'http://localhost:3001',
              changeOrigin: true,
            },
          },
        }
      : {}),
  },
  define:
    mode === 'production'
      ? { 'import.meta.env.VITE_API_ORIGIN': JSON.stringify('') }
      : {},
}))
