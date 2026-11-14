import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "node:path";

// HTTPS is required for WebXR and the microphone on the Quest.
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    rollupOptions: { input: {
        main: resolve("index.html"),
        console: resolve("console.html"),
        watch: resolve("watch.html"),
        community: resolve("community.html"),
      } },
  },
});
