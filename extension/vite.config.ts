// Vite configuration for the Page Pilot Chrome Extension.
// Uses vite-plugin-web-extension to handle MV3 multi-entry builds
// (background service worker + content script) driven by manifest.json.
//
// The widget (React + Tailwind) is bundled directly into the content script
// because the content script imports it. There is no separate popup entry.
// Widget CSS is imported as ?inline so it can be injected into a Shadow DOM
// at runtime — Vite handles the ?inline query natively.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";
import path from "path";

export default defineConfig({
  // Vite copies everything in publicDir to dist/ as-is (no hashing, no processing).
  // This is how icons/icon16.png ends up at dist/icons/icon16.png, which matches
  // the paths declared in manifest.json.
  publicDir: path.resolve(__dirname, "public"),
  plugins: [
    react(),
    webExtension({
      // manifest.json is the single source of truth for all entry points.
      // No popup entry — the widget is mounted by the content script instead.
      manifest: path.resolve(__dirname, "manifest.json"),
      webExtConfig: {
        startUrl: "https://www.google.com",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  css: {
    // Do not inject CSS into the document automatically for content scripts.
    // We import widget CSS with ?inline and inject it into the Shadow DOM manually.
    // This prevents Tailwind styles from leaking into the host page's light DOM.
    modules: {
      scopeBehaviour: "local",
    },
  },
  build: {
    // Output to dist/ — this folder is what you load in chrome://extensions
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV !== "production",
    rollupOptions: {
      output: {
        // Keep asset names predictable so web_accessible_resources: ["assets/*"]
        // in manifest.json correctly covers all built chunks and CSS files.
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
