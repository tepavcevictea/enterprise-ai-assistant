import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { AgentId } from "./capabilities";
import { permits } from "./capabilities";
import type { DemoUser, DemoUserId } from "./identity";
import {
  PLAN_MODEL,
  planSchema,
  plannerInstructions,
  repairInstructions,
  validatePlan,
  type Plan,
} from "./plan";
import { runServiceStatus, SERVICE_IDS, type ServiceStatus } from "./status";
import type { TraceEvent } from "./trace";
import { traceEvent } from "./trace";

export type HistoryRow = { agent: string; body: string };

export type ModelPort = {
  plan(input: {
    user: DemoUser;
    message: string;
    history: HistoryRow[];
    signal: AbortSignal;
  }): Promise<{ ok: true; plan: Plan; repaired: boolean } | { ok: false; errors: string[] }>;
  runIt(input: {
    user: DemoUser;
    objective: string;
    history: HistoryRow[];
    notes: { information: string; value: string }[];
    signal: AbortSignal;
    trace: (event: TraceEvent) => void;
    base: { sessionId: string; turnId: string; taskId: string };
  }): Promise<{ text: string; statuses: ServiceStatus[] }>;
  synthesize(input: { statusLine: string; notes: string; signal: AbortSignal }): Promise<string>;
};

const serviceInput = z.object({
  serviceId: z.enum(SERVICE_IDS),
});

export function modelPort(env: Cloudflare.Env): ModelPort {
  if (env.MODEL_MODE === "stub") return stubPort;
  return livePort(env.OPENAI_API_KEY);
}

const stubPort: ModelPort = {
  plan: async () => ({
    ok: true,
    repaired: false,
    plan: {
      tasks: [
        {
          id: "status",
          specialist: "it",
          objective: "Check whether the VPN service is operational.",
          order: 1,
          dependsOn: [],
        },
      ],
    },
  }),
  runIt: async ({ user, trace, base }) => {
    trace(traceEvent(base, { agentId: "it", taskId: base.taskId, eventType: "tool.offered", toolId: "getServiceStatus", authorization: "allowed" }));
    const status = runServiceStatus({ userId: user.id, agent: "it", serviceId: "vpn" });
    if (!status.ok) {
      trace(traceEvent(base, { agentId: "it", taskId: base.taskId, eventType: "tool.denied", toolId: "getServiceStatus", authorization: "denied", errorCode: status.error }));
      return { text: "The service status tool was denied.", statuses: [] };
    }
    trace(traceEvent(base, { agentId: "it", taskId: base.taskId, eventType: "tool.invoked", toolId: "getServiceStatus", authorization: "allowed", sourceIds: [status.status.serviceId] }));
    trace(traceEvent(base, { agentId: "it", taskId: base.taskId, eventType: "tool.result", toolId: "getServiceStatus", authorization: "allowed", outcome: "success", result: status.status.detail, sourceIds: [status.status.serviceId] }));
    return { text: "Status checked.", statuses: [status.status] };
  },
  synthesize: async () => "Here is the explanation.",
};

function livePort(apiKey: string | undefined): ModelPort {
  return {
    plan: (input) => livePlan(apiKey, input),
    runIt: (input) => liveIt(apiKey, input),
    synthesize: (input) => liveSynthesis(apiKey, input),
  };
}

async function livePlan(
  apiKey: string | undefined,
  input: { user: DemoUser; message: string; history: HistoryRow[]; signal: AbortSignal },
): Promise<{ ok: true; plan: Plan; repaired: boolean } | { ok: false; errors: string[] }> {
  const key = configuredKey(apiKey);
  if (key === undefined) return { ok: false, errors: ["missing_api_key"] };
  const prior = input.history
    .filter((row) => row.agent === "orchestrator")
    .slice(-8)
    .map((row) => row.body)
    .join("\n");
  const prompt = `${prior}\n\nUser:\n${input.message}`.trim();
  const first = await planCall(key, plannerInstructions(input.user), prompt, input.signal, "medium");
  if (first.ok) return { ok: true, plan: first.plan, repaired: false };
  const repairPrompt = `${prompt}\n\nRejected plan errors:\n${first.errors.join("\n")}`;
  const second = await planCall(key, repairInstructions(input.user), repairPrompt, input.signal, "medium");
  if (second.ok) return { ok: true, plan: second.plan, repaired: true };
  return second;
}

async function planCall(
  apiKey: string,
  system: string,
  prompt: string,
  signal: AbortSignal,
  effort: "low" | "medium",
): Promise<{ ok: true; plan: Plan } | { ok: false; errors: string[] }> {
  try {
    const result = await generateText({
      model: createOpenAI({ apiKey }).responses(PLAN_MODEL),
      maxRetries: 1,
      abortSignal: boundedSignal(signal),
      providerOptions: { openai: { reasoningEffort: effort, store: false } },
      output: Output.object({ schema: planSchema }),
      system,
      prompt,
    });
    const validation = validatePlan(result.output);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    return { ok: true, plan: validation.plan };
  } catch (error) {
    return { ok: false, errors: [redact(error instanceof Error ? error.message : "plan_failed")] };
  }
}

async function liveIt(
  apiKey: string | undefined,
  input: {
    user: DemoUser;
    objective: string;
    history: HistoryRow[];
    notes: { information: string; value: string }[];
    signal: AbortSignal;
    trace: (event: TraceEvent) => void;
    base: { sessionId: string; turnId: string; taskId: string };
  },
): Promise<{ text: string; statuses: ServiceStatus[] }> {
  const key = configuredKey(apiKey);
  if (key === undefined) return { text: "The IT specialist could not be called.", statuses: [] };
  const allowed = permits(input.user.id, "it", "service_status");
  const statuses: ServiceStatus[] = [];
  input.trace(
    traceEvent(input.base, {
      agentId: "it",
      taskId: input.base.taskId,
      eventType: allowed ? "tool.offered" : "tool.denied",
      toolId: "getServiceStatus",
      authorization: allowed ? "allowed" : "denied",
      errorCode: allowed ? undefined : "denied",
    }),
  );
  const tools = allowed
    ? {
        getServiceStatus: tool({
          description: "Return the fictional status of one known company service: vpn, email, or wifi.",
          inputSchema: serviceInput,
          execute: (toolInput) => {
            const status = runServiceStatus({
              userId: input.user.id,
              agent: "it",
              serviceId: toolInput.serviceId,
            });
            input.trace(
              traceEvent(input.base, {
                agentId: "it",
                taskId: input.base.taskId,
                eventType: "tool.invoked",
                toolId: "getServiceStatus",
                authorization: status.authorization,
                sourceIds: [toolInput.serviceId],
                errorCode: status.ok ? undefined : status.error,
              }),
            );
            if (!status.ok) return { error: status.error };
            statuses.push(status.status);
            input.trace(
              traceEvent(input.base, {
                agentId: "it",
                taskId: input.base.taskId,
                eventType: "tool.result",
                toolId: "getServiceStatus",
                authorization: "allowed",
                outcome: "success",
                result: status.status.detail,
                sourceIds: [status.status.serviceId],
              }),
            );
            return status.status;
          },
        }),
      }
    : undefined;
  const prior = input.history
    .filter((row) => row.agent === "it")
    .slice(-8)
    .map((row) => row.body)
    .join("\n");
  const notes = input.notes.map((note) => `${note.information}: ${note.value}`).join("\n");
  const result = await generateText({
    model: createOpenAI({ apiKey: key }).responses(PLAN_MODEL),
    maxRetries: 1,
    abortSignal: boundedSignal(input.signal),
    providerOptions: { openai: { reasoningEffort: "low", store: false } },
    stopWhen: stepCountIs(4),
    system: [
      "You are the IT specialist. Return a result to the orchestrator. You do not speak to the user directly.",
      "When the assignment asks whether a service is operational, up, or down, call getServiceStatus once with the matching service id before answering.",
      "Quote the tool result's detail field. Do not invent a status.",
      "You have no HR policy tool.",
    ].join("\n"),
    prompt: [`Assignment: ${input.objective}`, prior, notes].filter((part) => part !== "").join("\n\n"),
    tools,
  });
  return { text: result.text, statuses };
}

async function liveSynthesis(
  apiKey: string | undefined,
  input: { statusLine: string; notes: string; signal: AbortSignal },
): Promise<string> {
  const key = configuredKey(apiKey);
  if (key === undefined) return "";
  const result = await generateText({
    model: createOpenAI({ apiKey: key }).responses(PLAN_MODEL),
    maxRetries: 1,
    abortSignal: boundedSignal(input.signal),
    providerOptions: { openai: { reasoningEffort: "low", store: false } },
    system:
      "You write the user-facing explanation. The status line is already decided. Do not contradict it, and do not claim a tool ran unless the notes say it did. You have no tools.",
    prompt: `Status line:\n${input.statusLine}\n\nSpecialist notes:\n${input.notes}`,
  });
  return result.text;
}

function boundedSignal(parent: AbortSignal): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(45_000)]);
}

function configuredKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  if (key === undefined || key === "" || key === "replace-me") return undefined;
  return key;
}

function redact(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300);
}

export function offeredToolIds(userId: DemoUserId, agent: AgentId): string[] {
  if (agent === "it" && permits(userId, agent, "service_status")) return ["getServiceStatus"];
  return [];
}
