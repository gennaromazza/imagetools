import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
export default defineConfig({ base: "./", define: { __APP_VERSION__: JSON.stringify(version) }, plugins: [react()], build: { outDir: ".output/web", emptyOutDir: true }, server: { port: 4265, host: "127.0.0.1" } });
