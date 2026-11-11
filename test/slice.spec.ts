import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { offeredToolIds } from "../src/models";
import { scheduleTasks } from "../src/schedule";
import { SessionObject, type Snapshot } from "../src/session";
import { runServiceStatus, VPN_DETAIL } from "../src/status";
import worker from "../src/worker";
import type { TraceEvent } from "../src/trace";

function session(user: string) {
  return env.SESSION.getByName(user);
}

async function send(user: string, body: unknown, path = "/messages"): Promise<Response> {
  return worker.fetch(
    new Request(`https://app.local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": user },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function read(user: string): Promise<Snapshot> {
  const response = await worker.fetch(
    new Request("https://app.local/session", { headers: { "x-demo-user": user } }),
    env,
  );
  expect(response.status).toBe(200);
  return response.json<Snapshot>();
}

async function reset(user: string): Promise<void> {
  const response = await send(user, {}, "/session/reset");
  expect(response.status).toBe(200);
}

async function arm(user: string): Promise<void> {
  await runInDurableObject(session(user), (instance) => {
    (instance as SessionObject).armHold();
  });
}

async function release(user: string): Promise<void> {
  await runInDurableObject(session(user), (instance) => {
    (instance as SessionObject).releaseHold();
  });
}

async function waitForActive(user: string): Promise<Snapshot> {
  const started = Date.now();
  for (;;) {
    const snapshot = await read(user);
    if (snapshot.activeTurn !== null) return snapshot;
    if (Date.now() - started > 5_000) throw new Error("turn was not reserved");
    await scheduler.wait(10);
  }
}

it("rejects a client-supplied object id before selecting a session", async () => {
  const response = await send("alex", { objectId: "other", message: "hello", idempotencyKey: "obj" });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "object_id_rejected" });
});

it("rejects an unknown demo user", async () => {
  const response = await worker.fetch(
    new Request("https://app.local/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "sam" },
      body: JSON.stringify({ message: "hello", idempotencyKey: "sam" }),
    }),
    env,
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "unknown_user" });
});

it("denies service status to the orchestrator and allows it for the IT specialist", () => {
  expect(runServiceStatus({ userId: "alex", agent: "orchestrator", serviceId: "vpn" })).toEqual({
    ok: false,
    authorization: "denied",
    error: "denied",
  });
  const allowed = runServiceStatus({ userId: "alex", agent: "it", serviceId: "vpn" });
  expect(allowed.ok).toBe(true);
  if (allowed.ok) expect(allowed.status.detail).toBe(VPN_DETAIL);
  expect(offeredToolIds("alex", "orchestrator")).toEqual([]);
  expect(offeredToolIds("alex", "hr")).toEqual([]);
  expect(offeredToolIds("alex", "it")).toEqual(["getServiceStatus"]);
});

it("does not run a task whose predecessor failed", async () => {
  const order: string[] = [];
  const results = await scheduleTasks({
    tasks: [
      {
        id: "policy",
        specialist: "hr",
        objective: "Look up the profile",
        order: 1,
        dependsOn: [],
      },
      {
        id: "setup",
        specialist: "it",
        objective: "Configure the laptop",
        order: 1,
        dependsOn: [{ taskId: "policy", information: "equipment profile" }],
      },
    ],
    run: async (task) => {
      order.push(task.id);
      return {
        taskId: task.id,
        specialist: task.specialist,
        outcome: "unavailable",
        text: "not run",
      };
    },
  });
  expect(order).toEqual(["policy"]);
  expect(results.find((result) => result.taskId === "setup")?.outcome).toBe("unavailable");
});

it("passes a predecessor value to the next specialist without a fixed business field", async () => {
  let seen = "";
  await scheduleTasks({
    tasks: [
      { id: "policy", specialist: "hr", objective: "Look up the profile", order: 1, dependsOn: [] },
      {
        id: "setup",
        specialist: "it",
        objective: "Configure the laptop",
        order: 1,
        dependsOn: [{ taskId: "policy", information: "equipment profile" }],
      },
    ],
    run: async (task, notes) => {
      if (task.id === "setup") seen = notes.map((note) => `${note.information}=${note.value}`).join("|");
      return {
        taskId: task.id,
        specialist: task.specialist,
        outcome: "success",
        text: task.id,
        handoff: { value: task.id === "policy" ? "standard-laptop" : "configured" },
      };
    },
  });
  expect(seen).toBe("equipment profile=standard-laptop");
});

it("returns the VPN status from the IT specialist and keeps histories separate", async () => {
  await reset("alex");
  await reset("jordan");
  const response = await send("alex", {
    message: "unique-user-phrase for the session",
    idempotencyKey: "alex-status-1",
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ reply: string; outcome: string; trace: TraceEvent[] }>();
  expect(body.outcome).toBe("success");
  expect(body.reply).toContain(VPN_DETAIL);
  expect(body.reply).toContain("Here is the explanation.");
  expect(body.trace.map((event) => event.eventType)).toEqual([
    "plan.validated",
    "delegation.started",
    "specialist.started",
    "tool.offered",
    "tool.invoked",
    "tool.result",
    "specialist.completed",
    "delegation.completed",
    "synthesis.completed",
  ]);
  const invoked = body.trace.find((event) => event.eventType === "tool.invoked");
  expect(invoked?.toolId).toBe("getServiceStatus");
  expect(invoked?.agentId).toBe("it");
  expect(body.trace.find((event) => event.eventType === "tool.result")?.result).toBe(VPN_DETAIL);
  expect(body.trace.every((event) => event.agentId !== "orchestrator" || event.toolId === undefined)).toBe(true);

  const alex = await read("alex");
  expect(alex.histories.some((row) => row.agent === "orchestrator" && row.body.includes("unique-user-phrase"))).toBe(true);
  expect(alex.histories.some((row) => row.agent === "it" && row.body.includes("unique-user-phrase"))).toBe(false);
  expect(alex.histories.some((row) => row.agent === "it" && row.body.includes("Status checked."))).toBe(true);
  const jordan = await read("jordan");
  expect(jordan.histories).toEqual([]);
});

it("replays a completed key and rejects the same key with a different message", async () => {
  await reset("taylor");
  const first = await send("taylor", { message: "first status question", idempotencyKey: "taylor-key" });
  expect(first.status).toBe(200);
  const stored = await first.json<{ reply: string }>();
  const replay = await send("taylor", { message: "first status question", idempotencyKey: "taylor-key" });
  expect(replay.status).toBe(200);
  const replayed = await replay.json<{ reply: string; replay: boolean }>();
  expect(replayed.replay).toBe(true);
  expect(replayed.reply).toBe(stored.reply);
  const snapshot = await read("taylor");
  expect(snapshot.histories.filter((row) => row.body.includes("first status question"))).toHaveLength(1);

  const mismatch = await send("taylor", { message: "different question", idempotencyKey: "taylor-key" });
  expect(mismatch.status).toBe(409);
  expect(await mismatch.json()).toEqual({ error: "idempotency_mismatch" });
});

it("rejects an old idempotency key after session reset", async () => {
  await reset("alex");
  const first = await send("alex", { message: "remember this phrase", idempotencyKey: "alex-old-key" });
  expect(first.status).toBe(200);
  const before = await read("alex");
  await reset("alex");
  const after = await read("alex");
  expect(after.generation).toBe(before.generation + 1);
  expect(after.histories).toEqual([]);
  const retry = await send("alex", { message: "remember this phrase", idempotencyKey: "alex-old-key" });
  expect(retry.status).toBe(409);
  expect(await retry.json()).toEqual({ error: "stale_session" });
  expect((await read("alex")).histories).toEqual([]);
});

it("rejects an overlapping turn and drops a stale write", async () => {
  await reset("jordan");
  await arm("jordan");
  const first = send("jordan", { message: "held turn", idempotencyKey: "jordan-held" });
  const reserved = await waitForActive("jordan");
  const overlap = await send("jordan", { message: "second turn", idempotencyKey: "jordan-second" });
  expect(overlap.status).toBe(409);
  expect(await overlap.json()).toEqual({ error: "turn_active" });

  await runInDurableObject(session("jordan"), (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE meta SET value = ? WHERE key = 'active_started_at'`,
      String(Date.now() - 120_000),
    );
  });
  const replacement = send("jordan", { message: "replacement turn", idempotencyKey: "jordan-replacement" });
  const started = Date.now();
  for (;;) {
    const snapshot = await read("jordan");
    if (snapshot.activeTurn !== null && snapshot.activeTurn !== reserved.activeTurn) break;
    if (Date.now() - started > 5_000) throw new Error("replacement was not reserved");
    await scheduler.wait(10);
  }
  await release("jordan");
  expect((await first).status).toBe(409);
  expect((await replacement).status).toBe(200);
  const snapshot = await read("jordan");
  expect(snapshot.abandonedTurn).toBe(reserved.activeTurn);
  expect(snapshot.histories.some((row) => row.turnId === reserved.activeTurn)).toBe(false);
  expect(snapshot.histories.some((row) => row.body.includes("replacement turn"))).toBe(true);
  expect(snapshot.histories.some((row) => row.body.includes("held turn"))).toBe(false);
});
