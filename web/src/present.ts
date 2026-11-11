import type { AgentId, HistoryRow, TraceEvent } from "./types";

export type TurnStatus = "success" | "partial" | "denied" | "unavailable" | "failed" | "needs_input" | "unknown";

export type SpecialistOutcome = {
  agent: AgentId;
  taskId?: string;
  outcome: string;
};

export type ConversationTurn = {
  turnId: string;
  question: string;
  reply: string;
};

const STATUS_LABEL: Record<TurnStatus, string> = {
  success: "Completed",
  partial: "Partial result",
  denied: "Not permitted",
  unavailable: "Unavailable",
  failed: "Could not complete",
  needs_input: "More information needed",
  unknown: "Recorded",
};

const OUTCOME_LABEL: Record<string, string> = {
  success: "Completed",
  denied: "Not permitted",
  unavailable: "Unavailable",
  failed: "Could not complete",
  needs_input: "More information needed",
};

const EVENT_LABEL: Record<string, string> = {
  "plan.validated": "Plan accepted",
  "plan.repaired": "Plan repaired",
  "plan.rejected": "Plan rejected",
  "plan.tasks": "Planned tasks",
  "delegation.started": "Delegation started",
  "delegation.completed": "Delegation completed",
  "specialist.started": "Specialist started",
  "specialist.completed": "Specialist finished",
  "tool.discovered": "Tool discovered",
  "tool.offered": "Tool offered",
  "tool.invoked": "Tool called",
  "tool.result": "Tool result",
  "tool.denied": "Tool denied",
  "permission.denied": "Permission denied",
  "dependency.passed": "Dependency passed",
  "dependency.blocked": "Dependency blocked",
  "skill.loaded": "Skill loaded",
  "reply.composed": "Reply composed",
};

export function agentLabel(agent: string): string {
  if (agent === "it") return "IT specialist";
  if (agent === "hr") return "HR specialist";
  if (agent === "orchestrator") return "Orchestrator";
  return agent;
}

export function statusLabel(status: TurnStatus): string {
  return STATUS_LABEL[status];
}

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABEL[outcome] ?? outcome;
}

export function eventLabel(eventType: string): string {
  return EVENT_LABEL[eventType] ?? eventType;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const clock = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${clock}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function conversationTurns(histories: HistoryRow[]): ConversationTurn[] {
  const turns = new Map<string, { question?: string; reply?: string }>();
  const order: string[] = [];
  for (const row of histories) {
    if (row.agent !== "orchestrator") continue;
    const current = turns.get(row.turnId) ?? {};
    if (!turns.has(row.turnId)) order.push(row.turnId);
    if (row.body.startsWith("user: ")) current.question = row.body.slice("user: ".length);
    if (row.body.startsWith("assistant: ")) current.reply = row.body.slice("assistant: ".length);
    turns.set(row.turnId, current);
  }
  return order.flatMap((turnId) => {
    const turn = turns.get(turnId);
    if (turn?.question === undefined || turn.reply === undefined) return [];
    return [{ turnId, question: turn.question, reply: turn.reply }];
  });
}

export function specialistOutcomes(traces: TraceEvent[], turnId: string): SpecialistOutcome[] {
  return traces
    .filter((event) => event.turnId === turnId && event.eventType === "delegation.completed")
    .map((event) => ({
      agent: event.agentId,
      taskId: event.taskId,
      outcome: event.outcome ?? "unknown",
    }));
}

export function turnStatus(traces: TraceEvent[], turnId: string): TurnStatus {
  const events = traces.filter((event) => event.turnId === turnId);
  const parts = specialistOutcomes(traces, turnId);
  if (parts.length > 0) {
    const succeeded = parts.some((part) => part.outcome === "success");
    const other = parts.some((part) => part.outcome !== "success");
    if (succeeded && other) return "partial";
    if (parts.every((part) => part.outcome === parts[0]?.outcome)) return knownStatus(parts[0]?.outcome);
    return knownStatus(events.find((event) => event.eventType === "reply.composed")?.outcome);
  }
  if (events.some((event) => event.eventType === "permission.denied")) return "denied";
  if (events.some((event) => event.eventType === "plan.rejected")) return "failed";
  return knownStatus(events.find((event) => event.eventType === "reply.composed")?.outcome);
}

function knownStatus(outcome: string | undefined): TurnStatus {
  if (outcome === "success" || outcome === "denied" || outcome === "unavailable" || outcome === "failed" || outcome === "needs_input") {
    return outcome;
  }
  return "unknown";
}

export type PlannedTask = {
  id: string;
  specialist: string;
  objective: string;
  action?: string;
  dependsOn?: unknown[];
};

export function plannedTasks(result: string | undefined): PlannedTask[] | undefined {
  if (result === undefined) return undefined;
  try {
    const parsed = JSON.parse(result) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const task = item as Record<string, unknown>;
      if (typeof task.id !== "string" || typeof task.specialist !== "string" || typeof task.objective !== "string") return [];
      return [
        {
          id: task.id,
          specialist: task.specialist,
          objective: task.objective,
          action: typeof task.action === "string" ? task.action : undefined,
          dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : undefined,
        },
      ];
    });
  } catch {
    return undefined;
  }
}
