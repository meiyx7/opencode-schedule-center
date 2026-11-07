import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  root: import.meta.dirname,
  plugins: [solid()],
  server: { port: 8774, strictPort: true },
})
