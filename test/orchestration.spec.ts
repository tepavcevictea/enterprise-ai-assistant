import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { USERS } from "../src/identity";
import type { ModelPort } from "../src/models";
import { EQUIPMENT_BODY, EQUIPMENT_PROFILE, LEAVE_BODY } from "../src/policies";
import { FACT_BLOCKED, PREDECESSOR_BLOCKED, scheduleTasks } from "../src/schedule";
import { SessionObject, type Snapshot } from "../src/session";
import { VPN_DETAIL } from "../src/status";
import type { TraceEvent } from "../src/trace";
import { runTurn } from "../src/turn";
import worker from "../src/worker";

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

async function read(user: string): Promise<Snapshot> {
  const response = await worker.fetch(
    new Request("https://app.local/session", { headers: { "x-demo-user": user } }),
    env,
  );
  return response.json<Snapshot>();
}

it("starts independent IT and HR work before either specialist finishes", async () => {
  let started = 0;
  let release = () => {};
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enter = async () => {
    started += 1;
    if (started === 2) release();
    else {
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("specialists did not overlap")), 500);
      });
      await Promise.race([bothStarted, timeout]);
    }
  };
  const models: ModelPort = {
    plan: async () => ({
      ok: true,
      repaired: false,
      plan: {
        tasks: [
          { id: "leave", specialist: "hr", objective: "leave", order: 2, dependsOn: [] },
          { id: "vpn", specialist: "it", objective: "vpn", order: 1, dependsOn: [] },
        ],
      },
    }),
    runIt: async () => {
      await enter();
      await scheduler.wait(30);
      return {
        text: "Status checked.",
        statuses: [{ serviceId: "vpn", operational: false, state: "degraded", detail: VPN_DETAIL }],
        outcome: "success",
      };
    },
    runHr: async () => {
      await enter();
      return { outcome: "success", text: LEAVE_BODY, report: LEAVE_BODY, handoff: "none" };
    },
    synthesize: async () => "not used",
  };
  const result = await runTurn({
    user: USERS.alex,
    message: "My VPN isn't connecting. Also, what is the leave approval policy?",
    turnId: "overlap",
    history: [],
    models,
  });
  const itStart = result.trace.findIndex((event) => event.eventType === "specialist.started" && event.agentId === "it");
  const hrStart = result.trace.findIndex((event) => event.eventType === "specialist.started" && event.agentId === "hr");
  const itDone = result.trace.findIndex((event) => event.eventType === "specialist.completed" && event.agentId === "it");
  const hrDone = result.trace.findIndex((event) => event.eventType === "specialist.completed" && event.agentId === "hr");
  expect(itStart).toBeGreaterThanOrEqual(0);
  expect(hrStart).toBeGreaterThanOrEqual(0);
  expect(Math.max(itStart, hrStart)).toBeLessThan(Math.min(itDone, hrDone));
  expect(result.reply.indexOf(VPN_DETAIL)).toBeGreaterThanOrEqual(0);
  expect(result.reply.indexOf(VPN_DETAIL)).toBeLessThan(result.reply.indexOf(LEAVE_BODY));
  expect(result.reply.split(VPN_DETAIL).length - 1).toBe(1);
  expect(result.reply.split(LEAVE_BODY).length - 1).toBe(1);
  expect(result.reply).not.toContain("IT: success");
  expect(result.reply).not.toContain("HR: success");
});

it("passes the equipment profile to IT and blocks a missing or failed predecessor", async () => {
  let setupNotes = "";
  const passed = await scheduleTasks({
    tasks: [
      { id: "profile", specialist: "hr", objective: "profile", order: 1, dependsOn: [] },
      {
        id: "setup",
        specialist: "it",
        objective: "configure",
        order: 1,
        dependsOn: [{ taskId: "profile", information: "equipment profile" }],
      },
    ],
    run: async (task, notes) => {
      if (task.id === "setup") setupNotes = notes.map((note) => `${note.information}=${note.value}`).join("|");
      return {
        taskId: task.id,
        specialist: task.specialist,
        outcome: "success",
        text: task.id,
        handoff: { value: task.id === "profile" ? `equipmentProfile=${EQUIPMENT_PROFILE}` : "configured" },
      };
    },
  });
  expect(setupNotes).toBe(`equipment profile=equipmentProfile=${EQUIPMENT_PROFILE}`);
  expect(passed.find((result) => result.taskId === "setup")?.outcome).toBe("success");

  const ran: string[] = [];
  const blocked = await scheduleTasks({
    tasks: [
      { id: "profile", specialist: "hr", objective: "profile", order: 1, dependsOn: [] },
      {
        id: "setup",
        specialist: "it",
        objective: "configure",
        order: 1,
        dependsOn: [{ taskId: "profile", information: "equipment profile" }],
      },
    ],
    run: async (task) => {
      ran.push(`${task.id}:${task.objective}`);
      return {
        taskId: task.id,
        specialist: task.specialist,
        outcome: task.id === "profile" ? "unavailable" : "success",
        text: "invented standard-laptop",
      };
    },
  });
  expect(ran).toEqual(["profile:profile"]);
  const setup = blocked.find((result) => result.taskId === "setup");
  expect(setup?.outcome).toBe("unavailable");
  expect(setup?.blocked).toBe("predecessor");
  expect(setup?.text).toBe(PREDECESSOR_BLOCKED);
  expect(setup?.text).not.toContain(EQUIPMENT_PROFILE);

  const missing = await scheduleTasks({
    tasks: [
      { id: "profile", specialist: "hr", objective: "profile", order: 1, dependsOn: [] },
      {
        id: "setup",
        specialist: "it",
        objective: "configure",
        order: 1,
        dependsOn: [{ taskId: "profile", information: "equipment profile" }],
      },
    ],
    run: async (task) => ({
      taskId: task.id,
      specialist: task.specialist,
      outcome: "success",
      text: task.id,
      handoff: { value: "none" },
    }),
  });
  expect(missing.find((result) => result.taskId === "setup")?.blocked).toBe("missing_fact");
  expect(missing.find((result) => result.taskId === "setup")?.text).toBe(FACT_BLOCKED);
});

it("gives IT the authorized equipment fact and not the policy body", async () => {
  await reset("jordan");
  await runInDurableObject(session("jordan"), (instance) => {
    (instance as SessionObject).armPlan({
      tasks: [
        { id: "profile", specialist: "hr", objective: "equipment", order: 1, dependsOn: [] },
        {
          id: "setup",
          specialist: "it",
          objective: "Configure the laptop",
          order: 1,
          dependsOn: [{ taskId: "profile", information: "equipment profile" }],
        },
      ],
    });
  });
  const response = await send("jordan", {
    message: "How should I configure the laptop for my equipment profile?",
    idempotencyKey: "jordan-profile",
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ reply: string; outcome: string; trace: TraceEvent[] }>();
  expect(body.outcome).toBe("success");
  const passed = body.trace.find((event) => event.eventType === "dependency.passed" && event.agentId === "it");
  expect(passed?.result).toBe(`equipmentProfile=${EQUIPMENT_PROFILE}`);
  const hrDone = body.trace.find((event) => event.eventType === "specialist.completed" && event.agentId === "hr");
  const itStart = body.trace.find((event) => event.eventType === "specialist.started" && event.agentId === "it");
  expect(hrDone?.timestamp !== undefined && itStart?.timestamp !== undefined && hrDone.timestamp <= itStart.timestamp).toBe(true);
  expect(body.reply).toContain(EQUIPMENT_PROFILE);
  expect(body.reply).not.toContain(EQUIPMENT_BODY);
  expect(body.trace.some((event) => event.toolId === "getServiceStatus")).toBe(false);

  const jordan = await read("jordan");
  expect(jordan.histories.some((row) => row.agent === "hr" && row.body.includes(EQUIPMENT_BODY))).toBe(true);
  expect(jordan.histories.some((row) => row.agent === "it" && row.body.includes(EQUIPMENT_BODY))).toBe(false);
  expect(jordan.histories.some((row) => row.agent === "it" && row.body.includes(`equipmentProfile=${EQUIPMENT_PROFILE}`))).toBe(true);
  expect(jordan.histories.some((row) => row.agent === "hr" && row.body.includes("ns-vpn-degraded"))).toBe(false);
});

it("does not run a dependent IT task when the policy lookup fails", async () => {
  await reset("alex");
  await runInDurableObject(session("alex"), (instance) => {
    const object = instance as SessionObject;
    object.armPlan({
      tasks: [
        { id: "profile", specialist: "hr", objective: "equipment", order: 1, dependsOn: [] },
        {
          id: "setup",
          specialist: "it",
          objective: "Configure the laptop",
          order: 1,
          dependsOn: [{ taskId: "profile", information: "equipment profile" }],
        },
      ],
    });
    object.armMcpMode("error");
  });
  const response = await send("alex", {
    message: "Configure my laptop from the equipment profile.",
    idempotencyKey: "alex-profile-error",
  });
  const body = await response.json<{ reply: string; trace: TraceEvent[] }>();
  expect(body.reply).toContain("The policy service is unavailable.");
  expect(body.reply).not.toContain(EQUIPMENT_PROFILE);
  expect(body.reply).not.toContain(VPN_DETAIL);
  expect(body.trace.some((event) => event.eventType === "dependency.blocked" && event.agentId === "it" && event.errorCode === "predecessor")).toBe(true);
  expect(body.trace.some((event) => event.eventType === "specialist.started" && event.agentId === "it")).toBe(false);
  const alex = await read("alex");
  expect(alex.histories.some((row) => row.agent === "it")).toBe(false);
});
