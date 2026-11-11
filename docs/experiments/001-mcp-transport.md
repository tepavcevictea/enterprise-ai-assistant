# Experiment 1 — MCP service binding

**Result:** PASSED  
**Date:** 2026-11-11  
**Scope:** A Worker calling `createMcpHandler` on an auxiliary Worker through a private service binding. This is not the assistant, and it does not change any row in `docs/verification.md`.

## Runtime

- Node v22.23.4
- npm 10.9.9
- The default shell Node, v20, cannot load these packages. The test command used Node 22 on `PATH`.

## Package versions

Direct:

| Package | Version |
| --- | --- |
| `@ai-sdk/mcp` | 2.0.96 |
| `@modelcontextprotocol/server` | 2.4.0 |
| `agents` | 0.33.0 |
| `zod` | 4.6.7 |
| `@cloudflare/vitest-plugin` | 1.7.0 |
| `@cloudflare/workers-types` | 5.20261110.1 |
| `esbuild` | 0.28.2 |
| `typescript` | 5.9.3 |
| `vite` | 8.3.8 |
| `vitest` | 5.1.0 |
| `wrangler` | 4.160.0 |

Transitive SDK packages pulled by `@ai-sdk/mcp`:

- `@ai-sdk/provider` 4.0.37
- `@ai-sdk/provider-utils` 5.0.79

`npm install` needed `--legacy-peer-deps`. npm 10 crashed while resolving the optional peer set declared by `agents`. Vite is present because Vitest 5.1 requires it. The `ai` package is not installed; this experiment does not call a model.

## What ran

Project: `experiments/mcp-transport`.

Final command, from that directory, with Node 22:

```sh
npm test
```

That bundles `policy/src/index.ts` and runs Vitest in the Cloudflare Workers pool. Final result: **7 passed, 0 failed**, 1.73s.

The same suite had already failed once, before the Host header was set, with:

```text
MCP HTTP Transport Error: POSTing to endpoint (HTTP 403):
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Missing Host header"},"id":null}
```

After the adapter set `Host: policy.local`, the suite passed. Typecheck with `tsc --noEmit` passed.

## Protocol exchanges

One successful `searchPolicies` call made exactly these requests, all to `https://policy.local/mcp`, all HTTP 200:

1. `POST` `server/discover`
2. `POST` `tools/list`
3. `POST` `tools/call`

Each request arrived at the adapter with `redirect: "error"`. The adapter sent `redirect: "manual"`. There was no GET and no reconnect loop. `tools/list` returned `searchPolicies` and `exportAllPolicies`.

The installed client's `protocolVersionDiscovery` defaults to `true`, so `server/discover` is a real negotiation request from `@ai-sdk/mcp@2.0.96`. The handler accepted it. No separate `initialize` request was sent.

## Checks

**Real MCP.** The auxiliary worker's fetch handler calls `createMcpHandler`. The test worker reaches it only through the `POLICY` service binding. Discovery and invocation are `listTools` and `callTool` on `createMCPClient`. They are not a direct function call into the policy module.

**Authorization.** The adapter sets `x-northstar-user` from the caller identity. The policy worker maps that header to alex, jordan, or taylor and passes the role through `authContext`. The tool reads `getMcpAuthContext()`. The published input schema has one property, `query`.

- Alex searching for leave received the fictional leave policy and neither the restricted title nor `NS-OFFBOARD-8841`.
- Alex searching for offboarding, while the tool arguments also named `userId: "taylor"`, `role: "hr_operations"`, and `mode: "ok"`, received `[]`.
- Jordan searching for offboarding received `[]`.
- Taylor searching for offboarding received the restricted title and `NS-OFFBOARD-8841`.

**Allowlist.** `exportAllPolicies` is discovered. The client throws `refusing tool outside the policy allowlist` before sending `tools/call` for it. The discovery trace contains no `tools/call`.

**Redirects.** A fetch to any URL other than `https://policy.local/mcp` throws `unpinned-destination` before the binding is called. A synthetic `302` to `https://evil.example/mcp` produces one request, with `redirect: "manual"` and the trusted user `alex`. The adapter throws `redirect` and does not request the Location. A direct `env.POLICY.fetch` with `redirect: "error"` throws `TypeError`. The successful MCP calls do not.

**Failures.**

- Policy mode `error` returns MCP `isError: true` and the text `policy service failed`. The leave policy is absent. There is one `tools/call`.
- A `503` injected on the first `tools/call`, with `maxRetries: 0`, fails as `MCP HTTP Transport Error: POSTing to endpoint (HTTP 503): unavailable`. The wrapper saw one `tools/call`, so the client did not retry into the real handler.
- Timeout mode plus `AbortSignal.timeout(200)` fails as `Request was aborted` in about 200ms. The error does not contain the restricted title or badge.

## Deviations

- The service binding did not send a Host header. The handler answered 403 until the adapter set `Host` to the pinned hostname `policy.local`, which is also the handler's `allowedHostnames` entry.
- The installed client sends `server/discover` before `tools/list`. The feasibility plan described one list POST and one call POST. The extra POST is the client's own negotiation, and the call still completes without a GET loop.
- Failure mode is selected by `x-northstar-mcp-mode`, set only by the adapter. `MCP_MODE=ok` remains the worker variable. One shared workerd process cannot change that variable per test. Tool arguments named `mode` are not read.
- Wrangler 4.160 `deploy --dry-run --outdir` writes a README and does not leave the worker module. `--outfile` writes a multipart form body. The test bundle is produced with esbuild 0.28.2, conditions `workerd`, `worker`, and `browser`, and `node:` imports left external for `nodejs_compat`.
- The adapter rejects its own `AbortSignal` once aborted, so a response that arrives later is not returned as success.

## Still unverified

- No scenario in `docs/verification.md` has run through the assistant. Those rows stay `NOT TESTED`.
- This used local workerd. It does not prove a deployed Cloudflare account, Access, or a public route.
- The demo header is the trusted test identity. It is not production authentication.
- The mode header is safe only because this worker is reached through the binding. Another entry point could spoof it.
- The 302 was injected in front of the binding. The real handler did not emit a redirect during the successful calls.
- `tools()` was not executed, because there is no model call. `listTools` and `callTool` are the client methods that performed discovery and invocation.
