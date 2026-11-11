/// <reference types="@cloudflare/vitest-plugin/types" />

declare namespace Cloudflare {
  interface Env {
    SESSION: DurableObjectNamespace<import("./session").SessionObject>;
    POLICY: Fetcher;
    OPENAI_API_KEY?: string;
    MODEL_MODE?: string;
    MCP_MODE?: string;
  }
}
