/// <reference types="@cloudflare/vitest-plugin/types" />

declare namespace Cloudflare {
  interface Env {
    SESSION: DurableObjectNamespace<
      import("../src/session").SessionObject
    >;
  }
}
