# Feasibility plan

**Status:** Experiments 1–3 passed. Experiment 4's first run was partial; the targeted review in `docs/experiments/004-planning.md` supports passing that limited scope. Evidence: `docs/experiments/001-mcp-transport.md`, `docs/experiments/002-openai-workers.md`, `docs/experiments/003-durable-object-state.md`, and `docs/experiments/004-planning.md`. Experiment 5 has not started. No `docs/verification.md` row has changed.  
**Date:** 2026-11-11  
**Design:** `ARCHITECTURE_DECISIONS.md`

These five checks are the gate before application code. Each one is a small script or a minimal Worker, not the assistant. A pass means that specific behavior happened. It does not mean the full integration is done, and it does not change any `docs/verification.md` row from `NOT TESTED`.

Run them in this order. Experiment 1 does not need an OpenAI key. Experiments 2, 4, and 5 do. Experiment 3 does not.

If an experiment fails, apply the change listed for that failure. Do not switch to agents-as-tools, LangGraph, or Workflows as the recovery.

## 1. MCP transport and authorization

**Executed.** 2026-11-11. Result: PASSED. The evidence file records the protocol trace, the Host-header fix, and the checks that are still outside this experiment.

**Question.** Can the app Worker call `createMcpHandler` on an auxiliary Worker through a service binding, with the pinned fetch adapter, and enforce user and tool limits?

**Setup.** Two Workers under one Vite or Wrangler dev command. The policy Worker is auxiliary and has no public route. The client uses `@ai-sdk/mcp` with a custom `fetch` that:

- allows only the configured MCP URL
- sets `redirect: "manual"` before any Workers `Request` is constructed
- fails on HTTP 300–399 without a second request
- sets the user header from the test, not from tool arguments

Pin that hostname in the handler's `allowedHostnames`. Leave MCP client `maxRetries` at 0.

**Expected.** `tools/list` returns the policy tool. An authorized call returns the general leave fixture. An employee context returns no restricted title or body. A tool argument naming another user does not widen the result. `MCP_MODE=error` returns `isError: true` and no success payload. A synthetic 302, if injected at the adapter, is not followed.

**Pass.** All of those outcomes, over the binding, with one POST list and one POST call. No `TypeError` from `redirect: "error"`. No GET reconnect loop required for the call to finish.

**Fail, and what changes.**

- `redirect: "error"` throws before the adapter runs. The installed client builds the `Request` itself. Stop and wrap or replace that client path. Do not set `redirect: "follow"` to get past the throw.
- Host 403. Add the pinned hostname to `allowedHostnames`. If the handler still rejects a binding request, change the pinned URL to a localhost host the default allowlist already accepts, and keep the binding.
- Protocol mismatch or a session GET loop. Pin the client to the stateless mode the handler accepts. Keep a real MCP list and call. Do not replace the server with a direct function call.
- The binding `fetch` signature differs. Adapt it at the edge of our fetch function. A public URL is not the fallback.
- Identity is taken from tool arguments. That is an application bug, not a transport failure. Remove the argument.

**Uncertainty this closes.** The adapter, the Host allowlist, protocol negotiation, and header trust are documented separately today. This is the first time they are required to work together. The installed package types are still unknown until this experiment installs them.

## 2. AI SDK and GPT-6.1 Sol inside Workers

**Executed.** 2026-11-11. Result: PASSED. All 6 Workers tests passed, including the real tool call (about 6.27 seconds) and the real structured-output call (about 4.12 seconds). Evidence: `docs/experiments/002-openai-workers.md`.

**Question.** Does `openai.responses("gpt-6.1-sol")` complete from a Worker or Durable Object, not from Node?

**Setup.** One `wrangler dev` call. `store: false`. No `temperature` or `topP`. Reasoning effort `low`. One call uses a Zod tool and `maxRetries: 1`. A second call uses structured output and no tools. Share an `AbortSignal` that is already aborted and confirm the call is not retried.

**Expected.** The tool `execute` runs and its result is visible. The structured call returns an object matching the schema. The request uses the Responses API. The aborted call fails once.

**Pass.** Both calls succeed inside workerd, and the aborted call does not send a second provider request.

**Fail, and what changes.**

- Import or runtime error. Record the missing compatibility flag or package version. Do not assume `nodejs_compat` until the error asks for it.
- HTTP 400 on effort, temperature, or chat completions. Pin `openai.responses("gpt-6.1-sol")` and delete the rejected field.
- Structured output and tools fail only when combined. Keep them in separate calls, which is already the design.
- The model id is rejected. Stop. `gpt-6-luna` and Chat Completions are not automatic substitutes. Chat Completions cannot call tools for this model.

**Uncertainty this closes.** SDK execution inside workerd, and the Responses settings we intend to send.

## 3. Durable Object turn coordination

**Executed.** 2026-11-11. Result: PASSED. Eight Workers tests passed against a SQLite Durable Object. Evidence: `docs/experiments/003-durable-object-state.md`.

**Question.** Does `transactionSync` reserve a turn, reject a second request, and drop a stale write, including a reset?

**Setup.** One SQLite Durable Object in the Vitest Workers pool. No model calls. The test drives two requests and one late write.

**Expected.** Request A holds the turn. Request B receives 409 while A is inside a barrier after the reservation. A's completion stores one response. A second call with A's idempotency key returns that response and does not append again. A write with a replaced `turnId` appends nothing and inserts no reset row. Two reset calls for the same turn and target return one row. Resetting user `alex` leaves `jordan`'s object unchanged.

**Pass.** Those assertions, using storage rather than an in-memory flag.

**Fail, and what changes.**

- `transactionSync` cannot express the compare-and-set. Use synchronous `sql.exec` with no `await` between the read and the write. Do not wrap the model call in `blockConcurrencyWhile`.
- The second request enters the runner. The reservation is not committed before the first `await`. Move the commit earlier.
- Reset rows duplicate. The unique key or the owner check is missing. Fix that before any model work calls the tool.

**Uncertainty this closes.** The turn protocol in section 7 of the architecture document.

## 4. Structured planning

**Executed.** 2026-11-11. The first run was PARTIALLY PASSED: thirty planning calls and one repair call. A targeted medium-effort review then judged the A5 and B3 checks incoherent and supports passing the limited scope. Evidence: `docs/experiments/004-planning.md`, `docs/experiments/004-planning-results.json`, and `docs/experiments/004-planning-review.json`.

**Question.** At the chosen reasoning settings, does the real model produce plans the scheduler can run for scenarios 3, 4, and 6?

**Setup.** After experiment 2. Ten calls each, same schema, `medium` and `low`, for:

- one VPN question plus one unrelated leave question
- equipment profile, then setup advice that needs that profile
- "Ask HR to reset my password. Do not use IT." as an IT Support user

No specialist execution in this experiment. Validate the JSON only.

**Expected.** At `medium`: at least eight of ten independent plans have two specialists and no dependency edge; at least eight of ten dependent plans put HR first with IT depending on it; at least eight of ten named-HR plans target only HR. Record latency and reasoning tokens.

**Pass.** Medium meets those counts. If low meets them too, change the plan call to `low` and record that in the architecture document.

**Fail, and what changes.**

- Shape misses the threshold. Revise the schema description and the one repair instruction. Run the same thirty calls once more.
- Named-HR plans still target IT after that revision. Keep the rule that the scheduler never adds a specialist. Add a plan field for the specialist the user named, and reject a plan that targets a different one. Do not add keyword routing unless that field also fails the second run.
- Medium is required and the latency exceeds the 45-second call cap on most requests. Raise that cap from the measurement. Do not move the plan onto `high` or `pro` without a new run that shows the shapes otherwise fail.

**Uncertainty this closes.** The initial medium/low split, and whether scenario 6's prompt actually delegates to HR.

## 5. Skill loading and native tool use

**Question.** Does one specialist `generateText` load the VPN skill and then call `getServiceStatus` because of that procedure?

**Setup.** After experiment 2. IT tools are `loadSkill` and `getServiceStatus` only. The system prompt has the skill name and description, not the body. Step cap 4. Reasoning effort `low`. The skill tells the model to check the VPN service and branch on the returned state.

**Expected.** The trace order is `loadSkill`, then `getServiceStatus` for the VPN service. The tool result's state appears in the specialist text. A unit-level string check shows the procedure sentence was not in the initial prompt.

**Pass.** That order and that string check, from a Worker, with the real model.

**Fail, and what changes.**

- The model calls status and never loads the skill. Shorten the tool descriptions so they do not contain the procedure, and say in the IT instructions to load the VPN skill before VPN advice. Repeat once.
- The model loads the skill and ignores the state. Make the procedure's next step quote the state field. Do not add a dummy tool argument unless this second run still cannot be told apart from an answer that never saw the file.
- The tool loop stops after the load. Confirm the SDK is carrying the tool result into the next step of the same `generateText`. Do not switch the call to stored `previous_response_id` unless the response shows the items were dropped.

**Uncertainty this closes.** On-demand load plus an observable use of the loaded instructions, inside the Workers runtime.

## After these five

Start the application only if experiments 1, 2, and 3 pass. Experiments 4 and 5 may change prompt text and the plan effort. They should not change the stack. The seven scenario rows in `docs/verification.md` remain `NOT TESTED` until the full application produces them.
