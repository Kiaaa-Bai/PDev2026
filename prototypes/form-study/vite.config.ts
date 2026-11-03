import { defineConfig } from "vitest/config";

export default defineConfig({
  // The dev server serves prototypes/data so the browser page can fetch its sample and day files.
  // A build copies none of it: the app keeps each Mac's own data in its app data folder.
  publicDir: "../data",
  server: { port: 5174, strictPort: true },
  build: { copyPublicDir: false, rollupOptions: { input: { main: "index.html", window: "window.html" } } },
  test: { environment: "node" },
});
