import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { USERS } from "../src/identity";
import { modelPort, type ModelPort } from "../src/models";
import { OUTSIDE_SCOPE } from "../src/reply";
import { EQUIPMENT_PROFILE } from "../src/policies";
import { runServiceStatus } from "../src/status";
import { runTurn } from "../src/turn";

const itPlan = {
  tasks: [{ id: "vpn", specialist: "it" as const, objective: "Check the VPN", order: 1, dependsOn: [] }],
};

function unused(): ModelPort["synthesize"] {
  return async () => "not used";
}

it("does not report IT success when the model key is missing", async () => {
  const stub = modelPort(env);
  const live = modelPort({
    SESSION: env.SESSION,
    POLICY: env.POLICY,
    OPENAI_API_KEY: "replace-me",
    MODEL_MODE: "live",
  } as Cloudflare.Env);
  const direct = await live.runIt({
    user: USERS.alex,
    objective: "Check the VPN",
    history: [],
    notes: [],
    signal: AbortSignal.timeout(1_000),
    trace: () => {},
    base: { sessionId: "alex", turnId: "no-key", taskId: "vpn" },
  });
  expect(direct.outcome).toBe("failed");
  expect(direct.statuses).toEqual([]);
  expect(direct.text).toBe("The IT specialist could not be called.");

  const result = await runTurn({
    user: USERS.alex,
    message: "Is the company VPN service operational?",
    turnId: "no-key-turn",
    history: [],
    models: { plan: stub.plan, runIt: live.runIt, runHr: stub.runHr, synthesize: unused() },
  });
  expect(result.outcome).toBe("failed");
  expect(result.trace.some((event) => event.eventType === "specialist.completed" && event.agentId === "it" && event.outcome === "success")).toBe(false);
  expect(result.trace.some((event) => event.eventType === "specialist.completed" && event.agentId === "it" && event.outcome === "failed")).toBe(true);
  expect(result.reply).toBe("The IT specialist could not be called.");
  expect(result.reply).not.toContain("success");
});

it("does not report IT success when the native status tool is denied or fails", async () => {
  const deniedStatus = runServiceStatus({ userId: "alex", agent: "hr", serviceId: "vpn" });
  expect(deniedStatus.ok).toBe(false);
  if (!deniedStatus.ok) expect(deniedStatus.error).toBe("denied");

  const denied: ModelPort = {
    plan: async () => ({ ok: true, repaired: false, plan: itPlan }),
    runIt: async ({ user }) => {
      const status = runServiceStatus({ userId: user.id, agent: "hr", serviceId: "vpn" });
      if (status.ok) return { text: "unexpected", statuses: [status.status], outcome: "success" };
      return {
        text: "The service status tool was denied.",
        statuses: [],
        outcome: status.error === "denied" ? "denied" : "failed",
      };
    },
    runHr: async () => ({ outcome: "success", text: "", report: "" }),
    synthesize: unused(),
  };
  const deniedTurn = await runTurn({
    user: USERS.alex,
    message: "Is the VPN up?",
    turnId: "denied-status",
    history: [],
    models: denied,
  });
  expect(deniedTurn.outcome).toBe("denied");
  expect(deniedTurn.trace.some((event) => event.eventType === "specialist.completed" && event.outcome === "success")).toBe(false);
  expect(deniedTurn.reply).toBe("The service status tool was denied.");
  expect(deniedTurn.reply).not.toContain("success");

  const failedStatus = runServiceStatus({ userId: "alex", agent: "it", serviceId: "not-a-service" });
  expect(failedStatus.ok).toBe(false);
  if (!failedStatus.ok) expect(failedStatus.error).toBe("unknown_service");

  const failed: ModelPort = {
    plan: async () => ({ ok: true, repaired: false, plan: itPlan }),
    runIt: async ({ user }) => {
      const status = runServiceStatus({ userId: user.id, agent: "it", serviceId: "not-a-service" });
      if (status.ok) return { text: "unexpected", statuses: [status.status], outcome: "success" };
      return {
        text: "The service status tool failed.",
        statuses: [],
        outcome: status.error === "denied" ? "denied" : "failed",
      };
    },
    runHr: async () => ({ outcome: "success", text: "", report: "" }),
    synthesize: unused(),
  };
  const failedTurn = await runTurn({
    user: USERS.alex,
    message: "Is the VPN up?",
    turnId: "failed-status",
    history: [],
    models: failed,
  });
  expect(failedTurn.outcome).toBe("failed");
  expect(failedTurn.trace.some((event) => event.eventType === "specialist.completed" && event.agentId === "it" && event.outcome === "failed")).toBe(true);
  expect(failedTurn.reply).toBe("The service status tool failed.");
  expect(failedTurn.reply).not.toContain("success");
});

it("explains an unsupported request without calling a specialist", async () => {
  let delegated = false;
  const models: ModelPort = {
    plan: async () => ({ ok: true, repaired: false, plan: { outsideScope: true, tasks: [] } }),
    runIt: async () => {
      delegated = true;
      return { text: "The IT specialist did not produce a verified result.", statuses: [], outcome: "failed" };
    },
    runHr: async () => {
      delegated = true;
      return { outcome: "failed", text: "The HR specialist did not retrieve a policy.", report: "The HR specialist did not retrieve a policy." };
    },
    synthesize: unused(),
  };
  const result = await runTurn({
    user: USERS.alex,
    message: "What is the weather today?",
    turnId: "outside-scope",
    history: [],
    models,
  });
  expect(delegated).toBe(false);
  expect(result.outcome).toBe("unsupported");
  expect(result.outcome).not.toBe("success");
  expect(result.reply).toBe(OUTSIDE_SCOPE);
  expect(result.reply).not.toContain("weather");
  expect(result.reply).not.toContain("verified result");
  expect(result.trace.some((event) => event.eventType === "delegation.started")).toBe(false);
  expect(result.trace.some((event) => event.eventType === "reply.composed" && event.outcome === "unsupported")).toBe(true);
  expect(result.trace.some((event) => event.eventType === "reply.composed" && event.outcome === "success")).toBe(false);
});

it("keeps a successful IT task that only uses a predecessor handoff", async () => {
  let setupNotes = "";
  const models: ModelPort = {
    plan: async () => ({
      ok: true,
      repaired: false,
      plan: {
        tasks: [
          { id: "profile", specialist: "hr", objective: "profile", order: 1, dependsOn: [] },
          {
            id: "setup",
            specialist: "it",
            objective: "Configure the laptop",
            order: 1,
            dependsOn: [{ taskId: "profile", information: "equipment profile" }],
          },
        ],
      },
    }),
    runIt: async ({ notes }) => {
      setupNotes = notes.map((note) => note.value).join("\n");
      return { text: setupNotes, statuses: [], outcome: "success" };
    },
    runHr: async () => ({
      outcome: "success",
      text: "profile",
      report: "profile",
      handoff: `equipmentProfile=${EQUIPMENT_PROFILE}`,
    }),
    synthesize: unused(),
  };
  const result = await runTurn({
    user: USERS.jordan,
    message: "How should I configure the laptop for my equipment profile?",
    turnId: "handoff-only",
    history: [],
    models,
  });
  expect(setupNotes).toBe(`equipmentProfile=${EQUIPMENT_PROFILE}`);
  expect(result.outcome).toBe("success");
  expect(result.trace.some((event) => event.eventType === "dependency.passed" && event.agentId === "it" && event.result === `equipmentProfile=${EQUIPMENT_PROFILE}`)).toBe(true);
  expect(result.trace.some((event) => event.eventType === "specialist.completed" && event.agentId === "it" && event.outcome === "success")).toBe(true);
  expect(result.trace.some((event) => event.toolId === "getServiceStatus")).toBe(false);
  expect(result.reply).toContain(EQUIPMENT_PROFILE);
});
