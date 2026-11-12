import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { AgentId } from "./capabilities";
import { permits } from "./capabilities";
import type { DemoUser, DemoUserId } from "./identity";
import {
  PLAN_MODEL,
  planSchema,
  plannerContext,
  plannerInstructions,
  repairInstructions,
  validatePlan,
  type Plan,
} from "./plan";
import { runHrSpecialist } from "./hr";
import { configuredMcpMode } from "./mcp/policy-client";
import type { McpMode } from "./mcp/pinned-fetch";
import type { Outcome } from "./schedule";
import { itInstructions, loadSkill, skillCatalog, skillNextStep } from "./skills";
import { runServiceStatus, SERVICE_IDS, type ServiceStatus } from "./status";
import { simulatePasswordReset, type PasswordResetRecord } from "./password";
import { taskAction, type TaskAction } from "./plan";
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
    action?: TaskAction;
    history: HistoryRow[];
    notes: { information: string; value: string }[];
    signal: AbortSignal;
    trace: (event: TraceEvent) => void;
    base: { sessionId: string; turnId: string; taskId: string };
  }): Promise<{ text: string; statuses: ServiceStatus[]; outcome: Outcome; reset?: PasswordResetRecord }>;
  runHr(input: {
    user: DemoUser;
    objective: string;
    message?: string;
    history: HistoryRow[];
    notes: { information: string; value: string }[];
    signal: AbortSignal;
    trace: (event: TraceEvent) => void;
    base: { sessionId: string; turnId: string; taskId: string };
  }): Promise<{ text: string; outcome: Outcome; report: string; handoff?: string }>;
  synthesize(input: { statusLine: string; notes: string; signal: AbortSignal }): Promise<string>;
};

const serviceInput = z.object({
  serviceId: z.enum(SERVICE_IDS),
});

export function modelPort(env: Cloudflare.Env, override?: { plan?: Plan; mcpMode?: McpMode }): ModelPort {
  if (env.MODEL_MODE === "stub") return stubPort(env, override);
  return livePort(env, override);
}

function stubPort(env: Cloudflare.Env, override?: { plan?: Plan; mcpMode?: McpMode }): ModelPort {
  const itPlan: Plan = {
    tasks: [
      {
        id: "status",
        specialist: "it",
        objective: "Check whether the VPN service is operational.",
        order: 1,
        dependsOn: [],
      },
    ],
  };
  return {
    plan: async () => ({
      ok: true,
      repaired: false,
      plan: override?.plan ?? itPlan,
    }),
    runIt: async ({ user, objective, action, trace, base, notes }) => {
      if (taskAction({ action }) === "password_reset") {
        const decision = simulatePasswordReset({ userId: user.id, agent: "it", turnId: base.turnId });
        trace(
          traceEvent(base, {
            agentId: "it",
            taskId: base.taskId,
            eventType: decision.ok ? "tool.offered" : "tool.denied",
            toolId: "simulatePasswordReset",
            authorization: decision.authorization,
            outcome: decision.ok ? undefined : "denied",
            errorCode: decision.ok ? undefined : decision.error,
          }),
        );
        if (!decision.ok) return { text: "The password reset was denied.", statuses: [], outcome: "denied" };
        const again = simulatePasswordReset({ userId: user.id, agent: "it", turnId: base.turnId });
        trace(traceEvent(base, { agentId: "it", taskId: base.taskId, eventType: "tool.invoked", toolId: "simulatePasswordReset", authorization: "allowed", sourceIds: [user.id] }));
        trace(
          traceEvent(base, {
            agentId: "it",
            taskId: base.taskId,
            eventType: "tool.result",
            toolId: "simulatePasswordReset",
            authorization: "allowed",
            outcome: "success",
            result: decision.record.detail,
            sourceIds: [user.id],
          }),
        );
        return {
          text: decision.record.detail,
          statuses: [],
          outcome: again.ok && again.record.detail === decision.record.detail ? "success" : "failed",
          reset: decision.record,
        };
      }
      if (notes.length > 0) {
        return { text: notes.map((note) => note.value).join("\n"), statuses: [], outcome: "success" };
      }
      const canLoad = permits(user.id, "it", "troubleshooting");
      trace(
        traceEvent(base, {
          agentId: "it",
          taskId: base.taskId,
          eventType: canLoad ? "tool.offered" : "tool.denied",
          toolId: "loadSkill",
          authorization: canLoad ? "allowed" : "denied",
          errorCode: canLoad ? undefined : "denied",
        }),
      );
      const referenced = skillCatalog().find((skill) => objective.includes(skill.id));
      let procedure = "";
      if (referenced !== undefined) {
        const loaded = loadSkill({ userId: user.id, agent: "it", skillId: referenced.id });
        trace(
          traceEvent(base, {
            agentId: "it",
            taskId: base.taskId,
            eventType: loaded.ok ? "skill.loaded" : "skill.denied",
            toolId: referenced.id,
            authorization: loaded.authorization,
            outcome: loaded.ok ? "success" : "denied",
            errorCode: loaded.ok ? undefined : loaded.error,
            sourceIds: loaded.ok ? [loaded.skillId] : undefined,
          }),
        );
        if (!loaded.ok) {
          return {
            text: "The skill could not be loaded.",
            statuses: [],
            outcome: loaded.error === "denied" ? "denied" : "failed",
          };
        }
        procedure = loaded.body;
      }
      const allowed = permits(user.id, "it", "service_status");
      trace(
        traceEvent(base, {
          agentId: "it",
          taskId: base.taskId,
          eventType: allowed ? "tool.offered" : "tool.denied",
          toolId: "getServiceStatus",
          authorization: allowed ? "allowed" : "denied",
          errorCode: allowed ? undefined : "denied",
        }),
      );
      const status = runServiceStatus({ userId: user.id, agent: "it", serviceId: "vpn" });
      if (!status.ok) {
        trace(
          traceEvent(base, {
            agentId: "it",
            taskId: base.taskId,
            eventType: "tool.denied",
            toolId: "getServiceStatus",
            authorization: "denied",
            errorCode: status.error,
          }),
        );
        return {
          text: "The service status tool was denied.",
          statuses: [],
          outcome: status.error === "denied" ? "denied" : "failed",
        };
      }
      trace(traceEvent(base, { agentId: "it", taskId: base.taskId, eventType: "tool.invoked", toolId: "getServiceStatus", authorization: "allowed", sourceIds: [status.status.serviceId] }));
      trace(traceEvent(base, { agentId: "it", taskId: base.taskId, eventType: "tool.result", toolId: "getServiceStatus", authorization: "allowed", outcome: "success", result: status.status.detail, sourceIds: [status.status.serviceId] }));
      const nextStep = procedure === "" ? "" : skillNextStep(procedure, status.status.state);
      const text = nextStep === "" ? "Status checked." : `${status.status.detail}\n\n${nextStep}`;
      return { text, statuses: [status.status], outcome: "success" };
    },
    runHr: (hrInput) =>
      runHrSpecialist({
        transport: "direct",
        binding: env.POLICY,
        mode: override?.mcpMode,
        ...hrInput,
      }),
    synthesize: async () => "Here is the explanation.",
  };
}

function livePort(env: Cloudflare.Env, override?: { mcpMode?: McpMode }): ModelPort {
  const apiKey = env.OPENAI_API_KEY;
  return {
    plan: (input) => livePlan(apiKey, input),
    runIt: (input) => liveIt(apiKey, input),
    runHr: (input) =>
      runHrSpecialist({
        transport: "model",
        apiKey,
        binding: env.POLICY,
        mode: override?.mcpMode ?? configuredMcpMode(env.MCP_MODE),
        ...input,
      }),
    synthesize: (input) => liveSynthesis(apiKey, input),
  };
}

async function livePlan(
  apiKey: string | undefined,
  input: { user: DemoUser; message: string; history: HistoryRow[]; signal: AbortSignal },
): Promise<{ ok: true; plan: Plan; repaired: boolean } | { ok: false; errors: string[] }> {
  const key = configuredKey(apiKey);
  if (key === undefined) return { ok: false, errors: ["missing_api_key"] };
  const prompt = plannerContext(input.history, input.message);
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

async function liveReset(
  apiKey: string,
  input: {
    user: DemoUser;
    objective: string;
    history: HistoryRow[];
    signal: AbortSignal;
    trace: (event: TraceEvent) => void;
    base: { sessionId: string; turnId: string; taskId: string };
  },
): Promise<{ text: string; statuses: ServiceStatus[]; outcome: Outcome; reset?: PasswordResetRecord }> {
  const allowed = modelToolIds(input.user.id, "it", "password_reset").includes("simulatePasswordReset");
  input.trace(
    traceEvent(input.base, {
      agentId: "it",
      taskId: input.base.taskId,
      eventType: allowed ? "tool.offered" : "tool.denied",
      toolId: "simulatePasswordReset",
      authorization: allowed ? "allowed" : "denied",
      errorCode: allowed ? undefined : "denied",
    }),
  );
  if (!allowed) return { text: "The password reset was denied.", statuses: [], outcome: "denied" };
  let reset: PasswordResetRecord | undefined;
  try {
    const result = await generateText({
      model: createOpenAI({ apiKey }).responses(PLAN_MODEL),
      maxRetries: 1,
      abortSignal: boundedSignal(input.signal),
      providerOptions: { openai: { reasoningEffort: "low", store: false } },
      stopWhen: stepCountIs(4),
      system: [
        itInstructions(),
        "This assignment is a simulated password reset for the signed-in user.",
        "Call simulatePasswordReset once. The server chooses the target. Do not claim a real credential changed.",
      ].join("\n"),
      prompt: `Assignment: ${input.objective}`,
      tools: {
        simulatePasswordReset: tool({
          description: "Simulate a password reset for the signed-in user. The server chooses the target. This does not change a real credential.",
          inputSchema: z.object({}),
          execute: () => {
            const decision = simulatePasswordReset({ userId: input.user.id, agent: "it", turnId: input.base.turnId });
            input.trace(
              traceEvent(input.base, {
                agentId: "it",
                taskId: input.base.taskId,
                eventType: "tool.invoked",
                toolId: "simulatePasswordReset",
                authorization: decision.authorization,
                sourceIds: [input.user.id],
                errorCode: decision.ok ? undefined : decision.error,
              }),
            );
            if (!decision.ok) return { error: decision.error };
            reset = decision.record;
            input.trace(
              traceEvent(input.base, {
                agentId: "it",
                taskId: input.base.taskId,
                eventType: "tool.result",
                toolId: "simulatePasswordReset",
                authorization: "allowed",
                outcome: "success",
                result: decision.record.detail,
                sourceIds: [decision.record.targetUser],
              }),
            );
            return { simulation: true, detail: decision.record.detail };
          },
        }),
      },
    });
    if (reset === undefined) return { text: "The password reset did not run.", statuses: [], outcome: "failed" };
    return { text: result.text.trim() === "" ? reset.detail : result.text, statuses: [], outcome: "success", reset };
  } catch {
    return { text: "The IT specialist failed.", statuses: [], outcome: "failed" };
  }
}

async function liveIt(
  apiKey: string | undefined,
  input: {
    user: DemoUser;
    objective: string;
    action?: TaskAction;
    history: HistoryRow[];
    notes: { information: string; value: string }[];
    signal: AbortSignal;
    trace: (event: TraceEvent) => void;
    base: { sessionId: string; turnId: string; taskId: string };
  },
): Promise<{ text: string; statuses: ServiceStatus[]; outcome: Outcome; reset?: PasswordResetRecord }> {
  const key = configuredKey(apiKey);
  if (key === undefined) {
    return { text: "The IT specialist could not be called.", statuses: [], outcome: "failed" };
  }
  if (taskAction(input) === "password_reset") return liveReset(key, input);
  const allowed = permits(input.user.id, "it", "service_status");
  const statuses: ServiceStatus[] = [];
  let toolError: "denied" | "failed" | undefined;
  const canLoad = permits(input.user.id, "it", "troubleshooting");
  input.trace(
    traceEvent(input.base, {
      agentId: "it",
      taskId: input.base.taskId,
      eventType: canLoad ? "tool.offered" : "tool.denied",
      toolId: "loadSkill",
      authorization: canLoad ? "allowed" : "denied",
      errorCode: canLoad ? undefined : "denied",
    }),
  );
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
  const tools = {
    ...(canLoad
      ? {
          loadSkill: tool({
            description: "Return the procedure for one listed skill id. This does not grant tools or permissions.",
            inputSchema: z.object({ skillId: z.string().min(1) }),
            execute: (toolInput) => {
              const loaded = loadSkill({ userId: input.user.id, agent: "it", skillId: toolInput.skillId });
              input.trace(
                traceEvent(input.base, {
                  agentId: "it",
                  taskId: input.base.taskId,
                  eventType: loaded.ok ? "skill.loaded" : "skill.denied",
                  toolId: toolInput.skillId,
                  authorization: loaded.authorization,
                  outcome: loaded.ok ? "success" : "denied",
                  errorCode: loaded.ok ? undefined : loaded.error,
                  sourceIds: loaded.ok ? [loaded.skillId] : undefined,
                }),
              );
              if (!loaded.ok) return { error: loaded.error };
              return { skillId: loaded.skillId, instructions: loaded.body };
            },
          }),
        }
      : {}),
    ...(allowed
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
            if (!status.ok) {
              toolError = status.error === "denied" ? "denied" : "failed";
              return { error: status.error };
            }
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
      : {}),
  };
  const prior = input.history
    .filter((row) => row.agent === "it")
    .slice(-8)
    .map((row) => row.body)
    .join("\n");
  const notes = input.notes.map((note) => `${note.information}: ${note.value}`).join("\n");
  try {
    const result = await generateText({
      model: createOpenAI({ apiKey: key }).responses(PLAN_MODEL),
      maxRetries: 1,
      abortSignal: boundedSignal(input.signal),
      providerOptions: { openai: { reasoningEffort: "low", store: false } },
      stopWhen: stepCountIs(4),
      system: itInstructions(),
      prompt: [`Assignment: ${input.objective}`, prior, notes].filter((part) => part !== "").join("\n\n"),
      tools: Object.keys(tools).length === 0 ? undefined : tools,
    });
    if (input.notes.length > 0 || statuses.length > 0) {
      return { text: result.text, statuses, outcome: "success" };
    }
    if (toolError === "denied" || !allowed) {
      return { text: "The service status tool was denied.", statuses: [], outcome: "denied" };
    }
    if (toolError === "failed") {
      return { text: "The service status tool failed.", statuses: [], outcome: "failed" };
    }
    return { text: "The IT specialist did not produce a verified result.", statuses: [], outcome: "failed" };
  } catch {
    return { text: "The IT specialist failed.", statuses: [], outcome: "failed" };
  }
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
  const tools: string[] = [];
  if (agent === "it" && permits(userId, agent, "troubleshooting")) tools.push("loadSkill");
  if (agent === "it" && permits(userId, agent, "service_status")) tools.push("getServiceStatus");
  if (agent === "it" && permits(userId, agent, "password_reset")) tools.push("simulatePasswordReset");
  if (agent === "hr" && permits(userId, agent, "hr_policy")) tools.push("searchPolicies");
  return tools;
}

export function modelToolIds(userId: DemoUserId, agent: AgentId, action: TaskAction = "read"): string[] {
  return offeredToolIds(userId, agent).filter((id) => id !== "simulatePasswordReset" || action === "password_reset");
}
