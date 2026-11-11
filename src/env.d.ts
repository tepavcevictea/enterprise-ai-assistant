/// <reference types="@cloudflare/vitest-plugin/types" />

declare namespace Cloudflare {
  interface Env {
    SESSION: DurableObjectNamespace<import("./session").SessionObject>;
    OPENAI_API_KEY?: string;
    MODEL_MODE?: string;
  }
}
