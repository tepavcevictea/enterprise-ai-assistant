# Experiment 4 — Structured orchestration planning

**Result:** PARTIALLY PASSED for the first 30-call run, under the original checks. Those scores are unchanged below.  
**Review:** A later targeted review found the A5 and B3 checks incoherent. Under the corrected rule, this limited experiment can be considered PASSED. The remaining limitation is recorded in the review section.  
**Date:** 2026-11-11  
**Scope:** Whether `gpt-6.1-sol` returns schema-valid, semantically usable task plans for the three-agent assistant. This is not the orchestrator, and it does not execute specialists. No row in `docs/verification.md` changed.

Every plan below was produced by the real model inside workerd. The model did not grade its own output. Semantic checks are deterministic and are recorded per call in `docs/experiments/004-planning-results.json`.

## Configuration

| Setting | Value |
| --- | --- |
| Model | `openai.responses("gpt-6.1-sol")` |
| API | Responses. Every captured request was `POST /v1/responses`. |
| SDK | `ai@7.0.169`, `@ai-sdk/openai@4.0.114`, structured output through `Output.object` |
| Schema | Zod 4.6.7 |
| `store` | `false` |
| `temperature` / `topP` | not sent |
| `maxRetries` | `1` |
| Tools | none |
| Reasoning | `medium` and `low` on the same prompts and schema |
| Runtime | Vitest Workers pool, compatibility date `2026-11-11`, no compatibility flags |
| Node | v22.23.4 |

The API key came from the gitignored Worker binding `env.OPENAI_API_KEY`. It is not in the evidence file.

The planner instructions name the two specialists and the rules for dependencies and named specialists. They do not contain the fifteen evaluation requests. A unit test checks that. The exact instructions are in the evidence file.

## Schema

A plan is `{ tasks: Task[] }`. Each task has only these fields:

| Field | Purpose |
| --- | --- |
| `id` | Explicit task id. Dependencies use this string. |
| `specialist` | `it` or `hr`. The model cannot name another agent. |
| `objective` | What that specialist is assigned to do. |
| `order` | Position of that part in the user's request, starting at 1. This is not the execution sequence. |
| `dependsOn` | Zero or more `{ taskId, information }` entries. `taskId` is the predecessor. `information` is the fact that predecessor must produce. |

`dependsOn` is both the dependency edge and the handoff description. There is no `equipmentProfile` field. The scheduler can later copy the named fact into a typed handoff. The plan does not grant tools, roles, or agents.

`planSchema` accepts the JSON shape. `validatePlan` decides whether it is executable. A schema-valid object is rejected when it has a duplicate id, an unknown specialist, a missing predecessor, a self-predecessor, a cycle, fewer than one or more than four tasks, a repeated predecessor, or a dependency whose information is only a generic word such as `result`. `executionGate` rejects a structurally valid plan that includes a specialist other than an explicit `onlySpecialist` constraint. It does not rewrite the plan, and this experiment never executes a plan.

The evaluation oracle supplies `onlySpecialist` for the five named-HR prompts. Production code does not yet infer that constraint from the user text, and this experiment did not add a plan field for it.

## Prompts

Five variations of each required behavior. Identity is part of the instructions, not a routing table. Alex is Employee. Jordan is IT Support.

| Id | Behavior the check expects |
| --- | --- |
| A1 | IT then HR, no edge. VPN connection, then vacation approval. Alex. |
| A2 | HR then IT, no edge. Parental-leave window, then a loud laptop fan. Alex. |
| A3 | IT then HR, no edge. Outlook reconnect, then resignation notice. Alex. |
| A4 | HR then IT, no edge, even though both parts mention VPN. Policy for VPN during parental leave, then whether the VPN service is up. Alex. |
| A5 | IT headset task and HR bereavement task, no edge, despite "IT should handle everything." Alex. |
| B1 | HR equipment-profile task, then IT configuration depending on that fact. Jordan. |
| B2 | HR laptop-build policy, then IT setup depending on that build. Jordan. |
| B3 | IT configuration is raised first and the profile second, but IT still depends on the HR fact. Jordan. |
| B4 | IT is named first and HR second, with "only after HR." IT order 1, HR order 2, IT depends on HR. Jordan. |
| B5 | "Skip HR" is misleading. HR still produces the entitlement, and IT depends on it. Jordan. |
| C1–C5 | Jordan asks HR to reset a password and not to use IT. One HR task, no IT task, no edge. |

The request strings are stored with each result.

## Commands and test results

From `experiments/openai-workers`, with Node 22 on `PATH`:

```sh
npx tsc --noEmit
npx vitest run test/plan.spec.ts
node scripts/save-report.mjs
npx vitest run test/planning.eval.spec.ts
```

`tsc --noEmit` passed. The deterministic file passed **12 tests**. The live file passed **1 test** in 111.62 seconds. That test performed 30 planning calls and one repair call. It asserts the captured transport settings listed above. It does not assert that every plan is semantically correct. Those scores are in the evidence file.

`npm test` was not rerun, so the Experiment 2 model calls were not repeated.

## Medium and low

Input tokens were the same for each prompt at both efforts. Totals are for the 15 calls at that effort.

| | Medium | Low |
| --- | ---: | ---: |
| Schema-valid | 15 / 15 | 15 / 15 |
| Structurally executable | 15 / 15 | 15 / 15 |
| Semantic match to the oracle | 13 / 15 | 12 / 15 |
| Independent, two specialists, no edge | 4 / 5 | 4 / 5 |
| Dependent, IT depends on the HR fact | 5 / 5 | 5 / 5 |
| Named HR only | 5 / 5 | 5 / 5 |
| Latency min / median / max | 2.25s / 3.90s / 8.98s | 2.25s / 2.79s / 4.21s |
| Latency sum | 61.45s | 45.46s |
| Input / output / reasoning tokens | 8123 / 1902 / 712 | 8123 / 1248 / 42 |

No call approached the 45-second plan cap. The slowest medium call was B5 at 8.98 seconds.

Strict semantic misses:

| Call | Oracle issue | What the plan actually did |
| --- | --- | --- |
| A5 medium and A5 low | `specialist` | Two IT tasks. The bereavement objective says it is honoring "IT should handle everything." Headset routing was correct. No dependency was added. |
| B3 medium and B3 low | `order` | Specialists and the dependency are right: HR has the profile task, IT depends on `policy` for the equipment-profile fact. `order` follows that execution sequence (HR 1, IT 2), not the sentence, which asks about configuration first. |
| B4 low | `order` | The same dependency is right, but both tasks use `order: 1`. Medium B4 used IT order 1 and HR order 2 while keeping the dependency. |

A1, A2, A3, and A4 matched at both efforts. A4 did not invent a dependency between the leave-policy question and the service-status question. B1, B2, and B5 matched at both efforts. B5 did not skip HR. All ten named-HR plans contain one HR task and no IT task.

The named-HR objectives also tell HR to explain that it cannot reset passwords. That sentence is in the planner instructions, which say HR cannot reset passwords. It is not a permission check, and it is not evidence that scenario 6 passed. Execution would still have to call HR without the reset tool. This experiment did not call HR.

## Repair

No live plan failed structural validation, so the repair call used a synthetic cycle: an IT task and an HR task each depending on the other, for "Is the VPN service up?" `validatePlan` reported `cycle` before the call. One medium repair returned a single IT task, order 1, with `dependsOn: []`. `accepted` is true. `executed` is false. The call took 2.57 seconds, 657 input tokens, 39 output tokens, and 0 reasoning tokens. It was `POST /v1/responses` for `gpt-6.1-sol`, `store: false`, effort `medium`, with no tools and no temperature or top-p.

A separate unit test passes a valid IT-only plan through `executionGate` with `onlySpecialist: "hr"`. The gate returns `named_specialist` and leaves the plan unchanged. Nothing in the repair path rewrites a specialist or executes a rejected plan.

## What the failures mean

A5 is a prompt-scope failure, repeated at both efforts. The instructions say to honor an explicit request to give work to one specialist. The model applied that rule to "IT should handle everything" and assigned the bereavement question to IT. A1–A4 show that it can split independent IT and HR work when that sentence is absent. This is not a schema failure and not a reason to add keyword routing. The architecture rule we need is narrower: do not replace a specialist the user named for a request, as in C1–C5. A blanket "handle everything" should not pull in a separate policy question.

B3 is a field-semantics failure, also repeated at both efforts. The dependency the scheduler would run is correct. `order` was used as execution order. Medium did not fix it. The field description should say that `order` is the position in the user's message and is independent of `dependsOn`.

B4 low is the one place effort changed the plan shape. Low kept the correct edge and collapsed both positions to 1. Medium preserved both the edge and the two positions. That is a real, narrow advantage for medium on this set.

None of these failures require a new agent, a new plan field, or a change to who enforces authorization. C1–C5 already kept the plan on HR while the instructions told the model that IT is the specialist that can reset passwords.

## Recommended effort

Keep the plan call at **medium**.

Low matched medium on specialist choice and on every dependent edge, including the misleading "skip HR" prompt. It did not repair A5 or B3, and it lost distinct `order` values on B4. Across these 15 prompts, medium took about 16 seconds longer than low and reported 654 more output tokens and 670 more reasoning tokens. The slowest call was 8.98 seconds. That does not justify moving the plan call to `high`. It also does not justify switching the plan call to `low` on this evidence.

## Smallest follow-up

Do not rerun all thirty calls yet. Change two sentences in the planner instructions: `order` is not execution order, and "handle everything" does not reassign a separate policy question. Then rerun A5, B3, and B4 at both efforts, plus C1 at both efforts to check that the narrower wording still leaves the password request on HR. That is eight calls. Add a scheduler field or a keyword rule only if that rerun still assigns the bereavement question to IT or still substitutes IT for a named HR reset.

## Verdict

PARTIALLY PASSED for the tested prompts. All 30 plans were schema-valid and structurally executable. The required independent, dependent, and named-HR examples (A1, B1, C1) were correct at both efforts. The repeated gaps are the A5 specialist assignment and the `order` field on B3, plus one low-effort order collision on B4. This does not measure specialist execution, concurrency, authorization, or the seven application scenarios.

The verdict above is the original run. The review below does not replace these scores.

## Targeted review

The original A5 and B3 checks were not a sound reading of the plans. The planner instructions and the `order` description were ambiguous, so both were narrowed. The scheduler was not changed, and no example prompt was added to it.

### Routing rule

Scenario 6 asks the HR specialist to reset a password and expects that request to stay with HR even though HR cannot reset passwords. The scheduler must not add IT afterward.

The same rule covers A5. "IT should handle everything" explicitly assigns every part of that message to IT, including the bereavement question. Routing bereavement to HR would override that instruction. The original oracle did that, and the model did not. Both medium and low A5 plans were two IT tasks, with the second objective saying it was following the explicit instruction. That matches scenario 6.

The consistent rule is:

**An explicit assignment, or an explicit exclusion, applies to every part it covers. Do not move a covered part to the specialist who has the capability, and do not add a ruled-out specialist. An instruction that does not cover a part leaves that part to be assigned by subject.**

The old instruction that said to add a policy task anyway, when the user claimed the other specialist already knew the fact, contradicted this. It was removed. Subject routing still applies when the user names nobody.

### What `order` means

`order` is the position of the user-facing part being answered. It is not execution sequence, and it is not the order of clauses inside one question. `dependsOn` is the only execution edge. A task that only supplies a fact for a user-facing part uses that part's `order`.

B3 is one question: how to configure the laptop for the entitled profile. The original check required IT at position 1 and HR at position 2 because "configure" appears first in the sentence. That treats one question as two. The observed plans had the right specialists and the right dependency, and numbered HR 1 and IT 2, which is execution order. Under the corrected definition, both tasks should share one position. B4's "only after HR" is the same kind of fact constraint unless the user actually asked two questions. The original medium plan's distinct positions, and the low plan's shared position, were being scored against an unclear field.

### Instruction change

The specialist list is unchanged. The rules now say that an explicit assignment or exclusion covers only the parts it names, that a ruled-out specialist is not added, and that `order` is the user-facing position rather than execution sequence. The schema description of `order` says the same thing. No business-specific handoff field was added.

### Review run

Nine real medium calls, inside workerd, with the revised instructions. The evidence is `docs/experiments/004-planning-review.json`. The original `004-planning-results.json` still has the 30 calls.

`npx tsc --noEmit` passed. `npx vitest run test/plan.spec.ts` passed **14 tests**, including checks that a shared-order dependent plan matches the corrected B3 rule and that replacing the bereavement task with HR fails the explicit-IT rule. `npx vitest run test/planning.review.spec.ts` passed **1 test** in 39.04 seconds. That test checks transport only: `POST /v1/responses`, `gpt-6.1-sol`, `store: false`, effort `medium`, no temperature, no top-p, and no tools. Semantic scores are below, not inside that pass.

The nine calls used 5190 input tokens and 1114 output tokens, of which 344 were reasoning tokens. Latency was 36.81 seconds in total, median 3.26 seconds, maximum 6.68 seconds.

| Call | What was checked | Result |
| --- | --- | --- |
| R-A5 | The original A5 wording. Both parts stay with IT. | Matched. Headset at order 1, bereavement at order 2, both `it`, no edge. |
| R-A5b | Paraphrase: "Have IT take care of all of this," monitor plus sick days. | Matched. Both tasks `it`. |
| R-split | IT is named only for the headset. Bereavement is a separate question. | Matched. IT order 1, HR order 2, no edge. |
| R-named-hr | Scenario 6 wording, Jordan. | Matched. One HR task. No IT task. |
| R-exclude-hr | "Do not ask HR" plus a policy-based laptop setup. | HR was not added. The check still failed. |
| R-B3 | The original B3 wording. One question, shared order, IT depends on the HR fact. | Matched. Both tasks are order 1. IT depends on the policy task for the equipment profile. |
| R-B3b | Paraphrase of that single question. | Matched, same shape. |
| R-B4 | The original B4 wording. | Specialists and dependency matched. The order check failed. |
| R-two-questions | VPN, then vacation approval. | Matched. IT order 1, HR order 2, no edge. |

R-exclude-hr produced two IT tasks at order 1. The configuration task depends on an IT task whose objective is to determine the policy entitlement without HR. The deterministic check expected one IT task and no dependency, so it recorded `unnecessary_task` and `unnecessary_dependency`. That check was stricter than the routing rule. The rule required only that HR not be added, and HR was not added.

R-B4 put both the HR confirmation and the IT configuration at order 1, with IT depending on the policy-confirmed profile. The check expected HR at order 2 because the sentence names HR. That expectation conflicts with the corrected definition: HR is supplying the fact for one configuration question, and "only after" is the dependency. The observed plan follows the revised instruction.

### Remaining limitation

When the user rules HR out and still asks for a setup that depends on policy, the planner keeps the exclusion and then asks IT to determine the entitlement. IT is not the policy specialist, and this experiment still does not give either specialist any tools. The objective is not permission to retrieve policy. A later scheduler must not add HR to repair that gap, and must not treat the objective as a grant. On these nine calls, that was the reliability limit that remained. `order` distinguished two real questions from a fact-only predecessor, but this set is too small to treat that as settled for every prompt.

Named-HR objectives still say that HR cannot reset the password. That sentence is in the specialist description. It is not a permission decision.

### Review conclusion

For this experiment's limited scope, the planning behavior can be considered **PASSED**. The first run's partial score came from checks that disagreed with scenario 6 and from an `order` field that mixed question position with execution. The required shapes, explicit specialist assignment, and a single-question handoff held under the corrected rule. The exclusion case shows the remaining limit above. This still does not execute specialists or cover the seven application scenarios.
