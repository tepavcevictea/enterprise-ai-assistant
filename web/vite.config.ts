import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const worker = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/messages": { target: worker, timeout: 120_000, proxyTimeout: 120_000 },
      "/session": { target: worker, timeout: 120_000, proxyTimeout: 120_000 },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
