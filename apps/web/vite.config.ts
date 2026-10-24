import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Mesmo frontend para o desktop (Tauri) e, depois, para a PWA.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
