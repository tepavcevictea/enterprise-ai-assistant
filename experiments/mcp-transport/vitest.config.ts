import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        workers: [
          {
            name: "mcp-experiment-policy",
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
