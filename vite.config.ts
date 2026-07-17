import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config used both for `vite build` (production client bundle)
// and by server.ts, which creates a Vite dev server in middleware mode.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
