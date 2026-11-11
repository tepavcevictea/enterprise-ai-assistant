import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { configuredApiKey, labelObject, lookupFixture } from "../src/calls";
import { labelSchema } from "../src/schemas";
import { observeFetch, type ObservedRequest } from "../src/transport";

const UNUSED_KEY = "sk-experiment-not-sent";

function hasLiveKey(): boolean {
  return configuredApiKey(env.OPENAI_API_KEY) !== undefined;
}

it("runs inside the Workers runtime", () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
});

it("rejects a label object that does not match the schema", () => {
  const invalid = labelSchema.safeParse({ label: "other", count: "no" });
  expect(invalid.success).toBe(false);
  const valid = labelSchema.safeParse({ label: "sol-check", count: 2 });
  expect(valid.success).toBe(true);
});

it("does not call the provider when the signal is already aborted", async () => {
  const observed: ObservedRequest[] = [];
  const controller = new AbortController();
  controller.abort();
  await expect(
    lookupFixture({
      apiKey: UNUSED_KEY,
      abortSignal: controller.signal,
      maxRetries: 1,
      fetchImpl: observeFetch(observed, () => {
        throw new Error("provider fetch ran");
      }),
    }),
  ).rejects.toThrow();
  expect(observed).toHaveLength(1);
  expect(observed[0]?.signalAborted).toBe(true);
  expect(observed[0]?.pathname).toBe("/v1/responses");

  const started = performance.now();
  const controllerForRuntime = new AbortController();
  controllerForRuntime.abort();
  await expect(
    fetch("https://workers-experiment.invalid/v1/responses", {
      method: "POST",
      signal: controllerForRuntime.signal,
      body: "{}",
      headers: { "content-type": "application/json" },
    }),
  ).rejects.toThrow();
  expect(performance.now() - started).toBeLessThan(50);
});

it("retries a 503 once when maxRetries is 1", async () => {
  const observed: ObservedRequest[] = [];
  const fetchImpl = observeFetch(observed, () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "unavailable" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  await expect(
    labelObject({
      apiKey: UNUSED_KEY,
      maxRetries: 1,
      fetchImpl,
    }),
  ).rejects.toThrow();
  expect(observed).toHaveLength(2);
  expect(observed.every((request) => request.pathname === "/v1/responses")).toBe(true);
  expect(observed.every((request) => request.hasAuthorization)).toBe(true);
  expect(observed.map((request) => request.model)).toEqual(["gpt-6.1-sol", "gpt-6.1-sol"]);
  expect(observed.map((request) => request.store)).toEqual([false, false]);
  expect(observed.map((request) => request.reasoningEffort)).toEqual(["low", "low"]);
  expect(observed.every((request) => !request.hasTemperature && !request.hasTopP)).toBe(true);
});

it.skipIf(!hasLiveKey())("calls the native tool and uses its result", async () => {
  const apiKey = configuredApiKey(env.OPENAI_API_KEY);
  if (apiKey === undefined) throw new Error("missing API key");
  const observed: ObservedRequest[] = [];
  const started = performance.now();
  const result = await lookupFixture({
    apiKey,
    fetchImpl: observeFetch(observed, fetch),
  });
  const elapsedMs = Math.round(performance.now() - started);
  console.log(
    JSON.stringify({
      elapsedMs,
      steps: result.steps,
      executed: result.executed,
      toolInputs: result.toolInputs,
      toolOutputs: result.toolOutputs,
      text: result.text,
      usage: result.usage,
      requests: observed.map((request) => ({
        pathname: request.pathname,
        model: request.model,
        store: request.store,
        reasoningEffort: request.reasoningEffort,
        hasTemperature: request.hasTemperature,
        hasTopP: request.hasTopP,
        toolNames: request.toolNames,
      })),
    }),
  );
  expect(result.executed).toBe(1);
  expect(result.toolInputs).toEqual([{ fixtureId: "desk-lamp" }]);
  expect(result.toolOutputs).toEqual([{ code: "NS-FIXTURE-417" }]);
  expect(result.text).toContain("NS-FIXTURE-417");
  expect(result.steps).toBe(2);
  expect(observed.every((request) => request.pathname === "/v1/responses")).toBe(true);
  expect(observed.some((request) => request.pathname.includes("chat/completions"))).toBe(false);
});

it.skipIf(!hasLiveKey())("returns schema-valid structured output from the Responses API", async () => {
  const apiKey = configuredApiKey(env.OPENAI_API_KEY);
  if (apiKey === undefined) throw new Error("missing API key");
  const observed: ObservedRequest[] = [];
  const started = performance.now();
  const result = await labelObject({
    apiKey,
    fetchImpl: observeFetch(observed, fetch),
  });
  const elapsedMs = Math.round(performance.now() - started);
  console.log(
    JSON.stringify({
      elapsedMs,
      output: result.output,
      usage: result.usage,
      requests: observed.map((request) => ({
        pathname: request.pathname,
        model: request.model,
        store: request.store,
        reasoningEffort: request.reasoningEffort,
        hasTemperature: request.hasTemperature,
        hasTopP: request.hasTopP,
        toolNames: request.toolNames,
      })),
    }),
  );
  expect(labelSchema.safeParse(result.output).success).toBe(true);
  expect(result.output).toEqual({ label: "sol-check", count: 2 });
  expect(observed).toHaveLength(1);
  expect(observed[0]?.pathname).toBe("/v1/responses");
  expect(observed[0]?.toolNames).toEqual([]);
  expect(observed[0]?.store).toBe(false);
  expect(observed[0]?.reasoningEffort).toBe("low");
  expect(observed[0]?.hasTemperature).toBe(false);
  expect(observed[0]?.hasTopP).toBe(false);
});
