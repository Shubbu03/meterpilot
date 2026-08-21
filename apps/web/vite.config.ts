import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(moduleId) {
          if (moduleId.includes("@phosphor-icons")) return "icons-vendor";
          if (moduleId.includes("@tanstack") || moduleId.includes("/zod/")) {
            return "data-vendor";
          }
          if (
            moduleId.includes("/react/") ||
            moduleId.includes("/react-dom/") ||
            moduleId.includes("/react-router/")
          ) {
            return "react-vendor";
          }
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
});
