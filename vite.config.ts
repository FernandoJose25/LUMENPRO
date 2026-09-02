import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tauri espera assets relativos y un puerto fijo para el dev server;
// se deja preconfigurado aunque hoy corramos esto como app web.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
