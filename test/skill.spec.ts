import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { hrInstructions } from "../src/hr";
import { USERS } from "../src/identity";
import { plannerContext, plannerInstructions } from "../src/plan";
import { LEAVE_BODY } from "../src/policies";
import { composeReply } from "../src/reply";
import { SessionObject } from "../src/session";
import { DEGRADED_NEXT_STEP, itInstructions, loadSkill, skillNextStep } from "../src/skills";
import { runServiceStatus, VPN_DETAIL } from "../src/status";
import type { TraceEvent } from "../src/trace";
import worker from "../src/worker";

const PROCEDURE_LINE = "This procedure applies only after loadSkill returns it.";

function session(user: string) {
  return env.SESSION.getByName(user);
}

async function send(user: string, body: unknown): Promise<Response> {
  return worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": user },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function reset(user: string): Promise<void> {
  const response = await worker.fetch(
    new Request("https://app.local/session/reset", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": user },
      body: "{}",
    }),
    env,
  );
  expect(response.status).toBe(200);
}

it("keeps the VPN procedure out of the IT prompt until loadSkill returns it", () => {
  const instructions = itInstructions();
  expect(instructions).toContain("vpn-troubleshooting");
  expect(instructions).toContain("already retrieved");
  expect(instructions).toContain("not in the available information");
  expect(instructions).not.toContain("standard-laptop");
  expect(instructions).not.toContain(DEGRADED_NEXT_STEP);
  expect(instructions).not.toContain(PROCEDURE_LINE);
  const loaded = loadSkill({ userId: "alex", agent: "it", skillId: "vpn-troubleshooting" });
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.body).toContain(DEGRADED_NEXT_STEP);
  expect(loaded.body).toContain(PROCEDURE_LINE);
  expect(skillNextStep(loaded.body, "degraded")).toBe(DEGRADED_NEXT_STEP);
  expect(itInstructions()).not.toContain(loaded.body);
});

it("denies the skill to an agent without troubleshooting and does not grant service status", () => {
  const loaded = loadSkill({ userId: "jordan", agent: "it", skillId: "vpn-troubleshooting" });
  expect(loaded.ok).toBe(true);
  for (const agent of ["hr", "orchestrator"] as const) {
    const denied = loadSkill({ userId: "jordan", agent, skillId: "vpn-troubleshooting" });
    expect(denied).toEqual({ ok: false, authorization: "denied", error: "denied" });
  }
  expect(loadSkill({ userId: "alex", agent: "it", skillId: "password-reset" })).toEqual({
    ok: false,
    authorization: "denied",
    error: "unknown_skill",
  });
  expect(runServiceStatus({ userId: "jordan", agent: "hr", serviceId: "vpn" })).toEqual({
    ok: false,
    authorization: "denied",
    error: "denied",
  });
  expect(loaded.ok).toBe(true);
});

it("does not load the skill for a status check, and loads it when the assignment names it", async () => {
  await reset("alex");
  const status = await send("alex", { message: "Is the office wifi available?", idempotencyKey: "alex-skill-status" });
  expect(status.status).toBe(200);
  const statusBody = await status.json<{ trace: TraceEvent[]; reply: string }>();
  expect(statusBody.trace.some((event) => event.eventType === "skill.loaded")).toBe(false);
  expect(statusBody.trace.some((event) => event.eventType === "tool.invoked" && event.toolId === "getServiceStatus")).toBe(true);
  expect(statusBody.reply).not.toContain(DEGRADED_NEXT_STEP);
  expect(statusBody.reply).not.toContain(PROCEDURE_LINE);

  await runInDurableObject(session("alex"), (instance) => {
    (instance as SessionObject).armPlan({
      tasks: [
        {
          id: "vpn",
          specialist: "it",
          objective: "Investigate the VPN connection with skill vpn-troubleshooting.",
          order: 1,
          dependsOn: [],
        },
      ],
    });
  });
  const response = await send("alex", { message: "Please carry out the assigned work.", idempotencyKey: "alex-skill-load" });
  expect(response.status).toBe(200);
  const body = await response.json<{ reply: string; trace: TraceEvent[] }>();
  const loadedAt = body.trace.findIndex((event) => event.eventType === "skill.loaded" && event.toolId === "vpn-troubleshooting");
  const statusAt = body.trace.findIndex((event) => event.eventType === "tool.invoked" && event.toolId === "getServiceStatus");
  expect(loadedAt).toBeGreaterThanOrEqual(0);
  expect(statusAt).toBeGreaterThan(loadedAt);
  expect(body.trace.some((event) => event.toolId === "simulatePasswordReset")).toBe(false);
  expect(body.reply.split(VPN_DETAIL).length - 1).toBe(1);
  expect(body.reply).toContain(DEGRADED_NEXT_STEP);
  expect(body.reply).not.toContain(PROCEDURE_LINE);

  const snapshot = await worker.fetch(new Request("https://app.local/session", { headers: { "x-demo-user": "alex" } }), env);
  const stored = await snapshot.json<{ histories: { agent: string; body: string }[] }>();
  expect(stored.histories.some((row) => row.agent === "it" && row.body.includes(DEGRADED_NEXT_STEP))).toBe(true);
  expect(stored.histories.some((row) => row.body.includes(PROCEDURE_LINE))).toBe(false);
  expect(stored.histories.some((row) => row.agent === "hr")).toBe(false);
});

it("keeps one status detail when the IT result also contains the next step", () => {
  const reply = composeReply(
    [{ id: "vpn", specialist: "it", objective: "Investigate VPN", order: 1, dependsOn: [] }],
    [
      {
        taskId: "vpn",
        specialist: "it",
        outcome: "success",
        text: `${VPN_DETAIL}\n\n${DEGRADED_NEXT_STEP}\n\n${VPN_DETAIL}`,
        handoff: { value: VPN_DETAIL },
      },
    ],
  );
  expect(reply.split(VPN_DETAIL).length - 1).toBe(1);
  expect(reply).toContain(DEGRADED_NEXT_STEP);
});

it("does not give the planner a previous answer to copy", () => {
  const prompt = plannerContext(
    [
      { agent: "orchestrator", body: "user: What does the leave approval policy say?" },
      { agent: "orchestrator", body: `assistant: ${LEAVE_BODY}` },
      { agent: "hr", body: `result: ${LEAVE_BODY}` },
    ],
    "My VPN isn't connecting. Also, what is the leave approval policy?",
  );
  expect(prompt).toContain("user: What does the leave approval policy say?");
  expect(prompt).not.toContain(LEAVE_BODY);
  expect(plannerInstructions(USERS.alex)).toContain("Do not copy a previous answer");
  expect(plannerInstructions(USERS.alex)).toContain("outsideScope");
  expect(plannerInstructions(USERS.alex)).not.toContain("weather");
  expect(hrInstructions()).toContain("policy subject");
  expect(plannerInstructions(USERS.jordan)).toContain("role-specific entitlement");
  expect(hrInstructions()).toContain("unless the document says so");
});
