# Experiment 3 — Durable Object turn coordination

**Result:** PASSED  
**Date:** 2026-11-11  
**Scope:** One SQLite Durable Object per demo user, exercised in the Workers Vitest pool. This is not the assistant, and it does not change any row in `docs/verification.md`.

## Runtime

- Node v22.23.4
- npm 10.9.9
- Workers compatibility date `2026-11-11`
- No compatibility flags
- SQLite class `SessionObject`, reached with `env.SESSION.getByName(userId)`
- `blockConcurrencyWhile` runs only in the constructor, for schema setup
- Turn changes use `transactionSync` and synchronous `sql.exec`
- The experiment turn budget is 1,000 ms. Tests pass `now`; they do not sleep to create the race

## Package versions

Installed with `npm install`. `--legacy-peer-deps` was not used.

| Package | Version |
| --- | --- |
| `wrangler` | 4.160.0 |
| `@cloudflare/vitest-plugin` | 1.7.0 |
| `@cloudflare/workers-types` | 5.20261110.1 |
| `vitest` | 5.1.0 |
| `vite` | 8.3.8 |
| `typescript` | 5.9.3 |

## Commands

From `experiments/turn-coordination`, with Node 22:

```sh
npm install
npx tsc --noEmit
npm test
```

`tsc --noEmit` passed after the import fix below. The first Vitest run was **7 passed, 0 failed**, in 997ms. After the session-generation change, `tsc --noEmit` passed again and Vitest reported **8 passed, 0 failed**, in 997ms.

## Tests

| Test | Result |
| --- | --- |
| reserves one turn and rejects the overlapping request with 409 | passed |
| replays a completed key and rejects the same key with a different payload | passed |
| keeps one simulated reset row for two executions in the same turn | passed |
| drops history, traces, and resets from a replaced turn | passed |
| clears alex without changing jordan or taylor, and ignores the in-flight result | passed |
| keeps orchestrator, IT, and HR histories separate | passed |
| rejects a client-supplied object id | passed |
| rejects an old idempotency key after session reset | passed |

## What the passing tests showed

**Reservation.** Jordan's first request commits `jordan-a` before it waits. A second request, sent while that wait is still open, returns HTTP 409 `{ error: "turn_active" }` without waiting for the first request to finish. The stored history contains only the first turn's row. The object name read back from storage is `jordan`.

**Idempotency.** Replaying `alex-idem-key` with the same request hash returns `{ replay: true, response: { turnId: "alex-idem", marker: "stored-response-alpha" } }`. `operationRuns` does not increase, and the extra history body is not stored. The same key with a different hash returns HTTP 409 `{ error: "idempotency_mismatch" }` and does not include the stored marker.

**Simulated reset.** Two overlapping `simulate-reset` calls for Jordan and turn `jordan-reset` return the same row. The resets table contains that one row. No external password service is called.

**Stale turn.** Alex's first turn is held at `now = 0`. A second turn at `now = 1000` replaces it and records `abandonedTurn` as `alex-old`. The old turn's later history, trace, and reset insert are rejected. The snapshot keeps the replacement IT history and has no stale trace or reset row.

**Session reset.** Alex's histories, traces, pending question, and active turn are cleared. An in-flight turn released after that reset gets HTTP 409 and does not write `repopulated after reset`. Jordan still has `jordan kept` and the pending question. Taylor still has `taylor kept`.

**Previous session generation.** Reset increments `session_generation`. Retrying the completed key, with the same or a different hash, returns HTTP 409 `{ error: "stale_session" }`. The body does not contain `old-session-marker` or `old conversation`. `operationRuns` stays unchanged, the history stays empty, and the existing simulated-reset audit row is not duplicated. A new key in the new generation writes only `new conversation`. A replay inside the same generation still returns the stored response.

**Histories.** One Taylor turn writes orchestrator, IT, and HR rows. A later HR-only turn adds a second HR row and leaves the IT row unchanged.

**Object id.** `POST /session` with `objectId` returns HTTP 400 `{ error: "object_id_rejected" }` before `getByName`.

## Bug fixed before the run

The first typecheck failed because the global `DurableObject` name in `@cloudflare/workers-types` is an interface, not a class. `SessionObject` now extends `DurableObject` imported from `cloudflare:workers`, which provides `ctx`. No coordination test failed after that change.

## Limitations

- The caller supplies `now`. Production code still needs to pass the current time into the same reservation function. This run does not measure a 90-second budget.
- Session reset keeps simulated-reset rows as audit records and keeps the idempotency row so the old key cannot run again. It does not return that row's stored response after the generation changes.
- These rows in `docs/verification.md` stay `NOT TESTED`: the experiment is not the orchestrator, the specialist models, or the seven application scenarios.
- The run is local workerd, not a deployed Durable Object.

## Verdict

PASSED for this experiment.
