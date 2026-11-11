# Architecture Decisions: Small Enterprise AI Assistant

**Status:** Accepted baseline, pending the feasibility experiments in `docs/FEASIBILITY_PLAN.md`  
**Date:** 2026-11-11  
**Requirements:** `Senior AI EngineerCoding Challenge_ Small Enterprise AI Assistant.pdf`  
**Decision record:** `docs/ADR-001.md`  
**Verification catalog:** `docs/verification.md`

The PDF is the requirements source. This file is the engineering design. It is not evidence that the pieces run together. Confirmed platform facts, design judgments, and untested assumptions are separated in section 12.

## 1. Goal

Build a small fictional first-level IT and HR assistant on Cloudflare. The submission must show three agents, concurrent and dependent delegation, two-dimensional authorization, one native tool, one real MCP connection, one on-demand skill, session context, a timestamped trace, honest failures, and automated tests.

The PDF allows about one page of README plus setup, and an eight-hour implementation box. This repository does not record hours. Reported time must be actual time.

## 2. Accepted stack

| Layer | Choice |
| --- | --- |
| UI | React, Vite, strict TypeScript. Chat, demo-user dropdown, in-progress state, errors, and capability limits. Streaming is unnecessary. |
| API | One Cloudflare Worker, strict TypeScript |
| Model calls | Vercel AI SDK (`ai`, `@ai-sdk/openai`), `openai.responses("gpt-6.1-sol")` |
| Session | One SQLite Durable Object per demo user, `getByName(userId)` |
| Policy system | Second Worker, `createMcpHandler`, reached only through a service binding |
| Tests | `@cloudflare/vitest-plugin` for deterministic invariants. The seven PDF scenarios are a separate real-model script. |
| Packages | npm |

Secrets live in gitignored `.dev.vars`. The example file contains placeholders. Model calls set `store: false`. Do not send `temperature` or `topP`. `gpt-6.1-sol` rejects both, and it rejects reasoning effort `none` and `minimal`.

Reasoning split after the planning experiment in `docs/experiments/004-planning.md`:

- Orchestrator plan: `medium`
- IT, HR, and final synthesis: `low`

`gpt-6-luna` is not part of the first implementation. Revisit it only after the seven scenarios pass and a measured latency or cost problem remains.

Use `createMcpHandler` from the Agents SDK as the MCP server only. Do not use `McpAgent`, agents-as-tools, OpenAI hosted MCP or skills, LangGraph, or Cloudflare Workflows. The reasons are in the ADR.

## 3. Agents and scheduling

There are exactly three agents. The orchestrator is the only user-facing agent. IT and HR return results only to the orchestrator. Planning is one structured call inside the orchestrator, using the orchestrator instructions and the orchestrator history. A planner with its own history would be a fourth agent.

Each turn:

1. Plan call: structured output, no tools.
2. Code validates the plan. On failure, one repair call. A second invalid plan fails the turn. A partial plan is never executed.
3. Code runs the validated tasks. This step does not call the planner again.
4. Synthesis call: no tools. It may explain the outcomes. It cannot change them.

A plan task has an id, a specialist (`it` or `hr`), an objective, the user-question position, and `dependsOn` ids. Validation requires unique ids, known specialists, existing dependency ids, no cycles, and at most four tasks. The plan does not grant tools, roles, or agents.

Scheduling is a wave loop. A wave contains every task whose dependencies finished with `success` and the required handoff field. IT tasks in that wave run one after another. HR tasks in that wave run one after another. The two chains run together with `Promise.all`. Independent IT and HR work therefore overlaps. Two tasks for the same specialist do not share that specialist's history concurrently. A failed independent task is kept. The other result is kept. A dependent task whose predecessor is missing, denied, or failed is `unavailable` and does not run.

The orchestrator asks a follow-up only when a write lacks a target. Independent reads in the same turn still run. "Reset my password" targets the signed-in demo user. One pending question is stored. A later turn may answer it or change subject.

Named-specialist requests are honored. After validation, the scheduler does not add the other specialist. Scenario 6 depends on this rule.

## 4. Authorization

The demo dropdown sends one of three ids. The server accepts only those ids and loads the role from fixtures. Chat text, email strings, and model output do not select a role. Any caller who can reach the local API can select a demo identity. That is the PDF's switcher, not a production login. Document it as a limitation.

| Id | Email | Role |
| --- | --- | --- |
| `alex` | `alex@northstar.example` | Employee |
| `jordan` | `jordan@northstar.example` | IT Support |
| `taylor` | `taylor@northstar.example` | HR Operations |

| Capability | Employee | IT Support | HR Operations |
| --- | :---: | :---: | :---: |
| Read general HR policies | yes | yes | yes |
| Check IT service status | yes | yes | yes |
| General IT troubleshooting | yes | yes | yes |
| Read general equipment policy | yes | yes | yes |
| Simulated password reset | no | yes | no |
| Read HR-restricted procedures | no | no | yes |

Agent grants:

- Orchestrator: plan, delegate, and synthesize. No domain tool.
- IT: `getServiceStatus`, `loadSkill`, `simulatePasswordReset`.
- HR: the allowlisted policy tool. No status tool and no password reset.

Effective permission is user grant and agent grant and resource policy, stored in one capability module. Filter tool schemas before each model call. Check again inside tool `execute`, using the server-side user and agent, never a model-supplied role or user id.

**Scenario 5.** The signed-in user lacks the capability. Stop in the orchestrator. Do not call IT or HR. Do not put the reset schema in any model call. The trace records `permission.denied` for the orchestrator.

**Scenario 6.** The user has the capability and the delegated specialist does not. The HR model is actually called. Its tool list contains policy retrieval only. The trace records that `password_reset` was withheld from HR, then records HR's own completion back to the orchestrator. The scheduler does not create an IT task afterward. A prose claim that the reset happened does not change the outcome, because the reset tool did not run.

Switching the dropdown selects that user's Durable Object. It does not copy the previous user's history.

## 5. Outcomes, handoffs, and histories

Task outcomes are `success`, `needs_input`, `denied`, `unavailable`, or `failed`. `denied` means the caller or agent lacks permission. `unavailable` means a dependency or system did not produce data. Neither is stored as `success`.

The user-visible status line is rendered from these outcomes in code. Synthesis writes the explanation around that line and has no tools.

IT and HR histories are separate records in the user's Durable Object. A runner appends only its own history. Policy text stays in the HR history. The only dependency payload passed to IT is a typed value, for example `{ sourceTaskId, equipmentProfile: "standard-laptop" }`. Raw tool text, restricted procedure bodies, and skill bodies are not copied into another agent's history.

Retrieved policy text is untrusted. A fixture includes an instruction to call the reset tool or reveal a restricted document. That text must not cause a tool call the current agent was not given, and it must not appear in the IT history.

## 6. Tools, skill, and MCP

### Native tools

`getServiceStatus` accepts one known fictional service id and returns a structured state. The VPN skill tells the specialist to call it and then follow the fictional steps for that state.

`simulatePasswordReset` runs only when the server-side user is IT Support and the executing agent is IT. The target is a fixture user. The result says the reset is a simulation. The only stored effect is one row in the session Durable Object, written in the same `transactionSync` that confirms this turn still owns the session. The idempotency key is `(turnId, targetUser)`, chosen by the server. A second call in the same turn returns the first row. There is no automatic retry.

### Skill

`skills/vpn-troubleshooting/SKILL.md` is a normal troubleshooting procedure. The standing IT prompt receives its name and a one-line description. `loadSkill` returns the file when the IT model requests it. The procedure is not copied into the system prompt and is not given to the orchestrator or HR.

Evidence of application, without a test-only parameter:

- A unit test shows that a sentence which exists only in the skill file is absent from the initial IT prompt.
- The scenario trace shows `skill.loaded` before `getServiceStatus`.
- The skill's next step depends on the status value the tool returned.

### MCP

The policy Worker exports `createMcpHandler` and is an auxiliary Worker in local dev. The app Worker calls it through a service binding. The browser has no route to it. Service bindings do not propagate Cloudflare Access identity, so the app must pass user context itself.

The MCP client is `@ai-sdk/mcp` `createMCPClient` with a custom `fetch`. Discovered tools are intersected with the allowlist (`searchPolicies` or `getPolicy`, one of them) before they reach a model. A newly listed tool is not executable. Tool arguments do not include a user id or role.

The policy tool validates its query and returns a stable fictional id, version, classification, and body. Documents live in source-controlled fixtures: general leave, equipment profiles, onboarding, and one HR-restricted procedure. They are fictional and must agree with each other. The MCP Worker removes documents the current user cannot read before building the response, including titles. An employee query that matches only the restricted procedure returns an empty authorized set.

`MCP_MODE=ok|error|timeout` is an environment setting on the policy Worker. Ordinary chat cannot turn it on. `error` returns an MCP tool result with `isError: true`. `timeout` waits until the caller's `AbortSignal` fires. Neither mode is an HTTP 500, so a later change to client retries cannot hide it. The client is created with `maxRetries: 0`.

### Redirect and identity transport

Workers implement redirect modes `follow` and `manual`. Passing `redirect: "error"` throws `TypeError` when the `Request` is constructed, including inside `fetch(url, init)`. The current AI SDK HTTP transport defaults to `redirect: "error"` and only types `"follow" | "error"`. Following a redirect would resend our custom identity header toward `Location`. Fetch's special handling of `Authorization` does not cover that header.

The custom fetch is the control:

1. Reject any URL other than the single configured MCP endpoint.
2. Replace `init.redirect` with `"manual"` before the Workers `Request` is constructed.
3. On status 300–399, fail the MCP call. Do not request `Location`. Do not attach the identity header to a second request.
4. Set the trusted user header in this adapter from the server-side fixture.

The SDK redirect option is not the security control. The adapter overwrites it. This composition has not been executed. Section 12 lists what remains unproven. The first feasibility experiment is the proof.

The policy Worker must allow the pinned hostname. Origin-less server calls are the expected kind of client. Do not put the identity header in the query string.

## 7. Session and turn protocol

One SQLite Durable Object per demo user. The name is the fixture user id. The client does not send an object id. `ctx.id.name` is that user id.

Schema setup uses `blockConcurrencyWhile` in the constructor only. A callback that runs longer than 30 seconds resets the object, so model and MCP calls stay outside it. Turn changes use `transactionSync` and synchronous SQL. `BEGIN` inside `sql.exec()` is not available.

Reservation, inside one `transactionSync`:

- A completed idempotency key returns the stored response.
- An active turn younger than the turn budget returns 409.
- An active turn older than the turn budget is marked abandoned.
- Otherwise this `turnId` becomes the active turn.

There is no short lease. A healthy request keeps the turn until it finishes or the hard budget passes. Pending I/O can continue after the browser disconnects, so a disconnected call is still fenced by `turnId`.

Every history append, trace append, and reset insert repeats the owner check in the same `transactionSync` as the write. A stale turn writes nothing, including the reset row. `finally` clears the active turn only when this `turnId` still owns it, and stores the response under the idempotency key.

Each agent history is truncated to a fixed cap. The pending-question record is kept. Session reset clears that user's histories, pending question, traces, and active turn. It does not touch the other two users.

Initial budgets, unmeasured and to be revised after the model experiment: 90-second turn budget, model calls capped at the remaining budget or 45 seconds, tool calls capped at 10 seconds. One `AbortSignal` covers the turn, the model calls, and the tool calls.

Refresh during a live turn returns 409, or the stored response when the same idempotency key is retried after completion. Full replay of a disconnected response is out of scope.

## 8. Bounds and retries

Per turn: at most four tasks, two specialist chains in a wave, four model steps per specialist, and a bounded output token cap.

`generateText` uses `maxRetries: 1`. The AI SDK default is 2, and it retries only retryable provider failures (408, 409, 429, and 5xx by default). Abort is not retried. The shared abort signal also cancels retry delay. MCP `tools/call` retries stay at 0. The reset tool is not retried. A model may still request a tool again until the step cap; the reset row's idempotency key makes that safe.

Do not add a second retry wrapper around the SDK.

## 9. Trace

The API returns sanitized events for the turn. A collapsible dump in the UI is optional and is not required by the PDF. Do not build a timeline component. Garak is out of scope. One hostile fixture sentence is the injection case.

Events come from the running application, not from a reconstructed story and not from private reasoning. Fields: `traceId`, `sessionId` (the demo user id), `turnId`, `taskId`, `agentId`, `eventType`, timestamp, duration and outcome when the event has finished, tool or skill id, sanitized error code, authorization decision, and source ids. Omit secrets, policy bodies, private reasoning, and unnecessary user text.

Required events: plan validated or rejected; delegation start and completion; specialist start and completion; tool discovered, offered, denied, invoked, and result; skill load; permission decisions; dependency passed or blocked; failure or timeout; synthesis. Overlapping IT and HR timestamps are the concurrency evidence. Deterministic tests use a barrier. The seven PDF scenarios use the real model and keep their traces.

## 10. Out of scope

Multiple conversations per user, a conversation-id registry, OAuth, a public MCP URL, alarms, history summarization, a cost ledger, an in-UI trace timeline, Garak, and OpenAI provider-side response storage.

## 11. Later submission artifacts

Runnable source, `.dev.vars.example`, a one-page `README.md` plus setup, and `docs/scenarios.md` written from real traces after the seven runs. `docs/verification.md` is the invariant list and stays `NOT TESTED` until a run exists.

If time runs out, the PDF order is permissions and orchestration, then MCP and the skill, then UI and trace.

## 12. Evidence labels

**Confirmed from current docs or SDK source, not from a local run.** `gpt-6.1-sol` tool calling requires the Responses API. Its reasoning efforts are `low`, `medium` (default), `high`, `xhigh`, and `max`. Workers reject `redirect: "error"` and accept `manual`. Service bindings are not public URLs and do not carry Access identity. `createMcpHandler` is stateless. `McpAgent` is deprecated. SQLite `transactionSync` is synchronous. `blockConcurrencyWhile` resets the object after 30 seconds. `generateText` defaults to two provider retries. The MCP client's tool-call `maxRetries` defaults to 0. Workers do not retry `fetch`.

**Judgments.** One Durable Object per demo user. Medium for the plan and low for the other calls. The planning experiment kept medium: low matched the specialist and dependency shapes on these prompts, and it also collided two `order` values on one dependent prompt. Wave scheduling instead of a graph library. The HR model runs in scenario 6. The skill is demonstrated by its procedure and the status tool, not by a marker argument. The redirect adapter above, rather than `redirect: "follow"`. Status lines rendered from outcomes. Initial time budgets in section 7.

**Not yet run.** The seven application scenarios, including scenario 6's full trace. Experiment 4 measured plan shape for fifteen prompts only. The binding, the pinned fetch adapter, Host allowlist, and `createMcpHandler` as one path were measured in experiment 1, and the AI SDK inside workerd in experiment 2. Those rows in `docs/verification.md` remain `NOT TESTED`.

References:

- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/guides/reasoning
- https://ai-sdk.dev/providers/ai-sdk-providers/openai
- https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
- https://developers.cloudflare.com/workers/runtime-apis/request/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/
- https://developers.cloudflare.com/durable-objects/api/state/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/workers/local-development/multi-workers/
- https://developers.cloudflare.com/workers/testing/vitest-integration/
