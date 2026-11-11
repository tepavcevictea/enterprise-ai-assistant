import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 10_000,
    fileParallelism: false,
    include: ["test/**/*.spec.ts"],
    exclude: ["test/live.spec.ts"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
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
