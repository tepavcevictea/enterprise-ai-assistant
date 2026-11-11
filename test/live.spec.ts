import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { UNAVAILABLE_POLICY } from "../src/mcp/policy-client";
import { EQUIPMENT_BODY, EQUIPMENT_PROFILE, LEAVE_BODY, RESTRICTED_BADGE } from "../src/policies";
import { RESET_DENIED, RESET_WITHHELD } from "../src/password";
import { SessionObject } from "../src/session";
import { VPN_DETAIL } from "../src/status";
import type { TraceEvent } from "../src/trace";
import worker from "../src/worker";

function configuredKey(): boolean {
  const key = env.OPENAI_API_KEY?.trim();
  return key !== undefined && key !== "" && key !== "replace-me";
}

it("asks the IT specialist whether the VPN is operational", async () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
  expect(configuredKey(), "Set OPENAI_API_KEY in .dev.vars").toBe(true);
  const response = await worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "alex" },
      body: JSON.stringify({
        message: "Is the company VPN service operational?",
        idempotencyKey: `live-vpn-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{
    reply: string;
    outcome: string;
    trace: TraceEvent[];
  }>();
  expect(body.outcome).toBe("success");
  expect(body.trace.some((event) => event.eventType === "delegation.started" && event.agentId === "it")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "tool.invoked" && event.toolId === "getServiceStatus" && event.agentId === "it")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "tool.result" && event.result === VPN_DETAIL)).toBe(true);
  expect(body.trace.some((event) => event.agentId === "orchestrator" && event.toolId !== undefined)).toBe(false);
  expect(body.reply).toContain(VPN_DETAIL);

  const session = await worker.fetch(
    new Request("https://app.local/session", { headers: { "x-demo-user": "alex" } }),
    env,
  );
  const snapshot = await session.json<{
    histories: { agent: string; body: string }[];
  }>();
  expect(snapshot.histories.some((row) => row.agent === "orchestrator" && row.body.includes("Is the company VPN service operational?"))).toBe(true);
  expect(snapshot.histories.some((row) => row.agent === "it" && row.body.startsWith("task:"))).toBe(true);
  expect(snapshot.histories.some((row) => row.agent === "orchestrator" && row.body.startsWith("task:"))).toBe(false);

}, 120_000);

it("asks the HR specialist for the leave approval policy", async () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
  expect(configuredKey(), "Set OPENAI_API_KEY in .dev.vars").toBe(true);
  const reset = await worker.fetch(
    new Request("https://app.local/session/reset", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "alex" },
      body: "{}",
    }),
    env,
  );
  expect(reset.status).toBe(200);
  const response = await worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "alex" },
      body: JSON.stringify({
        message: "What does the leave approval policy say?",
        idempotencyKey: `live-leave-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{
    reply: string;
    outcome: string;
    trace: TraceEvent[];
    turnId: string;
  }>();
  expect(body.outcome).toBe("success");
  expect(body.trace.find((event) => event.eventType === "plan.validated")?.result).toBe("hr");
  expect(body.trace.some((event) => event.eventType === "delegation.started" && event.agentId === "hr")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "tool.discovered" && event.toolId === "searchPolicies")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "tool.invoked" && event.toolId === "searchPolicies" && event.agentId === "hr")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "tool.denied" && event.toolId === "exportAllPolicies")).toBe(true);
  expect(body.trace.some((event) => event.toolId === "getServiceStatus")).toBe(false);
  expect(body.trace.some((event) => event.eventType === "tool.result" && event.sourceIds?.includes("leave-approval"))).toBe(true);
  expect(body.trace.some((event) => event.agentId === "orchestrator" && event.toolId !== undefined)).toBe(false);
  expect(body.reply).toContain(LEAVE_BODY);
  expect(body.reply).not.toContain(RESTRICTED_BADGE);

  const session = await worker.fetch(
    new Request("https://app.local/session", { headers: { "x-demo-user": "alex" } }),
    env,
  );
  const snapshot = await session.json<{
    histories: { agent: string; body: string }[];
  }>();
  expect(snapshot.histories.some((row) => row.agent === "orchestrator" && row.body.includes("What does the leave approval policy say?"))).toBe(true);
  expect(snapshot.histories.some((row) => row.agent === "hr" && row.body.startsWith("task:"))).toBe(true);
  expect(snapshot.histories.some((row) => row.agent === "hr" && row.body.includes(LEAVE_BODY))).toBe(true);
  expect(snapshot.histories.some((row) => row.agent === "it" && row.body.includes(LEAVE_BODY))).toBe(false);
  expect(snapshot.histories.some((row) => row.agent === "orchestrator" && row.body.startsWith("task:"))).toBe(false);
}, 120_000);

it("answers an independent VPN question and a leave question together", async () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
  expect(configuredKey(), "Set OPENAI_API_KEY in .dev.vars").toBe(true);
  const message = "My VPN isn't connecting. Also, what is the leave approval policy?";
  const response = await worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "alex" },
      body: JSON.stringify({ message, idempotencyKey: `live-both-${crypto.randomUUID()}` }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{
    reply: string;
    outcome: string;
    trace: TraceEvent[];
    turnId: string;
  }>();
  const tasks = JSON.parse(body.trace.find((event) => event.eventType === "plan.tasks")?.result ?? "[]") as Array<{
    specialist: string;
    order: number;
    dependsOn: unknown[];
  }>;
  expect(body.outcome).toBe("success");
  expect(tasks.filter((task) => task.specialist === "it" && task.dependsOn.length === 0)).toHaveLength(1);
  expect(tasks.filter((task) => task.specialist === "hr" && task.dependsOn.length === 0)).toHaveLength(1);
  const itStart = body.trace.find((event) => event.eventType === "specialist.started" && event.agentId === "it");
  const hrStart = body.trace.find((event) => event.eventType === "specialist.started" && event.agentId === "hr");
  const itDone = body.trace.find((event) => event.eventType === "specialist.completed" && event.agentId === "it");
  const hrDone = body.trace.find((event) => event.eventType === "specialist.completed" && event.agentId === "hr");
  expect(itStart !== undefined && hrStart !== undefined && itDone !== undefined && hrDone !== undefined).toBe(true);
  expect((itStart?.timestamp ?? "") <= (hrDone?.timestamp ?? "")).toBe(true);
  expect((hrStart?.timestamp ?? "") <= (itDone?.timestamp ?? "")).toBe(true);
  expect(body.trace.some((event) => event.toolId === "getServiceStatus" && event.eventType === "tool.invoked" && event.agentId === "it")).toBe(true);
  expect(body.trace.some((event) => event.toolId === "searchPolicies" && event.eventType === "tool.invoked" && event.agentId === "hr")).toBe(true);
  expect(body.reply.indexOf(VPN_DETAIL)).toBeGreaterThanOrEqual(0);
  expect(body.reply.indexOf(VPN_DETAIL)).toBeLessThan(body.reply.indexOf(LEAVE_BODY));
  expect(body.reply.split(VPN_DETAIL).length - 1).toBe(1);
  expect(body.reply.split(LEAVE_BODY).length - 1).toBe(1);
}, 120_000);

it("configures the laptop from the authorized equipment profile", async () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
  expect(configuredKey(), "Set OPENAI_API_KEY in .dev.vars").toBe(true);
  const reset = await worker.fetch(
    new Request("https://app.local/session/reset", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "jordan" },
      body: "{}",
    }),
    env,
  );
  expect(reset.status).toBe(200);
  const message = "Based on the equipment profile I'm entitled to under company policy, how should I configure my laptop?";
  const response = await worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "jordan" },
      body: JSON.stringify({ message, idempotencyKey: `live-laptop-${crypto.randomUUID()}` }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{
    reply: string;
    outcome: string;
    trace: TraceEvent[];
    turnId: string;
  }>();
  const tasks = JSON.parse(body.trace.find((event) => event.eventType === "plan.tasks")?.result ?? "[]") as Array<{
    id: string;
    specialist: string;
    order: number;
    dependsOn: { taskId: string; information: string }[];
  }>;
  const session = await worker.fetch(new Request("https://app.local/session", { headers: { "x-demo-user": "jordan" } }), env);
  const snapshot = await session.json<{ histories: { agent: string; turnId: string; body: string }[] }>();
  const turnRows = snapshot.histories.filter((row) => row.turnId === body.turnId);
  const hr = tasks.find((task) => task.specialist === "hr");
  const it = tasks.find((task) => task.specialist === "it");
  expect(hr).toBeDefined();
  expect(it?.dependsOn.some((dependency) => dependency.taskId === hr?.id)).toBe(true);
  const hrDone = body.trace.find((event) => event.eventType === "specialist.completed" && event.agentId === "hr");
  const itStart = body.trace.find((event) => event.eventType === "specialist.started" && event.agentId === "it");
  expect((hrDone?.timestamp ?? "9") <= (itStart?.timestamp ?? "")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "tool.invoked" && event.toolId === "searchPolicies" && event.agentId === "hr")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "dependency.passed" && event.agentId === "it" && event.result === `equipmentProfile=${EQUIPMENT_PROFILE}`)).toBe(true);
  expect(body.reply).toContain(EQUIPMENT_PROFILE);
  expect(body.reply.split(EQUIPMENT_BODY).length - 1).toBeLessThanOrEqual(1);
  expect(body.reply.toLowerCase()).not.toMatch(/entitled|entitlement/);
  expect(turnRows.some((row) => row.agent === "it" && row.body.includes(EQUIPMENT_BODY))).toBe(false);
  expect(turnRows.some((row) => row.agent === "hr" && row.body.includes(EQUIPMENT_BODY))).toBe(true);
  expect(turnRows.some((row) => row.agent === "hr" && row.body.includes("ns-vpn-degraded"))).toBe(false);
}, 120_000);

it("loads the VPN troubleshooting skill and then checks the service", async () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
  expect(configuredKey(), "Set OPENAI_API_KEY in .dev.vars").toBe(true);
  const reset = await worker.fetch(
    new Request("https://app.local/session/reset", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "alex" },
      body: "{}",
    }),
    env,
  );
  expect(reset.status).toBe(200);
  const message = "Why is my VPN failing, and what should I try?";
  const response = await worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "alex" },
      body: JSON.stringify({ message, idempotencyKey: `live-skill-${crypto.randomUUID()}` }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{
    reply: string;
    outcome: string;
    trace: TraceEvent[];
    turnId: string;
  }>();
  const loadedAt = body.trace.findIndex((event) => event.eventType === "skill.loaded");
  const statusAt = body.trace.findIndex((event) => event.eventType === "tool.invoked" && event.toolId === "getServiceStatus");
  expect(body.outcome).toBe("success");
  expect(body.trace.some((event) => event.eventType === "delegation.started" && event.agentId === "it")).toBe(true);
  expect(loadedAt).toBeGreaterThanOrEqual(0);
  expect(statusAt).toBeGreaterThan(loadedAt);
  expect(body.trace.some((event) => event.eventType === "tool.result" && event.result === VPN_DETAIL)).toBe(true);
  expect(body.trace.some((event) => event.toolId === "simulatePasswordReset")).toBe(false);
  expect(body.reply).toContain(VPN_DETAIL);
  expect(body.reply.split(VPN_DETAIL).length - 1).toBe(1);
  expect(body.reply.toLowerCase()).toContain("accepting new sessions");
  expect(body.reply).not.toContain("Compare the VPN client with the company profile");
}, 120_000);

it("denies a password reset for an employee before any specialist runs", async () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
  expect(configuredKey(), "Set OPENAI_API_KEY in .dev.vars").toBe(true);
  const reset = await worker.fetch(
    new Request("https://app.local/session/reset", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "alex" },
      body: "{}",
    }),
    env,
  );
  expect(reset.status).toBe(200);
  const message = "Please reset my password.";
  const response = await worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "alex" },
      body: JSON.stringify({ message, idempotencyKey: `live-reset-denied-${crypto.randomUUID()}` }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{ reply: string; outcome: string; trace: TraceEvent[]; turnId: string }>();
  const session = await worker.fetch(new Request("https://app.local/session", { headers: { "x-demo-user": "alex" } }), env);
  const snapshot = await session.json<{ passwordResets: unknown[] }>();
  expect(body.outcome).toBe("denied");
  expect(body.reply).toBe(RESET_DENIED);
  expect(body.trace.some((event) => event.eventType === "permission.denied" && event.agentId === "orchestrator")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "delegation.started")).toBe(false);
  expect(body.trace.some((event) => event.toolId === "simulatePasswordReset" && event.eventType === "tool.offered")).toBe(false);
  expect(snapshot.passwordResets).toEqual([]);
}, 120_000);

it("asks HR to reset a password and does not call IT", async () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
  expect(configuredKey(), "Set OPENAI_API_KEY in .dev.vars").toBe(true);
  const reset = await worker.fetch(
    new Request("https://app.local/session/reset", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "jordan" },
      body: "{}",
    }),
    env,
  );
  expect(reset.status).toBe(200);
  const message = "Ask the HR specialist to reset my password. Do not use IT.";
  const response = await worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "jordan" },
      body: JSON.stringify({ message, idempotencyKey: `live-hr-reset-${crypto.randomUUID()}` }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{ reply: string; outcome: string; trace: TraceEvent[]; turnId: string }>();
  const tasks = JSON.parse(body.trace.find((event) => event.eventType === "plan.tasks")?.result ?? "[]") as Array<{
    specialist: string;
    action?: string;
    onlySpecialist?: string | null;
  }>;
  const session = await worker.fetch(new Request("https://app.local/session", { headers: { "x-demo-user": "jordan" } }), env);
  const snapshot = await session.json<{ passwordResets: unknown[] }>();
  expect(body.outcome).toBe("denied");
  expect(tasks.every((task) => task.specialist === "hr")).toBe(true);
  expect(tasks.some((task) => task.action === "password_reset")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "delegation.started" && event.agentId === "hr")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "specialist.completed" && event.agentId === "hr")).toBe(true);
  expect(body.trace.some((event) => event.agentId === "it")).toBe(false);
  expect(body.trace.some((event) => event.eventType === "tool.offered" && event.toolId === "simulatePasswordReset")).toBe(false);
  expect(body.trace.some((event) => event.eventType === "tool.denied" && event.toolId === "simulatePasswordReset" && event.agentId === "hr")).toBe(true);
  expect(body.reply).toBe(RESET_WITHHELD);
  expect(snapshot.passwordResets).toEqual([]);
}, 120_000);

const S7_MESSAGE = "Is the company VPN service operational? Also, what does the leave approval policy say?";

async function askWhilePolicyFails(mode: "error" | "timeout") {
  const reset = await worker.fetch(
    new Request("https://app.local/session/reset", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "taylor" },
      body: "{}",
    }),
    env,
  );
  expect(reset.status).toBe(200);
  await runInDurableObject(env.SESSION.getByName("taylor"), (instance) => {
    (instance as SessionObject).armMcpMode(mode);
  });
  const response = await worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "taylor" },
      body: JSON.stringify({ message: S7_MESSAGE, idempotencyKey: `live-s7-${mode}-${crypto.randomUUID()}` }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{ reply: string; outcome: string; trace: TraceEvent[]; turnId: string }>();
  const session = await worker.fetch(new Request("https://app.local/session", { headers: { "x-demo-user": "taylor" } }), env);
  const snapshot = await session.json<{
    histories: { agent: string; turnId: string; body: string }[];
    passwordResets: unknown[];
  }>();
  const tasks = JSON.parse(body.trace.find((event) => event.eventType === "plan.tasks")?.result ?? "[]") as Array<{
    specialist: string;
    dependsOn: unknown[];
  }>;
  expect(tasks.filter((task) => task.specialist === "it" && task.dependsOn.length === 0)).toHaveLength(1);
  expect(tasks.filter((task) => task.specialist === "hr" && task.dependsOn.length === 0)).toHaveLength(1);
  expect(body.trace.some((event) => event.eventType === "delegation.started" && event.agentId === "hr")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "tool.invoked" && event.toolId === "searchPolicies" && event.agentId === "hr")).toBe(true);
  expect(
    body.trace.some(
      (event) =>
        event.eventType === "tool.result" &&
        event.toolId === "searchPolicies" &&
        event.outcome === "unavailable" &&
        event.errorCode === (mode === "timeout" ? "policy_timeout" : "policy_failed"),
    ),
  ).toBe(true);
  expect(body.trace.some((event) => event.eventType === "delegation.completed" && event.agentId === "hr" && event.outcome === "unavailable")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "tool.result" && event.toolId === "getServiceStatus" && event.result === VPN_DETAIL)).toBe(true);
  expect(body.reply).toContain(VPN_DETAIL);
  expect(body.reply).toContain(UNAVAILABLE_POLICY);
  expect(body.reply).not.toContain(LEAVE_BODY);
  const turnRows = snapshot.histories.filter((row) => row.turnId === body.turnId);
  expect(turnRows.some((row) => row.agent === "hr" && row.body.includes(LEAVE_BODY))).toBe(false);
  expect(turnRows.some((row) => row.agent === "it")).toBe(true);
  expect(snapshot.passwordResets).toEqual([]);
}

it("keeps the VPN answer when the policy service returns an MCP error", async () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
  expect(configuredKey(), "Set OPENAI_API_KEY in .dev.vars").toBe(true);
  await askWhilePolicyFails("error");
}, 120_000);

it("keeps the VPN answer when the policy service times out", async () => {
  expect(navigator.userAgent).toContain("Cloudflare-Workers");
  expect(configuredKey(), "Set OPENAI_API_KEY in .dev.vars").toBe(true);
  await askWhilePolicyFails("timeout");
}, 120_000);
