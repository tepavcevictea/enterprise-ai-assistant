import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
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
