import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png", "icon-source.svg"],
      // A custom service worker (src/sw.ts) is required to handle 'push'/
      // 'notificationclick' for Web Push notifications - the default
      // generateSW strategy only auto-generates precaching, with no way to
      // add custom event listeners.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      manifest: {
        name: "Nisorga",
        short_name: "Nisorga",
        description: "Inbox, Eisenhower-Matrix und Aufgaben für unterwegs.",
        start_url: "/inbox",
        scope: "/",
        display: "standalone",
        theme_color: "#111827",
        background_color: "#f9fafb",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        // Only precache the app shell (JS/CSS/HTML/icons) - real data comes
        // from the API and must not be served stale/offline.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
      },
    }),
  ],
  server: { port: 5173 },
});
