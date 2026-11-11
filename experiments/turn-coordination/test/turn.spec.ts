import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/worker";
import { expect, it } from "vitest";
import {
  SessionObject,
  TURN_BUDGET_MS,
  type Snapshot,
  type TurnCommand,
} from "../src/session";

function stub(user: string) {
  return env.SESSION.getByName(user);
}

async function post(user: string, body: unknown): Promise<Response> {
  return stub(user).fetch("https://session.local/turn", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function read(user: string): Promise<Snapshot> {
  const response = await post(user, { action: "read" });
  expect(response.status).toBe(200);
  return response.json<Snapshot>();
}

async function reset(user: string): Promise<void> {
  const response = await post(user, { action: "reset-session" });
  expect(response.status).toBe(200);
}

async function arm(user: string): Promise<void> {
  await runInDurableObject(stub(user), (instance) => {
    (instance as SessionObject).armHold();
  });
}

async function release(user: string): Promise<void> {
  await runInDurableObject(stub(user), (instance) => {
    (instance as SessionObject).releaseHold();
  });
}

function command(
  overrides: Partial<TurnCommand> &
    Pick<TurnCommand, "turnId" | "idempotencyKey" | "requestHash" | "marker">,
): TurnCommand {
  return { now: 0, ...overrides };
}

async function waitForTurn(user: string, turnId: string): Promise<Snapshot> {
  const started = Date.now();
  for (;;) {
    const snapshot = await read(user);
    if (snapshot.activeTurn === turnId) return snapshot;
    if (Date.now() - started > 5_000) {
      throw new Error(`turn ${turnId} was not reserved`);
    }
    await scheduler.wait(10);
  }
}

it("reserves one turn and rejects the overlapping request with 409", async () => {
  await reset("jordan");
  await arm("jordan");
  const first = post("jordan", {
    action: "run",
    command: command({
      turnId: "jordan-a",
      idempotencyKey: "jordan-overlap-a",
      requestHash: "hash-a",
      marker: "first-response",
      hold: true,
      entries: [{ agent: "orchestrator", body: "jordan turn a" }],
    }),
  });
  const reserved = await waitForTurn("jordan", "jordan-a");
  expect(reserved.name).toBe("jordan");

  const raced = await Promise.race([
    post("jordan", {
      action: "run",
      command: command({
        turnId: "jordan-b",
        idempotencyKey: "jordan-overlap-b",
        requestHash: "hash-b",
        marker: "second-response",
        now: 10,
      }),
    }),
    scheduler.wait(2_000).then(() => "blocked" as const),
  ]);
  expect(raced).not.toBe("blocked");
  if (raced === "blocked") return;
  expect(raced.status).toBe(409);
  expect(await raced.json()).toEqual({ error: "turn_active" });

  await release("jordan");
  const completed = await first;
  expect(completed.status).toBe(200);
  const body = await completed.json<{ wrote: boolean; replay: boolean }>();
  expect(body.wrote).toBe(true);
  expect(body.replay).toBe(false);
  const snapshot = await read("jordan");
  expect(snapshot.activeTurn).toBeNull();
  expect(snapshot.histories.map((entry) => entry.body)).toEqual(["jordan turn a"]);
});

it("replays a completed key and rejects the same key with a different payload", async () => {
  await reset("alex");
  const first = await post("alex", {
    action: "run",
    command: command({
      turnId: "alex-idem",
      idempotencyKey: "alex-idem-key",
      requestHash: "hash-one",
      marker: "stored-response-alpha",
      entries: [{ agent: "it", body: "reset simulated once" }],
    }),
  });
  expect(first.status).toBe(200);
  const stored = await first.json<{ response: { marker: string } }>();
  expect(stored.response.marker).toBe("stored-response-alpha");
  const afterFirst = await read("alex");

  const replay = await post("alex", {
    action: "run",
    command: command({
      turnId: "alex-idem-retry",
      idempotencyKey: "alex-idem-key",
      requestHash: "hash-one",
      marker: "stored-response-alpha",
      entries: [{ agent: "it", body: "this must not be appended" }],
    }),
  });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({
    replay: true,
    response: { turnId: "alex-idem", marker: "stored-response-alpha" },
  });
  const afterReplay = await read("alex");
  expect(afterReplay.operationRuns).toBe(afterFirst.operationRuns);
  expect(afterReplay.histories).toEqual(afterFirst.histories);

  const mismatch = await post("alex", {
    action: "run",
    command: command({
      turnId: "alex-idem-other",
      idempotencyKey: "alex-idem-key",
      requestHash: "hash-two",
      marker: "unrelated-response",
      entries: [{ agent: "hr", body: "unrelated history" }],
    }),
  });
  expect(mismatch.status).toBe(409);
  const mismatchBody = await mismatch.json<{ error: string; response?: unknown }>();
  expect(mismatchBody).toEqual({ error: "idempotency_mismatch" });
  expect(JSON.stringify(mismatchBody)).not.toContain("stored-response-alpha");
  const afterMismatch = await read("alex");
  expect(afterMismatch.histories).toEqual(afterFirst.histories);
  expect(afterMismatch.operationRuns).toBe(afterFirst.operationRuns);
});

it("rejects an old idempotency key after session reset", async () => {
  await reset("alex");
  const completed = await post("alex", {
    action: "run",
    command: command({
      turnId: "alex-old-session",
      idempotencyKey: "alex-old-session-key",
      requestHash: "hash-old-session",
      marker: "old-session-marker",
      entries: [{ agent: "hr", body: "old conversation" }],
      resetTarget: "alex",
    }),
  });
  expect(completed.status).toBe(200);
  const before = await read("alex");
  expect(before.histories.map((entry) => entry.body)).toEqual(["old conversation"]);
  expect(before.resets).toHaveLength(1);

  const cleared = await post("alex", { action: "reset-session" });
  expect(cleared.status).toBe(200);
  const clearedSnapshot = await cleared.json<Snapshot>();
  expect(clearedSnapshot.generation).toBe(before.generation + 1);
  expect(clearedSnapshot.histories).toEqual([]);
  expect(clearedSnapshot.resets).toEqual(before.resets);

  const retry = await post("alex", {
    action: "run",
    command: command({
      turnId: "alex-old-session-retry",
      idempotencyKey: "alex-old-session-key",
      requestHash: "hash-old-session",
      marker: "old-session-marker",
      entries: [{ agent: "hr", body: "old conversation" }],
      resetTarget: "alex",
    }),
  });
  expect(retry.status).toBe(409);
  const retryBody = await retry.text();
  expect(JSON.parse(retryBody)).toEqual({ error: "stale_session" });
  expect(retryBody).not.toContain("old-session-marker");
  expect(retryBody).not.toContain("old conversation");

  const changed = await post("alex", {
    action: "run",
    command: command({
      turnId: "alex-old-session-other",
      idempotencyKey: "alex-old-session-key",
      requestHash: "hash-changed",
      marker: "different-marker",
      entries: [{ agent: "it", body: "should not run" }],
    }),
  });
  expect(changed.status).toBe(409);
  expect(await changed.json()).toEqual({ error: "stale_session" });

  const afterRejection = await read("alex");
  expect(afterRejection.operationRuns).toBe(before.operationRuns);
  expect(afterRejection.histories).toEqual([]);
  expect(afterRejection.resets).toEqual(before.resets);

  const fresh = await post("alex", {
    action: "run",
    command: command({
      turnId: "alex-new-session",
      idempotencyKey: "alex-new-session-key",
      requestHash: "hash-new-session",
      marker: "new-session-marker",
      entries: [{ agent: "orchestrator", body: "new conversation" }],
    }),
  });
  expect(fresh.status).toBe(200);
  const afterFresh = await read("alex");
  expect(afterFresh.histories.map((entry) => entry.body)).toEqual(["new conversation"]);
  expect(afterFresh.operationRuns).toBe(before.operationRuns + 1);
});

it("keeps one simulated reset row for two executions in the same turn", async () => {
  await reset("jordan");
  await arm("jordan");
  const running = post("jordan", {
    action: "run",
    command: command({
      turnId: "jordan-reset",
      idempotencyKey: "jordan-reset-key",
      requestHash: "hash-reset",
      marker: "reset-turn",
      hold: true,
    }),
  });
  await waitForTurn("jordan", "jordan-reset");

  const [first, second] = await Promise.all([
    post("jordan", {
      action: "simulate-reset",
      turnId: "jordan-reset",
      targetUser: "jordan",
    }),
    post("jordan", {
      action: "simulate-reset",
      turnId: "jordan-reset",
      targetUser: "jordan",
    }),
  ]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const firstRow = await first.json<{ id: number; turnId: string; targetUser: string }>();
  const secondRow = await second.json<{ id: number; turnId: string; targetUser: string }>();
  expect(firstRow).toEqual(secondRow);
  expect((await read("jordan")).resets).toEqual([firstRow]);

  await release("jordan");
  expect((await running).status).toBe(200);
});

it("drops history, traces, and resets from a replaced turn", async () => {
  await reset("alex");
  await arm("alex");
  const stale = post("alex", {
    action: "run",
    command: command({
      turnId: "alex-old",
      idempotencyKey: "alex-old-key",
      requestHash: "hash-old",
      marker: "old-marker",
      hold: true,
      now: 0,
      entries: [{ agent: "hr", body: "stale hr history" }],
      trace: { eventType: "tool.invoked", detail: "stale trace" },
      resetTarget: "alex",
    }),
  });
  await waitForTurn("alex", "alex-old");

  const replacement = await post("alex", {
    action: "run",
    command: command({
      turnId: "alex-new",
      idempotencyKey: "alex-new-key",
      requestHash: "hash-new",
      marker: "new-marker",
      now: TURN_BUDGET_MS,
      entries: [{ agent: "it", body: "replacement history" }],
    }),
  });
  expect(replacement.status).toBe(200);
  const during = await read("alex");
  expect(during.activeTurn).toBeNull();
  expect(during.abandonedTurn).toBe("alex-old");

  const staleReset = await post("alex", {
    action: "simulate-reset",
    turnId: "alex-old",
    targetUser: "alex",
  });
  expect(staleReset.status).toBe(409);
  expect(await staleReset.json()).toEqual({ error: "stale_turn", wrote: false });

  await release("alex");
  const staleResult = await stale;
  expect(staleResult.status).toBe(409);
  expect(await staleResult.json()).toEqual({ replay: false, wrote: false });

  const snapshot = await read("alex");
  expect(snapshot.histories).toEqual([
    { agent: "it", turnId: "alex-new", body: "replacement history" },
  ]);
  expect(snapshot.traces).toEqual([]);
  expect(
    snapshot.resets.filter(
      (row) => row.turnId === "alex-old" || row.turnId === "alex-new",
    ),
  ).toEqual([]);
});

it("clears alex without changing jordan or taylor, and ignores the in-flight result", async () => {
  await reset("alex");
  await reset("jordan");
  await reset("taylor");
  expect(
    (
      await post("jordan", {
        action: "run",
        command: command({
          turnId: "jordan-kept",
          idempotencyKey: "jordan-kept-key",
          requestHash: "hash-jordan",
          marker: "jordan-marker",
          entries: [{ agent: "it", body: "jordan kept" }],
          pending: "jordan question",
        }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post("taylor", {
        action: "run",
        command: command({
          turnId: "taylor-kept",
          idempotencyKey: "taylor-kept-key",
          requestHash: "hash-taylor",
          marker: "taylor-marker",
          entries: [{ agent: "hr", body: "taylor kept" }],
        }),
      })
    ).status,
  ).toBe(200);

  expect(
    (
      await post("alex", {
        action: "run",
        command: command({
          turnId: "alex-before",
          idempotencyKey: "alex-before-key",
          requestHash: "hash-before",
          marker: "before-marker",
          entries: [{ agent: "orchestrator", body: "alex before reset" }],
          pending: "which account?",
          trace: { eventType: "clarification", detail: "account" },
        }),
      })
    ).status,
  ).toBe(200);

  await arm("alex");
  const late = post("alex", {
    action: "run",
    command: command({
      turnId: "alex-late",
      idempotencyKey: "alex-late-key",
      requestHash: "hash-late",
      marker: "late-marker",
      hold: true,
      entries: [{ agent: "orchestrator", body: "repopulated after reset" }],
      pending: "should stay empty",
      trace: { eventType: "late", detail: "late trace" },
    }),
  });
  await waitForTurn("alex", "alex-late");
  const cleared = await post("alex", { action: "reset-session" });
  expect(cleared.status).toBe(200);
  await release("alex");
  expect((await late).status).toBe(409);

  const alex = await read("alex");
  expect(alex.histories).toEqual([]);
  expect(alex.traces).toEqual([]);
  expect(alex.pending).toBeNull();
  expect(alex.activeTurn).toBeNull();
  expect(await read("jordan")).toMatchObject({
    histories: [{ agent: "it", turnId: "jordan-kept", body: "jordan kept" }],
    pending: "jordan question",
  });
  expect(await read("taylor")).toMatchObject({
    histories: [{ agent: "hr", turnId: "taylor-kept", body: "taylor kept" }],
  });
});

it("keeps orchestrator, IT, and HR histories separate", async () => {
  await reset("taylor");
  const response = await post("taylor", {
    action: "run",
    command: command({
      turnId: "taylor-histories",
      idempotencyKey: "taylor-histories-key",
      requestHash: "hash-histories",
      marker: "histories",
      entries: [
        { agent: "orchestrator", body: "plan only" },
        { agent: "it", body: "vpn status up" },
        { agent: "hr", body: "leave policy" },
      ],
    }),
  });
  expect(response.status).toBe(200);
  const snapshot = await read("taylor");
  expect(snapshot.histories.filter((entry) => entry.agent === "it")).toEqual([
    { agent: "it", turnId: "taylor-histories", body: "vpn status up" },
  ]);
  expect(snapshot.histories.filter((entry) => entry.agent === "hr")).toEqual([
    { agent: "hr", turnId: "taylor-histories", body: "leave policy" },
  ]);
  expect(snapshot.histories.filter((entry) => entry.agent === "orchestrator")).toEqual([
    { agent: "orchestrator", turnId: "taylor-histories", body: "plan only" },
  ]);

  const followUp = await post("taylor", {
    action: "run",
    command: command({
      turnId: "taylor-hr-only",
      idempotencyKey: "taylor-hr-only-key",
      requestHash: "hash-hr-only",
      marker: "hr-follow-up",
      now: TURN_BUDGET_MS,
      entries: [{ agent: "hr", body: "second hr note" }],
    }),
  });
  expect(followUp.status).toBe(200);
  const after = await read("taylor");
  expect(after.histories.filter((entry) => entry.agent === "it")).toEqual([
    { agent: "it", turnId: "taylor-histories", body: "vpn status up" },
  ]);
  expect(after.histories.filter((entry) => entry.agent === "hr").map((entry) => entry.body)).toEqual([
    "leave policy",
    "second hr note",
  ]);
});

it("rejects a client-supplied object id", async () => {
  const response = await worker.fetch(
    new Request("https://app.local/session", {
      method: "POST",
      body: JSON.stringify({ userId: "alex", objectId: "not-a-name" }),
    }),
    env,
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "object_id_rejected" });
});
