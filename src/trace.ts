import type { AgentId } from "./capabilities";

export type TraceEvent = {
  traceId: string;
  sessionId: string;
  turnId: string;
  taskId?: string;
  agentId: AgentId;
  eventType: string;
  timestamp: string;
  durationMs?: number;
  outcome?: string;
  toolId?: string;
  errorCode?: string;
  authorization?: "allowed" | "denied";
  sourceIds?: string[];
  result?: string;
};

export function traceEvent(
  base: { sessionId: string; turnId: string },
  event: Omit<TraceEvent, "traceId" | "sessionId" | "turnId" | "timestamp"> & {
    timestamp?: string;
  },
): TraceEvent {
  return {
    traceId: crypto.randomUUID(),
    sessionId: base.sessionId,
    turnId: base.turnId,
    timestamp: event.timestamp ?? new Date().toISOString(),
    ...event,
  };
}
