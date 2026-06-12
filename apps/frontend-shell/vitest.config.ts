import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    css: false,
    testTimeout: 20000,
    env: {
      VITE_DATACORE_URL: "http://a.test",
      VITE_AGENTCORE_URL: "http://b.test",
      VITE_MOCK: "1",
    },
  },
});
