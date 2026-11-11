# Experiment 2 — OpenAI Responses inside Workers

**Result:** PASSED  
**Date:** 2026-11-11  
**Scope:** `openai.responses("gpt-6.1-sol")` through the Vercel AI SDK inside workerd. This is not the assistant, and it does not change any row in `docs/verification.md`.

## Runtime

- Node v22.23.4
- npm 10.9.9
- Workers compatibility date `2026-11-11`
- No compatibility flags. `nodejs_compat` was not added. The SDK calls ran without it.
- Test user agent contains `Cloudflare-Workers`.
- The API key came from the gitignored Worker binding `env.OPENAI_API_KEY` in `.dev.vars`. The calls do not read `process.env`.

## Package versions

Installed with `npm install`. `--legacy-peer-deps` was not used.

| Package | Version |
| --- | --- |
| `ai` | 7.0.169 |
| `@ai-sdk/openai` | 4.0.114 |
| `@ai-sdk/provider` | 4.0.37 |
| `@ai-sdk/provider-utils` | 5.0.79 |
| `zod` | 4.6.7 |
| `wrangler` | 4.160.0 |
| `@cloudflare/vitest-plugin` | 1.7.0 |
| `@cloudflare/workers-types` | 5.20261110.1 |
| `vitest` | 5.1.0 |
| `vite` | 8.3.8 |
| `typescript` | 5.9.3 |

`ai@7.0.169` and `@ai-sdk/openai@4.0.114` depend on the same provider packages. The MCP experiment was not modified.

## Commands

From `experiments/openai-workers`, with Node 22:

```sh
npm install
npx tsc --noEmit
npm test
```

`tsc --noEmit` passed. The accepted Vitest run was **6 passed, 0 skipped**.

## Settings sent

Every `generateText` call uses:

- `openai.responses("gpt-6.1-sol")`
- `providerOptions.openai.reasoningEffort: "low"`
- `providerOptions.openai.store: false`
- `maxRetries: 1`
- no `temperature` and no `topP`

## Test A — native tool call

`calls the native tool and uses its result` passed inside workerd. The user supplied this console output from that run: **202 input tokens**, **32 output tokens**, and about **6.27 seconds**. Those figures were not copied from an independently retained log, and the model call was not run again.

The passing assertions established:

- `lookupFixtureCode` executed once
- the validated input was `{ fixtureId: "desk-lamp" }`
- the tool output was `{ code: "NS-FIXTURE-417" }`
- the final text contained `NS-FIXTURE-417`, which is not in the prompt
- the call took two steps, so the model received the tool result and generated a follow-up
- every recorded request used `POST /v1/responses`
- no request used Chat Completions

## Test B — structured output

`returns schema-valid structured output from the Responses API` passed inside workerd. The user supplied this console output from that run: **57 input tokens**, **17 output tokens**, and about **4.12 seconds**. Those figures were not copied from an independently retained log, and the model call was not run again.

The passing assertions established:

- the output was exactly `{ label: "sol-check", count: 2 }`
- that value passes `labelSchema`
- the call made one request, `POST /v1/responses`
- that request had `store: false`, reasoning effort `low`, no tools, no temperature, and no top-p

A separate local check, without a model, shows the same schema rejects `{ label: "other", count: "no" }`.

## Test C — abort and retry

These calls use a fake fetch. They are not the model result.

**Already aborted.** The SDK enters `fetch` once. The recorded entry was `POST /v1/responses` for `gpt-6.1-sol`, with `store: false`, reasoning effort `low`, no temperature, no top-p, tool name `lookupFixtureCode`, and the AbortSignal already aborted. The stub threw before network I/O. There was no second entry. A workerd `fetch` with an already-aborted signal rejected in under 50ms.

**Retry count.** Two HTTP 503 responses, with `maxRetries: 1`, produced exactly two `POST /v1/responses` entries with the same model and settings. The SDK default of two retries would have made a third attempt. The observed backoff was about 2 seconds.

## Test D

The suite, including both live model calls, executed in the Vitest Workers pool. Strict TypeScript compiled. No compatibility flag was required. The AI SDK packages resolved together without `--legacy-peer-deps`.

## Verdict

PASSED for this experiment. The full-application rows in `docs/verification.md` remain `NOT TESTED`.
