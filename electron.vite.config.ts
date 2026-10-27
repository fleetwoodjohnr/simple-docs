import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const alias = { '@': resolve(__dirname, 'src') }

// Strict CSP for the packaged renderer (file:// pages get no response headers, so it is a meta tag).
// Not applied in dev, where Vite injects an inline HMR preamble. Inline styles are needed by ProseMirror.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ')
const csp = { name: 'csp', apply: 'build' as const, transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`) }

export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss(), csp],
    build: { chunkSizeWarningLimit: 4000 }
  }
})
