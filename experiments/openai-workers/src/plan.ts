import { z } from "zod";

export const PLAN_MODEL = "gpt-6.1-sol";

export const planSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z
          .string()
          .describe(
            "Unique id for this task. Other tasks reference it from dependsOn.taskId.",
          ),
        specialist: z
          .enum(["it", "hr"])
          .describe("The specialist who performs this task. Only it or hr."),
        objective: z
          .string()
          .describe(
            "The specialist's assignment. This is not the user-facing reply.",
          ),
        order: z
          .number()
          .describe(
            "Position of the user-facing part this task answers, starting at 1. A task that only supplies a fact for that part uses the same position. Not the execution sequence.",
          ),
        dependsOn: z
          .array(
            z.object({
              taskId: z.string().describe("Id of the predecessor task."),
              information: z
                .string()
                .describe(
                  "The specific fact the predecessor must produce. Name the fact, not a generic word such as result.",
                ),
            }),
          )
          .describe(
            "Facts this task needs from earlier tasks. Empty when the task can run without another task's output.",
          ),
      }),
    )
    .describe("The tasks in this plan."),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanTask = Plan["tasks"][number];

export type PlanErrorCode =
  | "duplicate_task_id"
  | "unknown_specialist"
  | "missing_dependency"
  | "cycle"
  | "task_count"
  | "unnecessary_dependency"
  | "invalid_predecessor"
  | "invalid_task";

const SPECIALISTS = new Set(["it", "hr"]);
const ORDERING_ONLY = new Set([
  "result",
  "output",
  "answer",
  "information",
  "data",
  "response",
  "context",
  "details",
  "info",
]);

export type PlanValidation =
  | { ok: true; plan: Plan }
  | { ok: false; errors: PlanErrorCode[] };

export function validatePlan(input: unknown): PlanValidation {
  const errors = new Set<PlanErrorCode>();
  if (typeof input !== "object" || input === null || !("tasks" in input)) {
    return { ok: false, errors: ["invalid_task"] };
  }
  const tasks: unknown = input.tasks;
  if (!Array.isArray(tasks)) return { ok: false, errors: ["invalid_task"] };
  if (tasks.length < 1 || tasks.length > 4) errors.add("task_count");

  const parsed: PlanTask[] = [];
  const ids = new Set<string>();
  for (const value of tasks) {
    const task = readTask(value, errors, ids);
    if (task !== undefined) parsed.push(task);
  }

  const known = new Set(parsed.map((task) => task.id));
  for (const task of parsed) {
    const seenPredecessors = new Set<string>();
    for (const dependency of task.dependsOn) {
      if (dependency.taskId === task.id) {
        errors.add("invalid_predecessor");
        continue;
      }
      if (!known.has(dependency.taskId)) {
        errors.add("missing_dependency");
        continue;
      }
      if (seenPredecessors.has(dependency.taskId)) {
        errors.add("unnecessary_dependency");
        continue;
      }
      seenPredecessors.add(dependency.taskId);
      if (ORDERING_ONLY.has(dependency.information.trim().toLowerCase())) {
        errors.add("unnecessary_dependency");
      }
    }
  }

  if (hasCycle(parsed)) errors.add("cycle");
  if (errors.size > 0) return { ok: false, errors: [...errors] };
  return { ok: true, plan: { tasks: parsed } };
}

function readTask(
  value: unknown,
  errors: Set<PlanErrorCode>,
  ids: Set<string>,
): PlanTask | undefined {
  if (typeof value !== "object" || value === null) {
    errors.add("invalid_task");
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (id === "") errors.add("invalid_task");
  else if (ids.has(id)) errors.add("duplicate_task_id");
  else ids.add(id);

  const specialist = record.specialist;
  if (specialist !== "it" && specialist !== "hr") {
    errors.add(
      typeof specialist === "string" && !SPECIALISTS.has(specialist)
        ? "unknown_specialist"
        : "invalid_task",
    );
  }

  const objective = record.objective;
  if (typeof objective !== "string" || objective.trim() === "") {
    errors.add("invalid_task");
  }

  const order = record.order;
  if (typeof order !== "number" || !Number.isInteger(order) || order < 1 || order > 4) {
    errors.add("invalid_task");
  }

  if (!Array.isArray(record.dependsOn)) {
    errors.add("invalid_task");
    return undefined;
  }

  const dependsOn: PlanTask["dependsOn"] = [];
  for (const entry of record.dependsOn) {
    if (typeof entry !== "object" || entry === null) {
      errors.add("invalid_task");
      continue;
    }
    const dependency = entry as Record<string, unknown>;
    const taskId = typeof dependency.taskId === "string" ? dependency.taskId.trim() : "";
    const information =
      typeof dependency.information === "string" ? dependency.information.trim() : "";
    if (taskId === "") errors.add("invalid_predecessor");
    if (information === "") errors.add("invalid_task");
    dependsOn.push({ taskId, information });
  }

  if (
    id === "" ||
    (specialist !== "it" && specialist !== "hr") ||
    typeof objective !== "string" ||
    typeof order !== "number"
  ) {
    return undefined;
  }

  return { id, specialist, objective, order, dependsOn };
}

function hasCycle(tasks: PlanTask[]): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const mark = state.get(id) ?? 0;
    if (mark === 1) return true;
    if (mark === 2) return false;
    state.set(id, 1);
    const task = byId.get(id);
    if (task !== undefined) {
      for (const dependency of task.dependsOn) {
        if (byId.has(dependency.taskId) && visit(dependency.taskId)) return true;
      }
    }
    state.set(id, 2);
    return false;
  };
  return tasks.some((task) => visit(task.id));
}

export function executionGate(
  plan: Plan,
  constraint: { onlySpecialist: "it" | "hr" | null },
): { ok: true } | { ok: false; error: "named_specialist" } {
  if (constraint.onlySpecialist === null) return { ok: true };
  const allowed = plan.tasks.every((task) => task.specialist === constraint.onlySpecialist);
  return allowed ? { ok: true } : { ok: false, error: "named_specialist" };
}
