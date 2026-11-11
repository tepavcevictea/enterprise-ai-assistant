import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { configuredApiKey } from "../src/calls";
import { validatePlan } from "../src/plan";
import { assessPlan, type PlanningCase } from "../src/planning-cases";
import { reviewCases } from "../src/planning-review";
import { planRequest, plannerInstructions, type PlanCallResult } from "../src/planner";

const REPORT_URL = "http://127.0.0.1:47331/";

it(
  "reviews the corrected routing and order rules at medium effort",
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

    const calls: ReviewCall[] = [];
    const report = {
      kind: "review" as const,
      effort: "medium" as const,
      model: "gpt-6.1-sol",
      instructions: plannerInstructions({ id: "alex", role: "Employee" }),
      calls,
    };

    for (const testCase of reviewCases) {
      const result = await planRequest({
        apiKey,
        effort: "medium",
        identity: testCase.identity,
        request: testCase.request,
      });
      if (result.error !== null && fatalProviderError(result.error) && calls.length === 0) {
        await publish(report);
        throw new Error(result.error);
      }
      const assessed = result.plan === null ? null : assessPlan(testCase, result.plan);
      calls.push(record(testCase, result, assessed));
      await publish(report);
    }

    expect(calls).toHaveLength(reviewCases.length);
    expect(calls.every((call) => call.executed === false)).toBe(true);
    for (const call of calls) {
      expect(call.transport?.pathname).toBe("/v1/responses");
      expect(call.transport?.model).toBe("gpt-6.1-sol");
      expect(call.transport?.store).toBe(false);
      expect(call.transport?.reasoningEffort).toBe("medium");
      expect(call.transport?.hasTemperature).toBe(false);
      expect(call.transport?.hasTopP).toBe(false);
      expect(call.transport?.toolNames).toEqual([]);
    }
  },
  300_000,
);

type ReviewCall = ReturnType<typeof record>;

function record(
  testCase: PlanningCase,
  result: PlanCallResult,
  assessed: { issues: string[]; executableErrors: string[] } | null,
) {
  const executable = result.plan !== null && validatePlan(result.plan).ok;
  return {
    caseId: testCase.id,
    request: testCase.request,
    identity: testCase.identity,
    schemaValid: result.schemaValid,
    executable,
    issues: assessed === null ? [result.error === null ? "schema" : "call"] : assessed.issues,
    executableErrors: assessed?.executableErrors ?? result.validationErrors,
    latencyMs: result.latencyMs,
    usage: result.usage,
    transport: result.transport,
    plan: result.plan,
    error: result.error,
    executed: false as const,
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
