# First Cursor prompt: independent architecture review only

You are a skeptical staff-level AI/backend engineer reviewing a senior AI engineer take-home assignment. This is a design-review task, NOT an implementation task. Treat me as an experienced engineer whose choices could still be wrong. I want real criticism, not agreement.

## Read first

1. Find and read the complete 4-page TX Services PDF in this folder, titled `Senior AI EngineerCoding Challenge_ Small Enterprise AI Assistant(1).pdf` (or the same title with a similar filename). Inspect all pages, especially the seven required scenarios and the last-page deliverables. It is the authoritative specification.
2. Read `ARCHITECTURE_DECISIONS.md` completely. This describes our *proposed*, not implemented, design.
3. If either document cannot be read, say which one and stop; do not pretend you read it.

## Ground rules

- Do not create source code, install packages, scaffold a project, initialize Git, change project files, or generate the final ADR yet. Return your independent assessment **in chat only**.
- Critically compare our design with every requirement in the PDF. Distinguish hard requirements, our preferences, and ideas that add scope.
- The PDF's eight-hour timebox is part of the external specification, although I track active development time independently. Do not silently ignore or rewrite an explicit requirement; do not invent or report hours.
- Verify version-sensitive claims using current official documentation when browsing is available: OpenAI model/tool APIs, Vercel AI SDK, Cloudflare Workers/Durable Objects/Agents SDK, MCP transport, and Cloudflare Vitest. Cite official documentation links for substantial technical objections. If browsing isn't available, mark claims as **unverified** rather than guessing.
- No invented APIs, fake benchmarks, unnecessary frameworks, fabricated security guarantees, or claims of having run code/tests. Treat references in the architecture document as leads to verify, not as proof.
- Prefer the smallest correct design with readable, maintainable, strict TypeScript. Push back strongly against hardcoding business logic across the codebase, overabstraction, and implementing optional infrastructure that doesn't improve required behavior.

## Review questions (challenge all of them)

1. **Requirements coverage:** Can this design genuinely pass ALL seven scenarios using a *real LLM*, with trace evidence of IT skill loading/application, native tool usage, MCP discovery/invocation, concurrent/dependent tasks, both permission dimensions, and simulated MCP failure? Is there any hidden fourth agent or missing independent message history?
2. **Architecture selection:** Independently compare (A) plain Worker + AI SDK + conversation Durable Object, (B) Cloudflare Agents SDK/agents-as-tools, and (C) a supported graph/orchestration library. Which creates the fewest moving parts *after* state isolation, MCP, retries, logging, and permissions are included? Is our choice of A actually justified? Challenge the need for a task DAG and Durable Object. Don't adopt a framework just for branding.
3. **Agent plan correctness:** Can a model-generated plan be validated and scheduled without accidental serial execution, cycles, duplicate task IDs, missing prerequisites or uncontrolled recursion? How should independent tasks, dependent tasks, multiple tasks targeting the same specialist, and partial failures work? Should clarification happen before or after partial execution?
4. **Trust boundaries:** Is `user capability ∩ agent capability ∩ resource policy` enforced at tool advertisement AND execution? Can spoofed demo identity headers, guessed conversation IDs, role switching, forged MCP results, or retrieval metadata reveal restricted data? How can the MCP service trust the caller's user context? Does scenario 6 actually demonstrate that HR lacks an IT capability rather than silently rerouting?
5. **State and concurrency:** A Durable Object permits async interleaving. Can two turns reserve the same conversation, can a lease expire while the old request is still running, can a late result overwrite newer history, and can retries duplicate a simulated reset? Are separate agent histories genuinely separate across turns and user switches? Are state persistence and retention sensible?
6. **Tool/skill integration:** Is the native tool input/output genuinely validated? Does the MCP connection use a real MCP protocol with discovery and invocation in local Cloudflare execution? Is on-demand skill loading really on-demand and provably applied, not preloaded prompt text or decorative logging? Are source documents and error modes deterministic?
7. **LLM model/provider:** Confirm `gpt-6.1-sol` compatibility with the correct OpenAI Responses API and the selected AI SDK release, including reasoning effort, structured output and tool calling. Are we selecting the right model and provider API? Is `gpt-6-luna` a defensible later measured optimization? What can break if AI SDK behavior changes?
8. **Reliability:** Do deadlines propagate? Are cancellation, retry, tool idempotency and partial success defined? Can specialists or MCP hang? Are errors classified without hallucinating success? Do we need a cost/token budget in addition to timeouts?
9. **Observability/security:** Do structured events prove concurrency and permission decisions without exposing secrets, private reasoning, restricted policy text or PII? Can an attacker use prompt injection inside MCP policy results to affect downstream tool calls? Are our proposed tests sufficient to demonstrate real invariants?
10. **Submission quality:** Is the README scope appropriate? Does extra documentation help or distract? Which features should be removed, simplified, or postponed while retaining an excellent senior-level submission?

## Required response format

**A. Verdict**: Choose `Approve`, `Approve with required changes`, or `Reject`. Give a concise rationale. Do not say "looks great" without evidence.

**B. Findings, ordered by severity**: For each P0/P1/P2 issue provide: specific defect or risk, the PDF requirement or engineering invariant affected, likelihood/consequence, concrete reproduction or counterexample, smallest credible correction, and official source if version-sensitive. Clearly distinguish blockers from optional improvements.

**C. PDF requirement audit**: A compact requirement-by-requirement table with `Covered / Partially covered / Missing / Unverified`, why, and how it will be proven. Include each of the seven demonstration scenarios separately.

**D. Architecture alternatives**: A candid A vs B vs C comparison, and an explicit final recommendation. Consider simplicity as well as built-in features; don't use hypothetical features as verified support.

**E. Feasibility checks**: A prioritized set of at most five small *future* technical spikes to resolve real uncertainties before full implementation. Specify what would count as pass/fail. Do not execute these yet.

**F. Recommended changes**: Propose the minimal edits to `ARCHITECTURE_DECISIONS.md` that would resolve the serious findings, ideally as a short diff-like list. Identify anything we should remove as overengineering.

**G. Open decisions**: Only genuinely blocking questions, not an indiscriminate list of preferences.

## Important

Stop after your review. Wait for my approval before editing the architecture decisions document, writing `docs/ADR-001.md`, scaffolding, or implementing anything.
