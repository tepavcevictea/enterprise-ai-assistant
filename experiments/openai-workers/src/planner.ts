import { createOpenAI, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import {
  executionGate,
  PLAN_MODEL,
  planSchema,
  validatePlan,
  type Plan,
  type PlanErrorCode,
} from "./plan";
import type { DemoIdentity } from "./planning-cases";
import { summarizeRequest, type ObservedRequest } from "./transport";

export type ReasoningEffort = "low" | "medium";

export function plannerInstructions(identity: DemoIdentity): string {
  return [
    "You write a task plan for a three-agent enterprise assistant. You do not answer the user, call tools, grant permissions, or invent agents.",
    "Specialists you may assign:",
    "- it: service status, troubleshooting, and device setup. This is the only specialist that can perform a simulated password reset.",
    "- hr: company policy, leave, and equipment entitlements. This specialist cannot reset passwords.",
    `Signed-in user: ${identity.id}, role ${identity.role}. The user's role does not choose the specialist.`,
    "Rules:",
    "- Assign only it or hr. Use at most four tasks.",
    "- If the user explicitly assigns a part to a specialist, or explicitly rules a specialist out, follow that for every part the instruction covers. Do not move a covered part to the specialist who has the capability, and do not add a ruled-out specialist. An instruction that does not cover a part does not change that part.",
    "- When the user names no specialist, assign each user-facing part by subject.",
    "- id is a unique short lowercase string.",
    "- order is the position of the user-facing part this task answers, starting at 1 in the order the user raised those parts. A task that only supplies a fact for that part uses the same order. order is not execution sequence.",
    "- dependsOn is empty when the task needs no fact produced by another task in this plan. When it does, dependsOn has one entry: that task's id and a short specific name of the fact in information. Do not add a dependency only to sequence work.",
  ].join("\n");
}

export function repairInstructions(identity: DemoIdentity): string {
  return [
    plannerInstructions(identity),
    "The previous plan was rejected by application code. Return one corrected plan for the same request.",
    "Fix the listed errors. Do not add a specialist the user ruled out. Do not answer the user.",
  ].join("\n");
}

export function providerOptions(effort: ReasoningEffort): {
  openai: OpenAILanguageModelResponsesOptions;
} {
  return {
    openai: {
      reasoningEffort: effort,
      store: false,
    },
  };
}

export type PlanCallResult = {
  executed: false;
  schemaValid: boolean;
  plan: Plan | null;
  validationErrors: PlanErrorCode[];
  gateError: "named_specialist" | null;
  usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
    reasoningTokens: number | undefined;
  };
  latencyMs: number;
  transport: ObservedRequest | null;
  error: string | null;
  rejectedText: string | null;
};

export async function planRequest(options: {
  apiKey: string;
  effort: ReasoningEffort;
  identity: DemoIdentity;
  request: string;
  fetchImpl?: typeof fetch;
}): Promise<PlanCallResult> {
  return callPlanner({
    ...options,
    system: plannerInstructions(options.identity),
    prompt: options.request,
    onlySpecialist: null,
  });
}

export async function repairPlan(options: {
  apiKey: string;
  effort: ReasoningEffort;
  identity: DemoIdentity;
  request: string;
  rejected: unknown;
  errors: readonly string[];
  onlySpecialist: "it" | "hr" | null;
  fetchImpl?: typeof fetch;
}): Promise<PlanCallResult> {
  const result = await callPlanner({
    apiKey: options.apiKey,
    effort: options.effort,
    identity: options.identity,
    request: options.request,
    system: repairInstructions(options.identity),
    prompt: [
      "Request:",
      options.request,
      "",
      "Rejected plan:",
      JSON.stringify(options.rejected),
      "",
      "Errors:",
      ...options.errors,
    ].join("\n"),
    onlySpecialist: options.onlySpecialist,
    fetchImpl: options.fetchImpl,
  });
  return result;
}

async function callPlanner(options: {
  apiKey: string;
  effort: ReasoningEffort;
  identity: DemoIdentity;
  request: string;
  system: string;
  prompt: string;
  onlySpecialist: "it" | "hr" | null;
  fetchImpl?: typeof fetch;
}): Promise<PlanCallResult> {
  const observed: ObservedRequest[] = [];
  const started = performance.now();
  try {
    const result = await generateText({
      model: createOpenAI({
        apiKey: options.apiKey,
        fetch: observingFetch(observed, options.fetchImpl ?? fetch),
      }).responses(PLAN_MODEL),
      maxRetries: 1,
      providerOptions: providerOptions(options.effort),
      output: Output.object({ schema: planSchema }),
      system: options.system,
      prompt: options.prompt,
    });
    const latencyMs = Math.round(performance.now() - started);
    const parsed = planSchema.safeParse(result.output);
    const validation = parsed.success ? validatePlan(parsed.data) : validatePlan(result.output);
    const plan = parsed.success ? parsed.data : null;
    const gate =
      validation.ok
        ? executionGate(validation.plan, { onlySpecialist: options.onlySpecialist })
        : null;
    return {
      executed: false,
      schemaValid: parsed.success,
      plan,
      validationErrors: validation.ok ? [] : validation.errors,
      gateError: gate !== null && !gate.ok ? gate.error : null,
      usage: usageOf(result.totalUsage),
      latencyMs,
      transport: observed.at(-1) ?? null,
      error: null,
      rejectedText: null,
    };
  } catch (error) {
    return {
      executed: false,
      schemaValid: false,
      plan: null,
      validationErrors: [],
      gateError: null,
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
        reasoningTokens: undefined,
      },
      latencyMs: Math.round(performance.now() - started),
      transport: observed.at(-1) ?? null,
      error: redact(error instanceof Error ? error.message : "unknown error"),
      rejectedText: rejectedText(error),
    };
  }
}

function usageOf(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  outputTokenDetails: { reasoningTokens: number | undefined };
}): PlanCallResult["usage"] {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
  };
}

function observingFetch(observed: ObservedRequest[], inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? request?.headers);
    const body = await readBody(input, init);
    observed.push(
      summarizeRequest(url, init?.method ?? request?.method ?? "GET", headers, body, init?.signal ?? undefined),
    );
    return inner(input, init);
  };
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
  if (typeof init?.body === "string") return init.body;
  if (init?.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
  if (input instanceof Request) {
    const text = await input.clone().text();
    return text === "" ? undefined : text;
  }
  return undefined;
}

function redact(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
}

function rejectedText(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("text" in error)) return null;
  const text = error.text;
  if (typeof text !== "string" || text === "") return null;
  return redact(text).slice(0, 2000);
}
