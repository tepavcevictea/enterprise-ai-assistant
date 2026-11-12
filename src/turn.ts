import type { DemoUser } from "./identity";
import type { HistoryRow, ModelPort } from "./models";
import { RESET_DENIED, RESET_WITHHELD, type PasswordResetRecord } from "./password";
import { executionGate, taskAction, type PlanTask } from "./plan";
import { OUTSIDE_SCOPE, composeReply } from "./reply";
import { scheduleTasks, type Outcome, type TaskResult } from "./schedule";
import { permits, userHas } from "./capabilities";
import type { TraceEvent } from "./trace";
import { traceEvent } from "./trace";

export type HistoryEntry = { agent: "orchestrator" | "it" | "hr"; body: string };

export type TurnResult = {
  reply: string;
  outcome: Outcome;
  trace: TraceEvent[];
  entries: HistoryEntry[];
  reset?: PasswordResetRecord;
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
    record(
      traceEvent(base, {
        agentId: "orchestrator",
        eventType: "plan.tasks",
        outcome: "success",
        result: JSON.stringify(
          planned.plan.tasks.map((task) => ({
            id: task.id,
            specialist: task.specialist,
            order: task.order,
            dependsOn: task.dependsOn,
            objective: task.objective,
            action: taskAction(task),
            onlySpecialist: planned.plan.onlySpecialist ?? null,
          })),
        ),
      }),
    );
    if (planned.plan.outsideScope === true) {
      record(traceEvent(base, { agentId: "orchestrator", eventType: "reply.composed", outcome: "unsupported" }));
      return {
        reply: OUTSIDE_SCOPE,
        outcome: "unsupported",
        trace,
        entries: [
          { agent: "orchestrator", body: `user: ${input.message}` },
          { agent: "orchestrator", body: `assistant: ${OUTSIDE_SCOPE}` },
        ],
      };
    }
    if (planned.plan.tasks.some((task) => taskAction(task) === "password_reset") && !userHas(input.user.id, "password_reset")) {
      record(
        traceEvent(base, {
          agentId: "orchestrator",
          eventType: "permission.denied",
          authorization: "denied",
          toolId: "simulatePasswordReset",
          outcome: "denied",
          errorCode: "denied",
        }),
      );
      return {
        reply: RESET_DENIED,
        outcome: "denied",
        trace,
        entries: [
          { agent: "orchestrator", body: `user: ${input.message}` },
          { agent: "orchestrator", body: `assistant: ${RESET_DENIED}` },
        ],
      };
    }
    if (!executionGate(planned.plan).ok) {
      record(
        traceEvent(base, {
          agentId: "orchestrator",
          eventType: "plan.rejected",
          outcome: "failed",
          errorCode: "named_specialist",
        }),
      );
      const reply = "I could not produce a plan for that request.";
      return {
        reply,
        outcome: "failed",
        trace,
        entries: [
          { agent: "orchestrator", body: `user: ${input.message}` },
          { agent: "orchestrator", body: `assistant: ${reply}` },
        ],
      };
    }
    const saved: { reset?: PasswordResetRecord } = {};
    const results = await scheduleTasks({
      tasks: planned.plan.tasks,
      run: async (task, notes) => {
        const result = await runTask({
          user: input.user,
          message: input.message,
          task,
          notes,
          history: input.history,
          models: input.models,
          signal: controller.signal,
          record,
          base,
        });
        if (result.reset !== undefined) saved.reset = result.reset;
        return result;
      },
    });
    for (const result of results) {
      if (result.blocked === undefined) continue;
      record(
        traceEvent(base, {
          agentId: result.specialist,
          taskId: result.taskId,
          eventType: "dependency.blocked",
          outcome: "unavailable",
          errorCode: result.blocked,
        }),
      );
    }
    const reply = composeReply(planned.plan.tasks, results);
    record(traceEvent(base, { agentId: "orchestrator", eventType: "reply.composed", outcome: "success" }));
    const entries: HistoryEntry[] = [
      { agent: "orchestrator", body: `user: ${input.message}` },
      { agent: "orchestrator", body: `assistant: ${reply}` },
    ];
    for (const result of results) {
      if (result.blocked !== undefined) continue;
      const task = planned.plan.tasks.find((item) => item.id === result.taskId);
      entries.push({ agent: result.specialist, body: `task: ${task?.objective ?? result.taskId}` });
      entries.push({ agent: result.specialist, body: `result: ${result.text}` });
    }
    return { reply, outcome: turnOutcome(results), trace, entries, reset: saved.reset };
  } finally {
    clearTimeout(timer);
  }
}

async function runTask(input: {
  user: DemoUser;
  message: string;
  task: PlanTask;
  notes: { information: string; value: string }[];
  history: HistoryRow[];
  models: ModelPort;
  signal: AbortSignal;
  record: (event: TraceEvent) => void;
  base: { sessionId: string; turnId: string };
}): Promise<TaskResult & { reset?: PasswordResetRecord }> {
  const started = Date.now();
  input.record(
    traceEvent(input.base, {
      agentId: input.task.specialist,
      taskId: input.task.id,
      eventType: "delegation.started",
    }),
  );
  for (const note of input.notes) {
    input.record(
      traceEvent(input.base, {
        agentId: input.task.specialist,
        taskId: input.task.id,
        eventType: "dependency.passed",
        outcome: "success",
        result: note.value,
      }),
    );
  }
  if (input.task.specialist === "hr") {
    if (taskAction(input.task) === "password_reset" && !permits(input.user.id, "hr", "password_reset")) {
      input.record(
        traceEvent(input.base, {
          agentId: "hr",
          taskId: input.task.id,
          eventType: "tool.denied",
          toolId: "simulatePasswordReset",
          authorization: "denied",
          outcome: "denied",
          errorCode: "password_reset",
        }),
      );
    }
    input.record(traceEvent(input.base, { agentId: "hr", taskId: input.task.id, eventType: "specialist.started" }));
    try {
      const result = await input.models.runHr({
        user: input.user,
        objective: input.task.objective,
        message: input.message,
        history: input.history,
        notes: input.notes,
        signal: input.signal,
        trace: input.record,
        base: { ...input.base, taskId: input.task.id },
      });
      const withheld = taskAction(input.task) === "password_reset" && !permits(input.user.id, "hr", "password_reset");
      const outcome = withheld ? "denied" : result.outcome;
      const text = withheld ? RESET_WITHHELD : result.text;
      const report = withheld ? RESET_WITHHELD : result.report;
      input.record(
        traceEvent(input.base, {
          agentId: "hr",
          taskId: input.task.id,
          eventType: "specialist.completed",
          outcome,
          durationMs: Date.now() - started,
          errorCode: outcome === "success" ? undefined : outcome,
        }),
      );
      input.record(
        traceEvent(input.base, {
          agentId: "hr",
          taskId: input.task.id,
          eventType: "delegation.completed",
          outcome,
          durationMs: Date.now() - started,
        }),
      );
      return {
        taskId: input.task.id,
        specialist: "hr",
        outcome,
        text,
        report,
        handoff: withheld || result.handoff === undefined ? undefined : { value: result.handoff },
      };
    } catch (error) {
      input.record(
        traceEvent(input.base, {
          agentId: "hr",
          taskId: input.task.id,
          eventType: "specialist.failed",
          outcome: "failed",
          durationMs: Date.now() - started,
          errorCode: error instanceof Error ? error.name : "specialist_failed",
        }),
      );
      return {
        taskId: input.task.id,
        specialist: "hr",
        outcome: "failed",
        text: "The HR specialist failed.",
        report: "The HR specialist failed.",
      };
    }
  }
  input.record(traceEvent(input.base, { agentId: "it", taskId: input.task.id, eventType: "specialist.started" }));
  try {
    const result = await input.models.runIt({
      user: input.user,
      objective: input.task.objective,
      action: taskAction(input.task),
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
        outcome: result.outcome,
        durationMs: Date.now() - started,
        errorCode: result.outcome === "success" ? undefined : result.outcome,
      }),
    );
    input.record(
      traceEvent(input.base, {
        agentId: "it",
        taskId: input.task.id,
        eventType: "delegation.completed",
        outcome: result.outcome,
        durationMs: Date.now() - started,
      }),
    );
    return {
      taskId: input.task.id,
      specialist: "it",
      outcome: result.outcome,
      text: result.text,
      report: result.outcome === "success" ? undefined : result.text,
      handoff: result.outcome === "success" ? { value: detail === "" ? result.text : detail } : undefined,
      reset: result.outcome === "success" ? result.reset : undefined,
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
