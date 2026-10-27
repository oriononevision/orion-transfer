import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Ports : site 5173, CORE 5174, TRANSFER 5175.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
  },
})
