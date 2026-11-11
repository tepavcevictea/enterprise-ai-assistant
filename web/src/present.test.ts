import { describe, expect, it } from "vitest";
import { ApiError, errorText } from "./api";
import { conversationTurns, specialistOutcomes, turnStatus } from "./present";
import type { HistoryRow, TraceEvent } from "./types";

function event(partial: Pick<TraceEvent, "eventType" | "agentId"> & Partial<TraceEvent>): TraceEvent {
  return {
    traceId: partial.eventType,
    sessionId: "taylor",
    turnId: "turn-1",
    timestamp: "2026-11-11T17:52:47.157Z",
    ...partial,
  };
}

describe("conversation history", () => {
  it("uses orchestrator lines and leaves specialist history out of the transcript", () => {
    const histories: HistoryRow[] = [
      { agent: "orchestrator", turnId: "turn-1", body: "user: Is the VPN operational?" },
      { agent: "it", turnId: "turn-1", body: "task: Check the VPN." },
      { agent: "it", turnId: "turn-1", body: "result: The gateway is degraded." },
      { agent: "hr", turnId: "turn-1", body: "result: The policy service is unavailable." },
      { agent: "orchestrator", turnId: "turn-1", body: "assistant: The VPN is degraded.\n\nThe policy service is unavailable." },
    ];
    expect(conversationTurns(histories)).toEqual([
      {
        turnId: "turn-1",
        question: "Is the VPN operational?",
        reply: "The VPN is degraded.\n\nThe policy service is unavailable.",
      },
    ]);
  });
});

describe("partial success", () => {
  const mixed = [
    event({ eventType: "delegation.completed", agentId: "it", taskId: "vpn", outcome: "success" }),
    event({ eventType: "delegation.completed", agentId: "hr", taskId: "leave", outcome: "unavailable" }),
    event({ eventType: "reply.composed", agentId: "orchestrator", outcome: "success" }),
  ];

  it("keeps a successful IT task and an unavailable HR task visible together", () => {
    expect(turnStatus(mixed, "turn-1")).toBe("partial");
    expect(specialistOutcomes(mixed, "turn-1")).toEqual([
      { agent: "it", taskId: "vpn", outcome: "success" },
      { agent: "hr", taskId: "leave", outcome: "unavailable" },
    ]);
  });

  it("calls a single successful specialist completed", () => {
    const traces = [event({ eventType: "delegation.completed", agentId: "it", outcome: "success" })];
    expect(turnStatus(traces, "turn-1")).toBe("success");
  });

  it("keeps an orchestrator denial without calling it a success", () => {
    const traces = [event({ eventType: "permission.denied", agentId: "orchestrator", outcome: "denied" })];
    expect(turnStatus(traces, "turn-1")).toBe("denied");
  });
});

describe("error text", () => {
  it("explains a busy session and an unreachable service", () => {
    expect(errorText(new ApiError(409, "turn_active"))).toContain("already running");
    expect(errorText(new TypeError("Failed to fetch"))).toContain("not reachable");
  });
});
