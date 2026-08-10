import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The analytics API is a separate local process (server/app.py) reading
      // the Clash_Bot SQLite tiers. Proxying keeps the browser on one origin,
      // so the client calls the same /api/analytics/* paths it will call once
      // the service is hosted — migrating is a proxy/base-URL change, not a
      // code change.
      '/api/analytics': {
        target: process.env.CLASH_API_URL || 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
