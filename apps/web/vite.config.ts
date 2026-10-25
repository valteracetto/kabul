import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Mesmo frontend para o desktop (Tauri) e, depois, para a PWA.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __KABUL_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
