import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "node:path";

// HTTPS is required for WebXR and the microphone on the Quest.
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    // Tunnels for a Quest on another network (cloudflared, ngrok); Vite refuses unknown hosts otherwise.
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  worker: { format: "es" }, // the depth worker is a module worker with code-split imports
  build: {
    rollupOptions: { input: {
        main: resolve("index.html"),
        console: resolve("console.html"),
        watch: resolve("watch.html"),
        theater: resolve("theater.html"),
        community: resolve("community.html"),
      } },
  },
});
