import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { validatePlan } from "../src/plan";
import { assessPlan, planningCases, type PlanningCase } from "../src/planning-cases";
import { configuredApiKey } from "../src/calls";
import {
  planRequest,
  plannerInstructions,
  repairPlan,
  type PlanCallResult,
  type ReasoningEffort,
} from "../src/planner";

const REPORT_URL = "http://127.0.0.1:47331/";

type CallRecord = {
  caseId: string;
  scenario: PlanningCase["scenario"];
  effort: ReasoningEffort;
  identity: PlanningCase["identity"];
  request: string;
  schemaValid: boolean;
  executable: boolean;
  issues: string[];
  executableErrors: string[];
  latencyMs: number;
  usage: PlanCallResult["usage"];
  transport: PlanCallResult["transport"];
  plan: PlanCallResult["plan"];
  error: string | null;
  executed: false;
};

it(
  "evaluates thirty real plans inside workerd",
  async () => {
    expect(navigator.userAgent).toContain("Cloudflare-Workers");
    const apiKey = configuredApiKey(env.OPENAI_API_KEY);
    expect(apiKey, "Set OPENAI_API_KEY in experiments/openai-workers/.dev.vars").toBeTruthy();
    if (apiKey === undefined) return;

    const probe = await fetch(REPORT_URL, {
      method: "POST",
      body: JSON.stringify({ probe: true }),
    });
    expect(probe.status).toBe(204);

    const calls: CallRecord[] = [];
    const report = {
      model: "gpt-6.1-sol",
      api: "responses",
      store: false,
      temperature: false,
      topP: false,
      maxRetries: 1,
      instructions: {
        alex: plannerInstructions({ id: "alex", role: "Employee" }),
        jordan: plannerInstructions({ id: "jordan", role: "IT Support" }),
      },
      calls,
      repair: null as unknown,
    };

    for (const effort of ["medium", "low"] as const) {
      for (const testCase of planningCases) {
        const result = await planRequest({
          apiKey,
          effort,
          identity: testCase.identity,
          request: testCase.request,
        });
        if (result.error !== null && fatalProviderError(result.error) && calls.length === 0) {
          report.calls.push(record(testCase, effort, result, ["call"]));
          await publish(report);
          throw new Error(result.error);
        }
        const issues =
          result.plan === null
            ? result.error === null
              ? ["schema"]
              : ["call"]
            : assessPlan(testCase, result.plan).issues;
        const executableErrors =
          result.plan === null ? result.validationErrors : assessPlan(testCase, result.plan).executableErrors;
        calls.push({
          ...record(testCase, effort, result, issues),
          executable: result.plan !== null && validatePlan(result.plan).ok && result.gateError === null,
          executableErrors,
        });
        await publish(report);
      }
    }

    const failed = calls.find((call) => call.schemaValid && !call.executable);
    const repair =
      failed === undefined
        ? await repairSynthetic(apiKey)
        : await repairObserved(apiKey, failed);
    report.repair = repair;
    await publish(report);

    expect(calls).toHaveLength(30);
    expect(calls.every((call) => call.executed === false)).toBe(true);
    expect(repair.executed).toBe(false);
    for (const call of calls) {
      expect(call.transport?.pathname).toBe("/v1/responses");
      expect(call.transport?.model).toBe("gpt-6.1-sol");
      expect(call.transport?.store).toBe(false);
      expect(call.transport?.reasoningEffort).toBe(call.effort);
      expect(call.transport?.hasTemperature).toBe(false);
      expect(call.transport?.hasTopP).toBe(false);
      expect(call.transport?.toolNames).toEqual([]);
    }
    expect(repair.transport?.pathname).toBe("/v1/responses");
    expect(repair.transport?.toolNames).toEqual([]);
  },
  1_200_000,
);

function record(
  testCase: PlanningCase,
  effort: ReasoningEffort,
  result: PlanCallResult,
  issues: string[],
): CallRecord {
  return {
    caseId: testCase.id,
    scenario: testCase.scenario,
    effort,
    identity: testCase.identity,
    request: testCase.request,
    schemaValid: result.schemaValid,
    executable: result.validationErrors.length === 0 && result.schemaValid && result.gateError === null,
    issues,
    executableErrors: result.validationErrors,
    latencyMs: result.latencyMs,
    usage: result.usage,
    transport: result.transport,
    plan: result.plan,
    error: result.error,
    executed: false,
  };
}

async function repairSynthetic(apiKey: string) {
  const rejected = {
    tasks: [
      {
        id: "status",
        specialist: "it",
        objective: "Check whether the VPN service is up",
        order: 1,
        dependsOn: [{ taskId: "policy", information: "vpn status" }],
      },
      {
        id: "policy",
        specialist: "hr",
        objective: "Check whether the VPN service is up",
        order: 2,
        dependsOn: [{ taskId: "status", information: "vpn status" }],
      },
    ],
  };
  const errors = validatePlan(rejected);
  const result = await repairPlan({
    apiKey,
    effort: "medium",
    identity: { id: "alex", role: "Employee" },
    request: "Is the VPN service up?",
    rejected,
    errors: errors.ok ? [] : errors.errors,
    onlySpecialist: null,
  });
  const validation = result.plan === null ? null : validatePlan(result.plan);
  return {
    kind: "synthetic-cycle",
    executed: false as const,
    accepted: validation?.ok === true && result.gateError === null,
    validationErrors: validation === null ? [] : validation.ok ? [] : validation.errors,
    plan: result.plan,
    error: result.error,
    latencyMs: result.latencyMs,
    usage: result.usage,
    transport: result.transport,
    inputErrors: errors.ok ? [] : errors.errors,
  };
}

async function repairObserved(apiKey: string, failed: CallRecord) {
  const testCase = planningCases.find((item) => item.id === failed.caseId);
  const result = await repairPlan({
    apiKey,
    effort: failed.effort,
    identity: failed.identity,
    request: failed.request,
    rejected: failed.plan,
    errors: failed.executableErrors,
    onlySpecialist: testCase?.onlySpecialist ?? null,
  });
  const validation = result.plan === null ? null : validatePlan(result.plan);
  const gateBlocked = result.gateError !== null;
  return {
    kind: "observed-invalid",
    caseId: failed.caseId,
    effort: failed.effort,
    executed: false as const,
    accepted: validation?.ok === true && !gateBlocked,
    gateError: result.gateError,
    validationErrors: validation === null ? [] : validation.ok ? [] : validation.errors,
    plan: result.plan,
    error: result.error,
    latencyMs: result.latencyMs,
    usage: result.usage,
    transport: result.transport,
  };
}

function fatalProviderError(message: string): boolean {
  return /invalid_api_key|incorrect api key|response_format|invalid schema|json_schema/i.test(message);
}

async function publish(report: unknown): Promise<void> {
  const response = await fetch(REPORT_URL, {
    method: "POST",
    body: JSON.stringify(report),
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`evidence server returned ${response.status}`);
  }
}
