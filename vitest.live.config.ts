import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000,
    include: ["test/live.spec.ts"],
    exclude: ["**/node_modules/**"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        workers: [
          {
            name: "tx-services-policy",
            modules: true,
            scriptPath: "./dist/policy/index.js",
            compatibilityDate: "2026-11-11",
            compatibilityFlags: ["nodejs_compat"],
            bindings: { MCP_MODE: "ok" },
          },
        ],
      },
    }),
  ],
});
