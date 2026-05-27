import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/static/dist/",
  build: {
    outDir: "../src/static/dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/static": "http://localhost:8080",
      "/login": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});
