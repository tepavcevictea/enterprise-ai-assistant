# Verification

**Status:** S1–S7 have live traces. Deterministic Workers tests cover the password-reset authorization and fencing invariants below.  
**Date:** 2026-11-11  
**Design:** `README.md`

Change a row only after a real run, and point it at the command, trace, or test name that produced the result. A code review is not a pass. A mocked model is enough for the invariant rows. It is not enough for the seven scenario rows.

Evidence is labeled `deterministic` (`npm test`, stub model, real Workers/Durable Object/MCP) or `live` (`npm run test:live`, `gpt-6.1-sol`).

The PDF says to judge traces, not the exact wording of the assistant.

## Real-model scenarios

Run these through the application with `gpt-6.1-sol`. Fixture data is allowed for the fictional policy service and the status tool. The model is not mocked. Export the trace before any session reset.

| Id | Example prompt | Identity | Required trace | Status |
| --- | --- | --- | --- | --- |
| S1 | Ask why the VPN is failing and what to try. | `alex` | Delegation to IT. `skill.loaded` before `getServiceStatus`. The status value is an input to the next step. Reset is absent. | PASSED |
| S2 | Ask what the leave-approval policy says. | `alex` | Delegation to HR. A real tools list, then one allowlisted policy call. Returned document id is a general policy. | PASSED |
| S3 | Ask one VPN question and one unrelated leave question in the same message. | `alex` | One IT task and one HR task with empty `dependsOn`. IT start is before HR completion and HR start is before IT completion. One combined reply, ordered by the user's questions. | PASSED |
| S4 | Ask which equipment profile applies and how to set that equipment up. | `jordan` | HR completes first. IT's task input contains the typed `equipmentProfile` and does not contain the policy body. | PASSED |
| S5 | Ask to reset the signed-in user's password. | `alex` | `permission.denied` on the orchestrator. No IT or HR delegation. Reset schema not offered. Outcome `denied`. | PASSED |
| S6 | Ask the HR specialist to reset the signed-in user's password, and not to use IT. | `jordan` | Plan targets HR only. HR model runs. Reset is absent from HR's offered tools. HR completion returns to the orchestrator. No later IT task. No reset row. Outcome `denied`. | PASSED |
| S7 | Ask a policy question while `MCP_MODE=error`, then repeat with `MCP_MODE=timeout`. | `alex` | HR outcome `unavailable` or `failed`. The reply does not claim the policy was retrieved. A paired independent IT question in the same turn still returns its own result. | PASSED |

Draft prompts above are starting points for the planning experiment. Replace them with the prompts actually sent, in `docs/scenarios.md`, after the runs. Until then they are not observed results.

Record with each scenario: model id, reasoning effort for the plan and for the specialists, `store: false`, the trace location, and the outcome union. Do not record chain-of-thought.

## Engineering invariants

Deterministic tests may stub the model. They still go through the permission module, the scheduler, the Durable Object, or the MCP adapter as the row requires.

| Id | Invariant | What a pass shows | Status |
| --- | --- | --- | --- |
| AUTH-1 | Authorization bypass by prompt | As `alex`, a prompt claiming to be IT Support neither offers nor executes `simulatePasswordReset`. | PASSED |
| AUTH-2 | Direct invocation | Calling the reset execute path with server context `{ user: alex, agent: it }` or `{ user: jordan, agent: hr }` writes no row and returns `denied`. | PASSED |
| AUTH-3 | Tool exposure | The schemas passed into the HR model call do not include reset or service status. The schemas passed into the employee IT call do not include reset. | PASSED |
| AUTH-4 | MCP allowlist | A listed tool outside the allowlist is not passed to the model and cannot be executed. | PASSED |
| AUTH-5 | Document filter | Retired with the third demo role. Both remaining roles read the same general policy fixtures. | REMOVED |
| AUTH-6 | Scenario 5 versus 6 | S5 has no specialist model call. S6 has an HR model call and zero IT calls. | PASSED |
| CONC-1 | One active turn | Two overlapping requests for `jordan` produce one runner and one HTTP 409. | PASSED |
| CONC-2 | Wave overlap | A fixed plan with independent IT and HR tasks starts both before either finishes. A barrier test fails if the runner awaits them in series. | PASSED |
| CONC-3 | Same specialist | Two ready IT tasks do not append the IT history at the same time. An HR task in that wave still overlaps one of them. | NOT TESTED |
| STATE-1 | Stale write | After turn B commits, a write carrying turn A's id appends no history, no trace, and no reset row. | PASSED |
| STATE-2 | Idempotent HTTP retry | The same idempotency key after completion returns the stored response and does not start a second turn. | PASSED |
| STATE-3 | Abandoned turn | A turn older than the budget can be replaced. The abandoned call's later write is ignored. | PASSED |
| STATE-4 | Session reset | Resetting `alex` clears Alex's histories, pending question, and traces, and leaves `jordan` unchanged. | PASSED |
| STATE-5 | User switch | A request as `jordan` cannot read `alex`'s events. The API does not accept a client-supplied object id. | PASSED |
| STATE-6 | History isolation | After S4, the IT history does not contain the policy body. The HR history does not contain IT tool results. | PASSED |
| ORCH-1 | Invalid plan | Duplicate ids, unknown specialists, missing dependency ids, and cycles fail validation. One repair may run. The tasks do not run. | PASSED |
| ORCH-2 | Dependency gate | A predecessor outcome other than `success`, or a success missing `equipmentProfile`, blocks the IT task. | PASSED |
| ORCH-3 | Partial success | One independent failure and one independent success both appear in the turn result. | PASSED |
| ORCH-4 | No substitution | A validated HR-only plan stays HR-only after HR returns `denied`. | PASSED |
| ORCH-5 | Clarification | A write with no target returns `needs_input` and does not insert a reset row. An independent read in that turn still runs. | NOT TESTED |
| MCP-1 | Discovery and call | The trace contains a tools list and a later call of the allowlisted tool over the service binding. | PASSED |
| MCP-2 | Redirect refusal | A 3xx response fails the MCP call. No second request is made, and the identity header is not copied to `Location`. | PASSED |
| MCP-3 | Configured failure | `MCP_MODE=error` surfaces `isError` without a success outcome. `MCP_MODE=timeout` aborts. Client `maxRetries` is 0, so neither is retried into success. | PASSED |
| MCP-4 | Trusted context | A tool argument that names `jordan`, or sets a role or MCP mode, while the server context is `alex` does not change the documents returned. | PASSED |
| SKILL-1 | On-demand load | The initial IT system prompt does not contain the skill body's distinctive sentence. That sentence appears only after `loadSkill`. | PASSED |
| SKILL-2 | Applied procedure | The native status call happens after the load, and the specialist result uses the returned state. | PASSED |
| TOOL-1 | Status validation | An unknown service id is rejected by the tool contract and by `execute`. | PASSED |
| TOOL-2 | Reset idempotency | Two reset executions in one turn for the same target insert one row and return the same simulation record. | PASSED |
| TOOL-3 | Reset fencing | A reset whose turn no longer owns the session inserts nothing. | PASSED |
| INJ-1 | Prompt injection | A policy fixture that says to reset a password causes no reset call and does not place that instruction in the IT history or the user-visible status line. | NOT TESTED |
| OUT-1 | No false success | For `denied`, `unavailable`, and `failed`, the code-rendered status line does not say the operation succeeded. Synthesis has an empty tool set. | PASSED |
| BOUND-1 | Step cap | A specialist that keeps requesting tools stops at four model steps and records `failed` rather than success. | NOT TESTED |

## Not in this catalog

Garak, browser visual tests, load tests, and a comparison against `gpt-6-luna` are outside the assignment. Do not mark them skipped-as-passed. Omit them.

## Evidence map

When a row changes, add one line under it or in `docs/scenarios.md`:

`id — status — command or scenario file — trace or assertion — date`

Until that line exists, the status stays `NOT TESTED`.

S1 — PASSED — live — `npm run test:live`, "loads the VPN troubleshooting skill and then checks the service" — `docs/slice-skill-example.json` — 2026-11-11

S2 — PASSED — live — `npm run test:live`, "asks the HR specialist for the leave approval policy" — `docs/slice-hr-example.json` — 2026-11-11

S3 — PASSED — live — `npm run test:live`, "answers an independent VPN question and a leave question together" — `docs/slice-concurrent-example.json` — 2026-11-11

S4 — PASSED — live — `npm run test:live`, "configures the laptop from the authorized equipment profile" — `docs/slice-dependent-example.json` — 2026-11-11, re-run after entitlement prompt change. Plan is HR→IT with `equipmentProfile=standard-laptop`. Reply names the company profile and does not claim a Jordan-specific entitlement.

S5 — PASSED — live — `npm run test:live`, "denies a password reset for an employee before any specialist runs" — `docs/slice-reset-denied-example.json` — 2026-11-11. Plan action `password_reset` for IT, then orchestrator `permission.denied`. No delegation and no reset row.

S6 — PASSED — live — `npm run test:live`, "asks HR to reset a password and does not call IT" — `docs/slice-named-hr-example.json` — 2026-11-11. `onlySpecialist` is `hr`. HR model runs, `simulatePasswordReset` is denied, and no IT task or reset row is created.

S7 — PASSED — live — `npx vitest run --config vitest.live.config.ts -t "policy service"` — `docs/slice-mcp-error-example.json`, `docs/slice-mcp-timeout-example.json` — 2026-11-11. The prompt asks about VPN status and leave approval. Both plans are independent IT and HR reads. `searchPolicies` returns `policy_failed` and then `policy_timeout`. HR completes `unavailable`. IT still returns the VPN detail. Neither reply contains the leave policy body. `passwordResets` stays empty. The files are the original capture. Their `sessionId` is `taylor`, the demo identity used that day and later removed. Timestamps, tool results, and outcomes were not edited. The current live test sends the same prompt as Alex, who has the same read grants for this scenario.

ORCH-3 — PASSED — live — the same S7 turns record IT `delegation.completed` `success` and HR `delegation.completed` `unavailable` — 2026-11-11

TOOL-3 — PASSED — deterministic — `npm test`, "does not store a password reset after the turn loses ownership or the session is reset" — `test/password.spec.ts` — 2026-11-11. A late `finish` for the abandoned turn returns false. After session reset the same record still inserts nothing, and the next turn has no reset row.

AUTH-1 — PASSED — deterministic — `npm test`, "stops an unauthorized reset in the orchestrator and does not store a row" — `test/password.spec.ts` — 2026-11-11. The message claims IT Support; the signed-in user remains Alex.

AUTH-2 — PASSED — deterministic — `npm test`, "denies a password reset unless the signed-in user and the IT agent both have the capability" — `test/password.spec.ts` — 2026-11-11

AUTH-3 — PASSED — deterministic — `npm test`, `modelToolIds` omits reset for Alex and for HR — `test/password.spec.ts` — 2026-11-11. Live S6 offers `searchPolicies` only.

AUTH-6 — PASSED — live — S5 trace has no specialist call; S6 trace has an HR call and no IT call — `docs/slice-reset-denied-example.json`, `docs/slice-named-hr-example.json` — 2026-11-11

ORCH-4 — PASSED — deterministic — `npm test`, "runs the named HR specialist for a reset, withholds the tool, and does not call IT" — `test/password.spec.ts` — 2026-11-11

TOOL-2 — PASSED — deterministic — `npm test`, two `simulatePasswordReset` calls for one turn return the same record, and the authorized IT turn stores one row — `test/password.spec.ts` — 2026-11-11

AUTH-4 — PASSED — deterministic — `npm test`, "refuses a discovered tool outside the allowlist before calling it" / HR trace `tool.denied:exportAllPolicies` — `test/hr.spec.ts` — 2026-11-11

AUTH-5 — REMOVED — the HR-only offboarding fixture existed for the third demo role. Both remaining roles read the same general fixtures. — 2026-11-12

CONC-1 — PASSED — deterministic — `npm test`, "rejects an overlapping turn and drops a stale write" — `test/slice.spec.ts` — 2026-11-11

CONC-2 — PASSED — deterministic — `npm test`, "starts independent IT and HR work before either specialist finishes" — barrier in `test/orchestration.spec.ts` — 2026-11-11

STATE-1 — PASSED — deterministic — `npm test`, "rejects an overlapping turn and drops a stale write" — abandoned turn writes nothing — `test/slice.spec.ts` — 2026-11-11

STATE-2 — PASSED — deterministic — `npm test`, "replays a completed key and rejects the same key with a different message" — `test/slice.spec.ts` — 2026-11-11

STATE-3 — PASSED — deterministic — `npm test`, "rejects an overlapping turn and drops a stale write" — aged turn replaced, later write ignored — `test/slice.spec.ts` — 2026-11-11

STATE-4 — PASSED — deterministic — `npm test`, "rejects an old idempotency key after session reset"; Alex reset leaves Jordan empty — `test/slice.spec.ts`, `test/hr.spec.ts` — 2026-11-11. Pending-question clearing is not applicable yet.

STATE-5 — PASSED — deterministic — `npm test`, "rejects a client-supplied object id"; Jordan/Alex isolation — `test/slice.spec.ts`, `test/hr.spec.ts` — 2026-11-11

STATE-6 — PASSED — live — S4 histories after entitlement re-run — `docs/slice-dependent-example.json` — 2026-11-11

ORCH-1 — PASSED — deterministic — `npm test`, `test/plan.spec.ts` rejects duplicate/empty ids, unknown specialists, missing deps, cycles, and task-count limits. The live repair call is not covered.

ORCH-2 — PASSED — deterministic — `npm test`, "passes the equipment profile to IT and blocks a missing or failed predecessor" — `test/orchestration.spec.ts` — 2026-11-11

MCP-1 — PASSED — deterministic — `npm test`, "discovers and calls the policy tool through the service binding" — `test/hr.spec.ts` — 2026-11-11

MCP-2 — PASSED — deterministic — `npm test`, "rejects an unexpected redirect and does not retry a failed tool call" — `test/hr.spec.ts` — 2026-11-11

MCP-3 — PASSED — deterministic — `npm test`, MCP `error`/`timeout` become `unavailable` — `test/hr.spec.ts` — 2026-11-11

MCP-4 — PASSED — deterministic — `npm test`, "filters policy text by the server user, not by tool arguments" — `test/hr.spec.ts` — 2026-11-12

SKILL-1 — PASSED — deterministic — `npm test`, "keeps the VPN procedure out of the IT prompt until loadSkill returns it" — `test/skill.spec.ts` — 2026-11-11

SKILL-2 — PASSED — live — `npm run test:live`, "loads the VPN troubleshooting skill and then checks the service" — `docs/slice-skill-example.json` — 2026-11-11

TOOL-1 — PASSED — deterministic — `npm test`, unknown service id is rejected by `runServiceStatus` execute — `test/it-outcome.spec.ts` — 2026-11-11

OUT-1 — PASSED — deterministic — `npm test`, missing key / denied / failed IT replies and MCP `unavailable` do not say the operation succeeded — `test/it-outcome.spec.ts`, `test/hr.spec.ts` — 2026-11-11. Synthesis is unused; the user-facing line is `composeReply`.
