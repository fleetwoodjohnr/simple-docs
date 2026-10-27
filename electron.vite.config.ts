import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const alias = { '@': resolve(__dirname, 'src') }

export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: { chunkSizeWarningLimit: 4000 }
  }
})
