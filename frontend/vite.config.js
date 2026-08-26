import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // host: true binds to 0.0.0.0 so the dev server is reachable from a phone
  // on the same LAN (visiting the machine's IP), not just localhost.
  server: {
    host: true,
  },
})
