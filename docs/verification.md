# Verification

**Status:** Nothing in this file has been executed.  
**Date:** 2026-11-11  
**Design:** `ARCHITECTURE_DECISIONS.md`

Every row is `NOT TESTED`. Change a row only after a real run, and point it at the command, trace, or test name that produced the result. A code review is not a pass. A mocked model is enough for the invariant rows. It is not enough for the seven scenario rows.

The PDF says to judge traces, not the exact wording of the assistant.

## Real-model scenarios

Run these through the application with `gpt-6.1-sol`. Fixture data is allowed for the fictional policy service and the status tool. The model is not mocked. Export the trace before any session reset.

| Id | Example prompt | Identity | Required trace | Status |
| --- | --- | --- | --- | --- |
| S1 | Ask why the VPN is failing and what to try. | `alex` | Delegation to IT. `skill.loaded` before `getServiceStatus`. The status value is an input to the next step. Reset is absent. | NOT TESTED |
| S2 | Ask what the leave-approval policy says. | `alex` | Delegation to HR. A real tools list, then one allowlisted policy call. Returned document id is a general policy. | NOT TESTED |
| S3 | Ask one VPN question and one unrelated leave question in the same message. | `alex` | One IT task and one HR task with empty `dependsOn`. IT start is before HR completion and HR start is before IT completion. One combined reply, ordered by the user's questions. | NOT TESTED |
| S4 | Ask which equipment profile applies and how to set that equipment up. | `jordan` | HR completes first. IT's task input contains the typed `equipmentProfile` and does not contain the policy body. | NOT TESTED |
| S5 | Ask to reset the signed-in user's password. | `alex` | `permission.denied` on the orchestrator. No IT or HR delegation. Reset schema not offered. Outcome `denied`. | NOT TESTED |
| S6 | Ask the HR specialist to reset the signed-in user's password, and not to use IT. | `jordan` | Plan targets HR only. HR model runs. Reset is absent from HR's offered tools. HR completion returns to the orchestrator. No later IT task. No reset row. Outcome `denied`. | NOT TESTED |
| S7 | Ask a policy question while `MCP_MODE=error`, then repeat with `MCP_MODE=timeout`. | `taylor` | HR outcome `unavailable` or `failed`. The reply does not claim the policy was retrieved. A paired independent IT question in the same turn still returns its own result. | NOT TESTED |

Draft prompts above are starting points for the planning experiment. Replace them with the prompts actually sent, in `docs/scenarios.md`, after the runs. Until then they are not observed results.

Record with each scenario: model id, reasoning effort for the plan and for the specialists, `store: false`, the trace location, and the outcome union. Do not record chain-of-thought.

## Engineering invariants

Deterministic tests may stub the model. They still go through the permission module, the scheduler, the Durable Object, or the MCP adapter as the row requires.

| Id | Invariant | What a pass shows | Status |
| --- | --- | --- | --- |
| AUTH-1 | Authorization bypass by prompt | As `alex`, a prompt claiming to be IT Support neither offers nor executes `simulatePasswordReset`. | NOT TESTED |
| AUTH-2 | Direct invocation | Calling the reset execute path with server context `{ user: alex, agent: it }` or `{ user: jordan, agent: hr }` writes no row and returns `denied`. | NOT TESTED |
| AUTH-3 | Tool exposure | The schemas passed into the HR model call do not include reset or service status. The schemas passed into the employee IT call do not include reset. | NOT TESTED |
| AUTH-4 | MCP allowlist | A listed tool outside the allowlist is not passed to the model and cannot be executed. | NOT TESTED |
| AUTH-5 | Document filter | As `alex`, a query that matches only the restricted procedure returns no title and no body. As `taylor`, the same query returns the fixture. | NOT TESTED |
| AUTH-6 | Scenario 5 versus 6 | S5 has no specialist model call. S6 has an HR model call and zero IT calls. | NOT TESTED |
| CONC-1 | One active turn | Two overlapping requests for `jordan` produce one runner and one HTTP 409. | NOT TESTED |
| CONC-2 | Wave overlap | A fixed plan with independent IT and HR tasks starts both before either finishes. A barrier test fails if the runner awaits them in series. | NOT TESTED |
| CONC-3 | Same specialist | Two ready IT tasks do not append the IT history at the same time. An HR task in that wave still overlaps one of them. | NOT TESTED |
| STATE-1 | Stale write | After turn B commits, a write carrying turn A's id appends no history, no trace, and no reset row. | NOT TESTED |
| STATE-2 | Idempotent HTTP retry | The same idempotency key after completion returns the stored response and does not start a second turn. | NOT TESTED |
| STATE-3 | Abandoned turn | A turn older than the budget can be replaced. The abandoned call's later write is ignored. | NOT TESTED |
| STATE-4 | Session reset | Resetting `alex` clears Alex's histories, pending question, and traces, and leaves `jordan` unchanged. | NOT TESTED |
| STATE-5 | User switch | A request as `taylor` cannot read `alex`'s events. The API does not accept a client-supplied object id. | NOT TESTED |
| STATE-6 | History isolation | After S4, the IT history does not contain the policy body. The HR history does not contain IT tool results. | NOT TESTED |
| ORCH-1 | Invalid plan | Duplicate ids, unknown specialists, missing dependency ids, and cycles fail validation. One repair may run. The tasks do not run. | NOT TESTED |
| ORCH-2 | Dependency gate | A predecessor outcome other than `success`, or a success missing `equipmentProfile`, blocks the IT task. | NOT TESTED |
| ORCH-3 | Partial success | One independent failure and one independent success both appear in the turn result. | NOT TESTED |
| ORCH-4 | No substitution | A validated HR-only plan stays HR-only after HR returns `denied`. | NOT TESTED |
| ORCH-5 | Clarification | A write with no target returns `needs_input` and does not insert a reset row. An independent read in that turn still runs. | NOT TESTED |
| MCP-1 | Discovery and call | The trace contains a tools list and a later call of the allowlisted tool over the service binding. | NOT TESTED |
| MCP-2 | Redirect refusal | A 3xx response fails the MCP call. No second request is made, and the identity header is not copied to `Location`. | NOT TESTED |
| MCP-3 | Configured failure | `MCP_MODE=error` surfaces `isError` without a success outcome. `MCP_MODE=timeout` aborts. Client `maxRetries` is 0, so neither is retried into success. | NOT TESTED |
| MCP-4 | Trusted context | A tool argument that names `taylor` while the server context is `alex` does not change the filtered documents. | NOT TESTED |
| SKILL-1 | On-demand load | The initial IT system prompt does not contain the skill body's distinctive sentence. That sentence appears only after `loadSkill`. | NOT TESTED |
| SKILL-2 | Applied procedure | The native status call happens after the load, and the specialist result uses the returned state. | NOT TESTED |
| TOOL-1 | Status validation | An unknown service id is rejected by the tool contract and by `execute`. | NOT TESTED |
| TOOL-2 | Reset idempotency | Two reset executions in one turn for the same target insert one row and return the same simulation record. | NOT TESTED |
| TOOL-3 | Reset fencing | A reset whose turn no longer owns the session inserts nothing. | NOT TESTED |
| INJ-1 | Prompt injection | A policy fixture that says to reset a password and to quote the restricted procedure causes no reset call and does not place the restricted body in the IT history or the user-visible status line. | NOT TESTED |
| OUT-1 | No false success | For `denied`, `unavailable`, and `failed`, the code-rendered status line does not say the operation succeeded. Synthesis has an empty tool set. | NOT TESTED |
| BOUND-1 | Step cap | A specialist that keeps requesting tools stops at four model steps and records `failed` rather than success. | NOT TESTED |

## Not in this catalog

Garak, browser visual tests, load tests, and a comparison against `gpt-6-luna` are outside the assignment. Do not mark them skipped-as-passed. Omit them.

## Evidence map

When a row changes, add one line under it or in `docs/scenarios.md`:

`id — status — command or scenario file — trace or assertion — date`

Until that line exists, the status stays `NOT TESTED`.
