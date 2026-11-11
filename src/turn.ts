import type { DemoUser } from "./identity";
import type { HistoryRow, ModelPort } from "./models";
import type { PlanTask } from "./plan";
import { scheduleTasks, type Outcome, type TaskResult } from "./schedule";
import type { TraceEvent } from "./trace";
import { traceEvent } from "./trace";

export type HistoryEntry = { agent: "orchestrator" | "it" | "hr"; body: string };

export type TurnResult = {
  reply: string;
  outcome: Outcome;
  trace: TraceEvent[];
  entries: HistoryEntry[];
};

export async function runTurn(input: {
  user: DemoUser;
  message: string;
  turnId: string;
  history: HistoryRow[];
  models: ModelPort;
}): Promise<TurnResult> {
  const base = { sessionId: input.user.id, turnId: input.turnId };
  const trace: TraceEvent[] = [];
  const record = (event: TraceEvent) => {
    trace.push(event);
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const planned = await input.models.plan({
      user: input.user,
      message: input.message,
      history: input.history,
      signal: controller.signal,
    });
    if (!planned.ok) {
      record(traceEvent(base, { agentId: "orchestrator", eventType: "plan.rejected", outcome: "failed", errorCode: planned.errors[0] ?? "invalid_plan" }));
      return {
        reply: "I could not produce a plan for that request.",
        outcome: "failed",
        trace,
        entries: [
          { agent: "orchestrator", body: `user: ${input.message}` },
          { agent: "orchestrator", body: "assistant: I could not produce a plan for that request." },
        ],
      };
    }
    record(
      traceEvent(base, {
        agentId: "orchestrator",
        eventType: planned.repaired ? "plan.repaired" : "plan.validated",
        outcome: "success",
        result: planned.plan.tasks.map((task) => task.specialist).join(","),
      }),
    );
    const results = await scheduleTasks({
      tasks: planned.plan.tasks,
      run: (task, notes) =>
        runTask({
          user: input.user,
          task,
          notes,
          history: input.history,
          models: input.models,
          signal: controller.signal,
          record,
          base,
        }),
    });
    const statusLine = results
      .map((result) => `${result.specialist.toUpperCase()}: ${result.outcome}. ${result.handoff?.value ?? result.text}`)
      .join("\n");
    let explanation = "";
    try {
      explanation = await input.models.synthesize({
        statusLine,
        notes: results.map((result) => `${result.specialist}: ${result.text}`).join("\n"),
        signal: controller.signal,
      });
      record(traceEvent(base, { agentId: "orchestrator", eventType: "synthesis.completed", outcome: "success" }));
    } catch (error) {
      record(
        traceEvent(base, {
          agentId: "orchestrator",
          eventType: "synthesis.failed",
          outcome: "failed",
          errorCode: error instanceof Error ? error.name : "synthesis_failed",
        }),
      );
    }
    const reply = [statusLine, explanation].filter((part) => part.trim() !== "").join("\n\n");
    const entries: HistoryEntry[] = [
      { agent: "orchestrator", body: `user: ${input.message}` },
      { agent: "orchestrator", body: `assistant: ${reply}` },
    ];
    for (const result of results) {
      const task = planned.plan.tasks.find((item) => item.id === result.taskId);
      entries.push({ agent: result.specialist, body: `task: ${task?.objective ?? result.taskId}` });
      entries.push({ agent: result.specialist, body: `result: ${result.text}` });
    }
    return { reply, outcome: turnOutcome(results), trace, entries };
  } finally {
    clearTimeout(timer);
  }
}

async function runTask(input: {
  user: DemoUser;
  task: PlanTask;
  notes: { information: string; value: string }[];
  history: HistoryRow[];
  models: ModelPort;
  signal: AbortSignal;
  record: (event: TraceEvent) => void;
  base: { sessionId: string; turnId: string };
}): Promise<TaskResult> {
  const started = Date.now();
  input.record(
    traceEvent(input.base, {
      agentId: input.task.specialist,
      taskId: input.task.id,
      eventType: "delegation.started",
    }),
  );
  if (input.task.specialist === "hr") {
    input.record(
      traceEvent(input.base, {
        agentId: "hr",
        taskId: input.task.id,
        eventType: "specialist.unavailable",
        outcome: "unavailable",
        durationMs: Date.now() - started,
      }),
    );
    return {
      taskId: input.task.id,
      specialist: "hr",
      outcome: "unavailable",
      text: "The HR specialist is not available in this service yet.",
    };
  }
  input.record(traceEvent(input.base, { agentId: "it", taskId: input.task.id, eventType: "specialist.started" }));
  try {
    const result = await input.models.runIt({
      user: input.user,
      objective: input.task.objective,
      history: input.history,
      notes: input.notes,
      signal: input.signal,
      trace: input.record,
      base: { ...input.base, taskId: input.task.id },
    });
    const detail = result.statuses.map((status) => status.detail).join(" ");
    input.record(
      traceEvent(input.base, {
        agentId: "it",
        taskId: input.task.id,
        eventType: "specialist.completed",
        outcome: "success",
        durationMs: Date.now() - started,
      }),
    );
    input.record(
      traceEvent(input.base, {
        agentId: "it",
        taskId: input.task.id,
        eventType: "delegation.completed",
        outcome: "success",
        durationMs: Date.now() - started,
      }),
    );
    return {
      taskId: input.task.id,
      specialist: "it",
      outcome: "success",
      text: result.text,
      handoff: { value: detail === "" ? result.text : detail },
    };
  } catch (error) {
    input.record(
      traceEvent(input.base, {
        agentId: "it",
        taskId: input.task.id,
        eventType: "specialist.failed",
        outcome: "failed",
        durationMs: Date.now() - started,
        errorCode: error instanceof Error ? error.name : "specialist_failed",
      }),
    );
    return {
      taskId: input.task.id,
      specialist: "it",
      outcome: "failed",
      text: "The IT specialist failed.",
    };
  }
}

function turnOutcome(results: TaskResult[]): Outcome {
  if (results.some((result) => result.outcome === "success")) return "success";
  const rank: Outcome[] = ["failed", "denied", "unavailable", "needs_input"];
  for (const outcome of rank) {
    if (results.some((result) => result.outcome === outcome)) return outcome;
  }
  return "failed";
}
