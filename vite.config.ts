import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, createLogger } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Vite's dev proxy logs a full stack trace whenever a proxied WebSocket is
// torn down mid-write; room STATE broadcasts are frequent, so closing a tab
// or restarting the sync backend almost always lands there. That transport
// noise is benign (clients reconnect), so keep it out of the console.
const viteLogger = createLogger();
const baseLogError = viteLogger.error.bind(viteLogger);
viteLogger.error = (msg, options) => {
  if (
    msg.includes("ws proxy socket error") &&
    /ECONNABORTED|ECONNRESET|EPIPE/i.test(msg)
  ) {
    return;
  }
  baseLogError(msg, options);
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const productionBase = env.VITE_BASE_PATH || "/aura-music/";
  const backendTarget = env.VITE_SYNC_BACKEND || "http://localhost:8000";
  return {
    customLogger: viteLogger,
    base: mode === "production" ? productionBase : "/",
    server: {
      port: 3000,
      host: "0.0.0.0",
      proxy: {
        "/api": backendTarget,
        "/ws": {
          target: backendTarget,
          ws: true,
        },
        "/media": backendTarget,
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        includeAssets: ["pwa-icon.svg"],
        manifest: {
          name: "Aura Music",
          short_name: "Aura Music",
          description: "A polished music player with animated lyrics and immersive visuals.",
          start_url: ".",
          scope: ".",
          display: "standalone",
          background_color: "#00150a",
          theme_color: "#16a34a",
          icons: [
            {
              src: "pwa-icon.svg",
              sizes: "512x512",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
          navigateFallback: "index.html",
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("@react-spring")) return "spring";
            if (id.includes("react") || id.includes("scheduler")) return "react";
            if (
              id.includes("colorthief") ||
              id.includes("jsmediatags") ||
              id.includes("fast-xml-parser")
            ) {
              return "media";
            }
            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
