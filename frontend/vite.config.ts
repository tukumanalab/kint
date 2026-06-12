import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Google Identity Services の redirect モード用ミドルウェア。
 * Google が form_post で POST してきた credential を sessionStorage に保存して
 * SPA のルートへ GET リダイレクトする。
 */
function googleOAuthCallbackPlugin(): Plugin {
  return {
    name: 'google-oauth-callback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || req.url !== '/') {
          return next()
        }
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          const params = new URLSearchParams(body)
          const credential = params.get('credential')
          if (!credential) return next()
          // credential を sessionStorage に保存してから GET / へリダイレクト
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><script>
sessionStorage.setItem('google_credential',${JSON.stringify(credential)});
window.location.href='/';
</script></head><body>Redirecting...</body></html>`
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(html)
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/kint/',
  plugins: [react(), googleOAuthCallbackPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
