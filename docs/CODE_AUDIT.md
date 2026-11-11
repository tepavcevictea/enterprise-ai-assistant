# Independent code audit

**Role:** Principal Software Engineer, read-only review before a Senior AI Engineer take-home submission  
**Date:** 2026-11-11  
**Scope:** Assignment PDF, `ARCHITECTURE_DECISIONS.md`, application source, tests, saved traces  
**Method:** Source review only. No refactors, no test runs, no paid model calls. Line counts are last-line counts from the files themselves. `node_modules`, lockfiles, and generated `dist/` were ignored.

This review treats passing tests and `docs/verification.md` as claims to check, not as proof.

---

## 1. Overall engineering assessment

The backend is a real system, not a prompt-routed demo. The live path plans with `gpt-6.1-sol`, runs IT and HR as separate model calls, talks to a second Worker over MCP, loads the VPN skill on demand, and fences turns in a SQLite Durable Object. Authorization for the tools that exist is enforced in application code from the signed-in fixture user, not from model output. MCP errors become `unavailable`. HR answers come from the tool consultation, not from specialist prose.

That is the right shape for this assignment.

The slice is also incomplete relative to the PDF, and the README says so: no React UI, no password-reset tool, scenarios 5–7 not run. The serious problems in the code that *does* exist are narrower than that: the IT specialist cannot report a non-success outcome except by throwing, and the S4 “PASSED” evidence predates the equipment-entitlement prompt change.

**Verdict:** the current backend is a strong S1–S4 slice and is not cheating the LLM. It is not yet a complete PDF submission. Do not rip out the scheduler, MCP adapter, or session protocol to make the repo look smaller.

---

## 2. Source code size and complexity

### Authored production code

| Area | Files | Lines |
| --- | ---: | ---: |
| App Worker (`src/*.ts`, `src/mcp/*.ts`) | 18 | 2,432 |
| Policy Worker (`policy/src/index.ts`) | 1 | 110 |
| Skill body (`skills/vpn-troubleshooting/SKILL.md`) | 1 | 8 |
| Policy bundle script | 1 | 24 |
| **Production total** | **21** | **~2,574** |

Configs (`wrangler.jsonc`, `wrangler.test.jsonc`, `policy/wrangler.jsonc`, `package.json`, `tsconfig.json`, Vitest configs) add about 140 lines and are not application logic.

Largest production files:

| File | Lines | Role |
| --- | ---: | --- |
| `src/mcp/policy-client.ts` | 414 | MCP discover / allowlist / invoke / error mapping |
| `src/models.ts` | 357 | Stub port, live plan, live IT, unused synthesis |
| `src/session.ts` | 325 | Durable Object schema, reserve, finish, reset |
| `src/turn.ts` | 271 | Plan → schedule → specialist → reply |
| `src/plan.ts` | 213 | Schema, validation, planner prompts |

### Tests, experiments, docs

| Area | Approx. size | Notes |
| --- | --- | --- |
| App tests (`test/*.spec.ts`) | 5 files, 1,272 lines, 35 cases | Mix of pure functions, stub-model Worker tests, and 5 live-model cases |
| Experiments | 3 packages, ~20 TS files | Not imported by production. Historical copies of plan validation, pinned fetch, and turn fencing |
| Design docs | `ARCHITECTURE_DECISIONS.md` (215), `docs/ADR-001.md`, `docs/verification.md`, experiment write-ups | Far more than the PDF’s one-page README |
| Saved traces | `docs/slice-*-example.json` | Evidence for S1–S4, not runtime code |
| UI | **0** `.tsx` / `.jsx` / HTML files | Documented as out of this slice |

### Complexity judgment

The production graph is small and named by job: `worker` → `session` → `turn` → `plan` / `schedule` → `hr` / `models` / `skills`. A senior who has not seen the repo can follow it in one sitting.

Unnecessary weight is concentrated in leftovers, not in extra frameworks:

- `ModelPort.synthesize` and `liveSynthesis` are never called. `runTurn` uses `composeReply`.
- `offeredToolIds` is a parallel permission list, not the map `liveIt` / `runHrSpecialist` actually pass to the model.
- `password_reset`, `equipment_policy`, and `hr_restricted` are declared in `src/capabilities.ts` and never consulted at execute time. Document filtering uses `canReadPolicy` in `src/policies.ts`.
- Experiment packages duplicate earlier versions of `plan.ts`, `pinned-fetch.ts`, and session fencing. Production does not import them. That is leftover process, not runtime duplication.

The stub IT path is a test double, not a second production orchestrator. It is gated on `MODEL_MODE === "stub"` (`wrangler.test.jsonc` only).

**Eight-hour fit:** the implemented backend is an appropriate senior slice for S1–S4 plus MCP, skill, and session fencing. Do not shrink it for line count. The experiment tree and architecture corpus would overwhelm a reviewer if presented as the submission; they should stay out of the README.

---

## 3. Findings

Severity is for demonstrated defects first, then concrete risks. Style preferences are listed only when they hide a real gap.

### Critical

None. Existing tools re-check `permits()` at execute time. The session object is selected with `getByName(demoUserId)`. MCP identity is attached by the pinned fetch, not by tool arguments. Restricted policy bodies are filtered before JSON is built, then checked again against fixtures. I did not find a permission bypass or a live-path fake of an LLM response.

### High

#### H1. IT success is hardcoded; missing keys and failed tools still look successful

**Where**

- `src/turn.ts` 207–243 — `runTask` records `specialist.completed` / `delegation.completed` with `outcome: "success"` for every IT return that does not throw.
- `src/models.ts` 207–208 — missing or placeholder API key returns `{ text: "The IT specialist could not be called.", statuses: [] }` instead of failing.
- `src/models.ts` 316 — live IT returns `{ text: result.text, statuses }` with no outcome.
- Contrast: `src/hr.ts` 124–127 — HR with no policy call is `failed` (`MISSING_CALL`); `src/hr.ts` 130–136 — HR text is the consultation report, not `generateText` prose.

**Why it matters**

The PDF requires honest failure. Architecture `OUT-1` says denied / unavailable / failed must not be rendered as success. IT cannot currently produce those outcomes except by throwing. A missing key, a denied status tool, or a model that never calls `getServiceStatus` still becomes turn outcome `success` (`src/turn.ts` 264–265: any successful task wins). HR does not have this bug: MCP `isError` is `unavailable`, and model prose cannot invent a policy document.

This is a defect in the live path, not a stub-only issue. Empty `statuses` is legitimate for S4 (IT used a handoff, not the status tool). Treating “could not be called” as success is not.

**Smallest correction**

Give `runIt` an `outcome`. Map missing key and thrown provider errors to `failed`. Have `runTask` copy that outcome. Leave S4’s empty-status success alone.

#### H2. S4 “PASSED” is not justified after the equipment-entitlement wording change

**Where**

- `src/plan.ts` 193 — planner is now told not to turn equipment into a role-specific entitlement.
- `src/hr.ts` 26–27 — HR is told not to describe the profile as role-specific unless the document says so.
- `test/skill.spec.ts` 148–150 — unit test only checks that those sentences exist in the prompts.
- `test/live.spec.ts` 154 — live S4 still sends “Based on the equipment profile I'm entitled to under company policy…”.
- `docs/slice-dependent-example.json` 4–5, 25 — saved plan objective is “Determine Jordan's equipment profile entitlement…”; reply calls it “policy-entitled”.
- `docs/verification.md` 20, 86 — S4 still `PASSED` against that artifact.

**Why it matters**

The live trace proves the *old* prompts. The correction has not been re-run. The live test does not assert the new wording; it only checks `standard-laptop`, a typed handoff, and history isolation. A reviewer who compares the saved reply with the current planner prompt will see a contradiction.

**Smallest correction**

Re-run the S4 live case (and only that case) against current prompts. Replace `docs/slice-dependent-example.json`. Keep `PASSED` only if the plan/handoff still match `docs/verification.md` and the reply no longer invents a Jordan-specific entitlement. Until then, mark S4 `STALE`.

### Medium

#### M1. Tool exposure is computed twice

**Where:** `src/models.ts` 232–298 (`liveIt` builds tools from `permits`), 351–357 (`offeredToolIds`); `src/hr.ts` 100–118 (hardcoded `searchPolicies` after `preparePolicyCall`).

**Why:** `test/hr.spec.ts` 67–72 and `test/slice.spec.ts` 90–92 assert `offeredToolIds`, not the object passed to `generateText`. Adding `simulatePasswordReset` in one place and not the other would make AUTH-3 tests lie.

**Smallest correction:** Build the live `tools` object from one helper. Point the tests at that helper.

#### M2. Plan validation is untested in the application suite

**Where:** `src/plan.ts` 65–176 implements duplicate ids, unknown specialists, missing deps, cycles, task count, generic `dependsOn`. `npm test` never calls `validatePlan`. The same checks live in `experiments/openai-workers/test/plan.spec.ts`. `docs/verification.md` ORCH-1 is `NOT TESTED`.

**Why:** Live planning depends on this gate. A regression here is silent in CI.

**Smallest correction:** Copy the experiment’s validation cases into `test/` and run them under `npm test`. Do not import the experiment package.

#### M3. Named-specialist constraint was dropped on the way into production

**Where:** `experiments/openai-workers/src/plan.ts` 206–213 (`executionGate`). Production `src/plan.ts` has no equivalent. Scheduler (`src/schedule.ts`) will not *add* IT, but it will run an IT task if the planner emits one.

**Why:** Scenario 6 needs “HR only, do not use IT” to survive a schema-valid plan that still includes IT. That is currently a prompt rule (`src/plan.ts` 187), not a code rule.

**Smallest correction:** When implementing S6, reject (or repair) a plan that includes a specialist the user ruled out. Do not rewrite the plan by inserting IT.

#### M4. `docs/verification.md` is not an accurate map of the tests

Several `NOT TESTED` rows already have Worker tests:

| Row | Evidence that already exists |
| --- | --- |
| AUTH-4 | `test/hr.spec.ts` 135–141, 288–295 |
| AUTH-5 | `test/hr.spec.ts` 75–96, 116–133, 312–337 |
| CONC-1, STATE-1, STATE-3 | `test/slice.spec.ts` 234–265 |
| STATE-2 | `test/slice.spec.ts` 201–217 |
| STATE-4 | `test/slice.spec.ts` 219–232 |
| STATE-5 | `test/slice.spec.ts` 62–66; `test/hr.spec.ts` 308–309 |
| MCP-1, MCP-2, MCP-3, MCP-4 | `test/hr.spec.ts` 99–265, 339–361 |
| ORCH-2, CONC-2, STATE-6, SKILL-1, SKILL-2, S1–S3 | correctly `PASSED` |

S3’s saved trace is also stale in a smaller way: `docs/slice-concurrent-example.json` 25 puts the leave-policy body into the HR objective. `src/plan.ts` 197–203 now strips assistant/HR history from the planner prompt; `test/skill.spec.ts` 137–147 locks that. The concurrency claim can stand; the artifact should be refreshed when convenient.

**Smallest correction:** Flip rows that the stub-model Worker tests already prove. Mark S4 `STALE` until H2 is re-run. Do not mark S5–S7 passed.

#### M5. Test Durable Object hooks sit on the production class

**Where:** `src/session.ts` 48–58 `armHold` / `releaseHold` (not gated); 60–68 `armPlan` / `armMcpMode` (gated on `MODEL_MODE !== "stub"`).

**Why:** They are not HTTP routes, so this is not an auth hole. `armHold` can stall `message()` before the 90s abort starts (`src/session.ts` 106–109). Harmless in vitest; it should not ship as part of the DO API.

**Smallest correction:** Gate `armHold` the same way as `armPlan`, or move the hold into the test file via `runInDurableObject` state only.

#### M6. Stub IT always checks VPN, including when the prompt is about wifi

**Where:** `src/models.ts` 64–80 (default plan is VPN); 116 (`serviceId: "vpn"` regardless of objective); `test/skill.spec.ts` 80–86 (“Is the office wifi available?” still expects `getServiceStatus` and only asserts the skill was not loaded).

**Why:** This is stub-only (`MODEL_MODE=stub`). It does not fake the live path. It does make that test name misleading.

**Smallest correction:** Pass the service id from the armed plan, or rename the test to “status check without a skill id”.

### Low

#### L1. Production reply composer special-cases the stub phrase

`src/reply.ts` 39: `text === "Status checked."` substitutes the status detail. That string is produced by `src/models.ts` 124. Live models almost never emit it. Harmless; delete the branch when the stub starts returning the detail itself.

#### L2. Capability names that nothing reads

`src/capabilities.ts` 8–23 declares `password_reset`, `equipment_policy`, and `hr_restricted`. Document access uses `src/policies.ts` 65–67 (`role === "hr_operations"`). Until reset exists, the unused grants are reservations, not a bypass. When reset is added, execute must call `permits(user, "it", "password_reset")` — do not assume the grant table is already enforced.

#### L3. Step cap does not fail the turn

`src/models.ts` 311 and `src/hr.ts` 97 use `stepCountIs(4)`. Architecture BOUND-1 wanted `failed` after four tool-requesting steps. Today the call just stops and IT still succeeds (H1). No need to implement BOUND-1 before S5; do not claim it.

#### L4. `composeReply` is denser than the rest of the slice

`src/reply.ts` 4–28 hides supplier tasks and de-duplicates status detail. The behavior is tested (`test/skill.spec.ts` 120–135; S3 reply order). Do not replace it with an LLM synthesis call in order to match the architecture doc. The dead `liveSynthesis` (`src/models.ts` 319–335) should be removed or actually used; using it now would make failures easier to contradict.

---

## 4. Hardcoding and shortcuts (explicit search)

| Pattern | Result |
| --- | --- |
| Routing on exact demo prompts / keyword combos | **Not in the live path.** Planner is a structured model call (`src/models.ts` 155–168). |
| Stub default plan always IT/VPN | **Yes, stub only** (`src/models.ts` 64–80). Live tests do not use `armPlan`. |
| Skill load if `objective.includes(skill.id)` | **Stub only** (`src/models.ts` 96). Live IT exposes `loadSkill` and lets the model call it. Saved S1 trace: `skill.loaded` at 16:58:07, `getServiceStatus` invoked at 16:58:09. |
| Hardcoded live plans or expected LLM text | **No.** |
| Tool output presented as an LLM reply | **HR no** (`fromConsultation`). **IT stub yes** (constructs `"Status checked."` / skill next step). **IT live** uses model text, which is the opposite problem (H1). |
| Fabricated agent results on the live path | **No.** |
| Hidden fallback that turns failure into success | **Yes, IT** (H1). **No, HR/MCP.** |
| Test-only branches in production | `MODEL_MODE === "stub"`, `armPlan`, `armMcpMode`, `armHold` (M5). Not reachable from `/messages`. |
| Special case to pass one test | `src/reply.ts` 39 `"Status checked."` (L1). Entitlement sentences in planner/HR prompts are product behavior, not a test backdoor. |

Legitimate fixtures (VPN degraded status, policy documents, demo users) are not counted as cheats.

---

## 5. Architecture and readability

What is easy to follow: one Worker, one DO per demo user, one policy Worker, three agents, a wave scheduler, MCP behind a pinned fetch. File names match those jobs.

What is slightly muddy, but not wrong:

- `src/models.ts` mixes stub, live plan, live IT, and a dead synthesizer. HR already lives in `src/hr.ts`.
- Authorization is two sources: `permits()` for tools, `canReadPolicy()` for documents (M1/L2).
- Test helpers `send` / `reset` / `read` are copy-pasted across four spec files. Annoying, not a product defect.

A senior unfamiliar with the project can learn the runtime from `src/worker.ts`, `src/session.ts`, and `src/turn.ts` without the experiment packages. They should not need LangGraph, Cloudflare Workflows, or Agents-as-tools. Those were correctly left out.

---

## 6. Correctness and security (other than H1)

Checked and **not** found as defects in the implemented slice:

- User impersonation via chat text: role comes from `USERS[ctx.id.name]` (`src/session.ts` 86–119) after `x-demo-user` is allowlisted (`src/worker.ts` 6–18).
- Client-supplied object id: rejected (`src/worker.ts` 14–16, 37–38).
- Tool schemas filtered before the HR model: only `searchPolicies` is in `generateText` tools; `exportAllPolicies` is discovered, traced as denied, and never offered (`src/mcp/policy-client.ts` 236–271; `src/hr.ts` 100–118).
- MCP arguments cannot change the user: `test/hr.spec.ts` 116–133 passes `userId: "taylor"` as a tool argument while the header is `alex` and gets `[]`.
- Redirects: pinned fetch forces `manual` and fails 3xx without following `Location` (`src/mcp/pinned-fetch.ts` 64–123).
- Stale turns: `finish` no-ops if `active_turn` mismatch (`src/session.ts` 197); overlapping test drops the abandoned write (`test/slice.spec.ts` 234–265).
- History isolation: HR body is not copied to IT; IT receives `equipmentProfile=standard-laptop` (`src/turn.ts` 137–146, `src/mcp/policy-client.ts` 65–74).
- Unexpected but schema-valid plans: `validatePlan` still rejects cycles, generic deps, bad ids (`src/plan.ts` 65–107). Scheduler will execute any plan that passes. That is intended for S1–S4; S6 needs M3.

Residual risks, not current bugs:

- IT model text can invent a status if it skips `getServiceStatus` (H1). Live S1/S3 tests currently require the tool call, so they would catch that on those prompts only.
- Policy Worker trusts `x-northstar-user` (`policy/src/index.ts` 99–107). That is correct behind a service binding. If `wrangler dev` also exposes the policy Worker on a local port, that header is the whole auth story. Document it; do not put it on the public internet.
- Hostile retrieval fixture from architecture §5 is not in `POLICIES` (`src/policies.ts` 27–57). INJ-1 is unimplemented, not silently passed.

---

## 7. Test quality versus `docs/verification.md`

Classification of the 35 app tests:

| Kind | What actually runs |
| --- | --- |
| Pure unit | Skill prompt, `authorizedCopies`, `scheduleTasks` with a fake `run`, `composeReply`, `plannerContext`, `offeredToolIds`, `runServiceStatus` |
| Stub-model Worker tests | `@cloudflare/vitest-plugin` + `MODEL_MODE=stub` + **real** policy Worker (`vitest.config.ts`). This is most of `test/hr.spec.ts`, `test/slice.spec.ts`, `test/orchestration.spec.ts`, `test/skill.spec.ts` |
| Cloudflare runtime | All of the above execute inside workerd, not Node. Session tests hit the real Durable Object. |
| Real-model e2e | `test/live.spec.ts` only (5 cases). Requires `OPENAI_API_KEY`. |

`docs/verification.md` is right that mocked models cannot pass S1–S7. It is wrong in both directions: S4 is marked PASSED after a prompt change (H2), and many AUTH/STATE/MCP rows marked `NOT TESTED` already have stub-model Worker evidence (M4).

Overfit: stub tests that `armPlan` with objective `"leave"` / `"offboarding"` / `"vpn-troubleshooting"` because the stub searches with the objective and loads a skill only when the id appears in it. That does not invalidate the live tests, which send realistic prompts and assert traces.

S5–S7, AUTH-1/2/6, ORCH-1/4/5, TOOL-2/3, INJ-1, BOUND-1 remain genuinely unproven. Password reset is not in the tree, so AUTH-1 cannot pass.

---

## 8. Top five improvements by impact

1. **Propagate an IT outcome** (H1). Stops false success before any new feature lands.
2. **Re-run S4 live and refresh the saved trace** (H2). Cheap, and it is the only PASSED scenario whose prompts changed under it.
3. **Implement `simulatePasswordReset` with execute-time `permits(user, agent, "password_reset")`, then S5 as an orchestrator deny that never delegates.** Do not detect the word “reset” in the user text. Drive S5 from the planned capability, or from a structured “write” the planner already has to emit, plus a server-side capability check.
4. **Move `validatePlan` cases into `npm test`** (M2). Protects every later scenario.
5. **One function for offered tools** (M1), then S6 using a named-specialist gate (M3).

---

## 9. What should explicitly NOT be changed

- Do not replace the wave scheduler with a graph library or Agents-as-tools.
- Do not put the skill body in the IT system prompt. SKILL-1 is real (`test/skill.spec.ts` 44–56; `src/skills.ts` 50–64).
- Do not follow MCP redirects or pass the identity header from the model.
- Do not take HR’s user-visible text from `generateText`. Keep `fromConsultation`.
- Do not add keyword routing to “pass” S5/S6.
- Do not introduce an LLM synthesis call just to match `ARCHITECTURE_DECISIONS.md` §3. Code-rendered replies are the more honest design; `test/slice.spec.ts` 168 already asserts the stub synthesizer string is absent.
- Do not merge experiment packages into `src/`. Port tests, not files.
- Do not delete session fencing, pinned fetch, or `authorizedCopies` to reduce line count.
- Do not treat the demo header as production login. The PDF allows a switcher; the README already says that.

---

## 10. Is the backend ready for the remaining features?

**Yes, as a substrate. No, as a finished PDF submission.**

Already in place for the remaining work:

- Session reserve / replay / stale-write / reset protocol
- Two-dimensional `permits()` for tools that exist
- MCP allowlist, error, timeout, and pinned identity
- Concurrent and dependent scheduling
- Trace events the PDF asks for
- On-demand skill loading

Still to build, in PDF priority order:

1. Permission model completion: `simulatePasswordReset`, orchestrator deny for S5, named-specialist gate for S6, hostile policy fixture for INJ-1
2. S7 live with `MCP_MODE=error` and `timeout` (the stub path already maps both to `unavailable`)
3. React chat UI
4. Re-verify S4 after H2; optionally refresh the S3 artifact

The backend should take those in that order. It should not take a rewrite.
