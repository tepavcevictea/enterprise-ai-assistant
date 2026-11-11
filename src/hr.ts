import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { DemoUser } from "./identity";
import type { Outcome } from "./schedule";
import {
  executePolicyRead,
  preparePolicyCall,
  UNAVAILABLE_POLICY,
  type PolicyConsultation,
} from "./mcp/policy-client";
import type { McpMode, PolicyBinding } from "./mcp/pinned-fetch";
import { PLAN_MODEL } from "./plan";
import type { TraceEvent } from "./trace";

const policyInput = z.object({
  query: z.string().min(1),
});

const MISSING_CALL = "The HR specialist did not retrieve a policy.";

export function hrInstructions(): string {
  return [
    "You are the HR specialist. Return a result to the orchestrator. You do not speak to the user directly.",
    "When the assignment needs company policy, call searchPolicies once. Use a few words that name the policy subject, such as leave approval or equipment profile. Do not include the employee's name or role in the query.",
    "Use only the documents the tool returns. Do not invent a policy, a title, or a procedure.",
    "If a document states one company equipment profile, report that profile. Do not describe it as specific to the employee's role unless the document says so.",
    "You have no IT service-status tool and no password-reset tool.",
  ].join("\n");
}

export type HrResult = {
  outcome: Outcome;
  text: string;
  report: string;
  handoff?: string;
};

export async function runHrSpecialist(input: {
  transport: "direct" | "model";
  apiKey?: string;
  binding: PolicyBinding | undefined;
  user: DemoUser;
  objective: string;
  history: { agent: string; body: string }[];
  notes: { information: string; value: string }[];
  mode?: McpMode;
  signal: AbortSignal;
  trace: (event: TraceEvent) => void;
  base: { sessionId: string; turnId: string; taskId: string };
}): Promise<HrResult> {
  if (input.binding === undefined) {
    return { outcome: "unavailable", text: UNAVAILABLE_POLICY, report: UNAVAILABLE_POLICY };
  }
  if (input.transport === "direct") {
    const consultation = await executePolicyRead({
      binding: input.binding,
      user: input.user,
      agent: "hr",
      query: input.objective,
      mode: input.mode,
      signal: input.signal,
      trace: input.trace,
      base: input.base,
    });
    return fromConsultation(consultation);
  }

  const key = input.apiKey?.trim();
  if (key === undefined || key === "" || key === "replace-me") {
    return { outcome: "failed", text: "The HR specialist could not be called.", report: "The HR specialist could not be called." };
  }
  const prepared = await preparePolicyCall({
    binding: input.binding,
    user: input.user,
    agent: "hr",
    mode: input.mode,
    signal: input.signal,
    trace: input.trace,
    base: input.base,
  });
  if (!prepared.ok) return fromConsultation(prepared.consultation);

  let consultation: PolicyConsultation | undefined;
  try {
    const prior = input.history
      .filter((row) => row.agent === "hr")
      .slice(-8)
      .map((row) => row.body)
      .join("\n");
    const notes = input.notes.map((note) => `${note.information}: ${note.value}`).join("\n");
    await generateText({
      model: createOpenAI({ apiKey: key }).responses(PLAN_MODEL),
      maxRetries: 1,
      abortSignal: AbortSignal.any([input.signal, AbortSignal.timeout(45_000)]),
      providerOptions: { openai: { reasoningEffort: "low", store: false } },
      stopWhen: stepCountIs(4),
      system: hrInstructions(),
      prompt: [`Assignment: ${input.objective}`, prior, notes].filter((part) => part !== "").join("\n\n"),
      tools: {
        searchPolicies: tool({
          description: "Search fictional company policies the signed-in user is allowed to read.",
          inputSchema: policyInput,
          execute: async (toolInput) => {
            consultation = await prepared.prepared.invoke(
              toolInput.query,
              AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]),
            );
            if (consultation.outcome !== "success") return { error: consultation.errorCode ?? "unavailable" };
            return consultation.documents.map((policy) => ({
              id: policy.id,
              version: policy.version,
              title: policy.title,
              classification: policy.classification,
              body: policy.body,
            }));
          },
        }),
      },
    });
  } finally {
    await prepared.prepared.close();
  }
  if (consultation === undefined) {
    return { outcome: "failed", text: MISSING_CALL, report: MISSING_CALL };
  }
  return fromConsultation(consultation);
}

function fromConsultation(consultation: PolicyConsultation): HrResult {
  return {
    outcome: consultation.outcome,
    text: consultation.report,
    report: consultation.report,
    handoff: consultation.handoff,
  };
}
