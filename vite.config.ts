import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: Number(process.env.XNOTE_WEB_PORT || 5173),
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.XNOTE_API_PORT || 4318}`,
        headers: { "x-xnote-token": process.env.XNOTE_API_TOKEN || "" },
      },
    },
  },
  build: { chunkSizeWarningLimit: 800 },
});
