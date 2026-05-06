import { defineConfig } from 'vite'

export default defineConfig(async () => {
  const { default: pages } = await import('@hono/vite-cloudflare-pages')
  return {
    plugins: [pages()],
    build: { outDir: 'dist' }
  }
})
