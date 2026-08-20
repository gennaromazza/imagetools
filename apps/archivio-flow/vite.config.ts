import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: ".output/web",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 4175,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3003",
    },
  },
});
