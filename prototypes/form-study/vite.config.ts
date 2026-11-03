import { defineConfig } from "vitest/config";

export default defineConfig({
  publicDir: "../data",
  server: { port: 5174, strictPort: true },
  build: { rollupOptions: { input: { main: "index.html", window: "window.html", spike: "spike.html" } } },
  test: { environment: "node" },
});
