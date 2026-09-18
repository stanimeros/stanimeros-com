import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  site: 'https://stanimeros.com',
  trailingSlash: 'never',
  server: { port: 4321 },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('@heroicons/react') || id.includes('lucide-react')) {
              // Hero hydrates eagerly (client:load) and only needs these two
              // icons — keep them out of the shared chunk so Hero's critical
              // path doesn't wait on icons used only by deferred islands/pages.
              const heroIcons = ['CubeTransparentIcon', 'PhoneIcon']
              if (heroIcons.some((name) => id.includes(name))) return
              return 'icons'
            }
          },
        },
      },
    },
  },
})
