import type { PlanTask } from "./plan";

export type Outcome = "success" | "needs_input" | "denied" | "unavailable" | "failed";

export type TaskResult = {
  taskId: string;
  specialist: PlanTask["specialist"];
  outcome: Outcome;
  text: string;
  report?: string;
  handoff?: { value: string };
  blocked?: "predecessor" | "missing_fact";
};

export type TaskNotes = { information: string; value: string }[];

export const PREDECESSOR_BLOCKED = "A required earlier task did not succeed.";

export const FACT_BLOCKED = "The required information was not available.";

export async function scheduleTasks(input: {
  tasks: PlanTask[];
  run: (task: PlanTask, notes: TaskNotes) => Promise<TaskResult>;
}): Promise<TaskResult[]> {
  const pending = new Map(input.tasks.map((task) => [task.id, task]));
  const done = new Map<string, TaskResult>();

  while (pending.size > 0) {
    const ready = [...pending.values()].filter((task) => dependenciesReady(task, done));
    if (ready.length === 0) {
      for (const task of pending.values()) {
        const blocked = blockReason(task, done);
        const text = blocked === "predecessor" ? PREDECESSOR_BLOCKED : FACT_BLOCKED;
        done.set(task.id, {
          taskId: task.id,
          specialist: task.specialist,
          outcome: "unavailable",
          text,
          report: text,
          blocked,
        });
      }
      break;
    }
    for (const task of ready) pending.delete(task.id);
    const itTasks = ready.filter((task) => task.specialist === "it");
    const hrTasks = ready.filter((task) => task.specialist === "hr");
    await Promise.all([
      runChain(itTasks, done, input.run),
      runChain(hrTasks, done, input.run),
    ]);
  }

  return input.tasks.map((task) => {
    const result = done.get(task.id);
    if (result === undefined) {
      return {
        taskId: task.id,
        specialist: task.specialist,
        outcome: "failed",
        text: "The task was not scheduled.",
      };
    }
    return result;
  });
}

async function runChain(
  tasks: PlanTask[],
  done: Map<string, TaskResult>,
  run: (task: PlanTask, notes: TaskNotes) => Promise<TaskResult>,
): Promise<void> {
  for (const task of tasks) {
    const notes = task.dependsOn.map((dependency) => ({
      information: dependency.information,
      value: done.get(dependency.taskId)?.handoff?.value ?? "",
    }));
    const result = await run(task, notes);
    done.set(task.id, result);
  }
}

function dependenciesReady(task: PlanTask, done: Map<string, TaskResult>): boolean {
  return task.dependsOn.every((dependency) => {
    const predecessor = done.get(dependency.taskId);
    return predecessor?.outcome === "success" && handoffSatisfies(dependency.information, predecessor.handoff?.value);
  });
}

function blockReason(task: PlanTask, done: Map<string, TaskResult>): "predecessor" | "missing_fact" {
  const predecessorFailed = task.dependsOn.some((dependency) => done.get(dependency.taskId)?.outcome !== "success");
  return predecessorFailed ? "predecessor" : "missing_fact";
}

function handoffSatisfies(information: string, value: string | undefined): boolean {
  const text = value?.trim() ?? "";
  if (text === "" || text === "none") return false;
  const facts = text
    .split("\n")
    .map((line) => {
      const index = line.indexOf("=");
      if (index <= 0) return undefined;
      return { key: line.slice(0, index), value: line.slice(index + 1).trim() };
    })
    .filter((fact): fact is { key: string; value: string } => fact !== undefined && fact.value !== "");
  if (facts.length === 0) return true;
  if (facts.length === 1) return true;
  const wanted = normalizeFact(information);
  return facts.some((fact) => normalizeFact(fact.key) === wanted);
}

function normalizeFact(value: string): string {
  return value.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
}
