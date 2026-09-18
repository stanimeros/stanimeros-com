import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Same port as the main site's dev server (astro.config.mjs) -- they're
  // never run at once, so one fixed, memorable port for both beats Vite's
  // default 5173. `strictPort` so a stale process squatting on it fails
  // loud instead of silently handing you a different port than you typed.
  server: {
    port: 4321,
    strictPort: true,
  },
})
