import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Keep Vercel commit and repository metadata out of the client environment.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('VITE_VERCEL_')) delete process.env[key]
}

export default defineConfig({
  plugins: [react()],
})
