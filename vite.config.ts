import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// --mode web: sitio para celular (GitHub Pages) en dist-web/, sin pisar dist/ de Electron.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: "./",
  server: { port: 5183, strictPort: true },
  build: mode === "web" ? { outDir: "dist-web" } : undefined,
}));
