import { defineConfig } from "vitest/config";

export default defineConfig({
  publicDir: "../data",
  server: { port: 5174, strictPort: true },
  test: { environment: "node" },
});
