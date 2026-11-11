import type { PlanTask } from "./plan";

export type Outcome = "success" | "needs_input" | "denied" | "unavailable" | "failed";

export type TaskResult = {
  taskId: string;
  specialist: PlanTask["specialist"];
  outcome: Outcome;
  text: string;
  handoff?: { value: string };
};

export type TaskNotes = { information: string; value: string }[];

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
        done.set(task.id, {
          taskId: task.id,
          specialist: task.specialist,
          outcome: "unavailable",
          text: "A required earlier task did not succeed.",
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
  return task.dependsOn.every((dependency) => done.get(dependency.taskId)?.outcome === "success");
}
