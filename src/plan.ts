import { z } from "zod";
import type { DemoUser } from "./identity";

export const PLAN_MODEL = "gpt-6.1-sol";

const taskActionSchema = z
  .enum(["read", "password_reset"])
  .describe(
    "password_reset only when this task is a simulated password reset. read for status, troubleshooting, policy, and setup.",
  );

export const planSchema = z.object({
  onlySpecialist: z
    .enum(["it", "hr"])
    .nullable()
    .describe(
      "The only specialist allowed when the user assigns every part to one specialist or rules the other specialist out of every part. Null when the user does not constrain every part.",
    ),
  tasks: z
    .array(
      z.object({
        id: z.string().describe("Unique id for this task. Other tasks reference it from dependsOn.taskId."),
        specialist: z.enum(["it", "hr"]).describe("The specialist who performs this task. Only it or hr."),
        action: taskActionSchema,
        objective: z.string().describe("The specialist's assignment. This is not the user-facing reply."),
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

export type TaskAction = "read" | "password_reset";

export type PlanTask = {
  id: string;
  specialist: "it" | "hr";
  objective: string;
  order: number;
  dependsOn: { taskId: string; information: string }[];
  action?: TaskAction;
};

export type Plan = {
  tasks: PlanTask[];
  onlySpecialist?: "it" | "hr" | null;
};

export type PlanErrorCode =
  | "duplicate_task_id"
  | "unknown_specialist"
  | "missing_dependency"
  | "cycle"
  | "task_count"
  | "unnecessary_dependency"
  | "invalid_predecessor"
  | "invalid_task"
  | "named_specialist";

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

export type PlanValidation = { ok: true; plan: Plan } | { ok: false; errors: PlanErrorCode[] };

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

  const onlySpecialist = readOnlySpecialist(input, errors);
  const plan: Plan = { tasks: parsed, onlySpecialist };
  if (!executionGate(plan).ok) errors.add("named_specialist");
  if (hasCycle(parsed)) errors.add("cycle");
  if (errors.size > 0) return { ok: false, errors: [...errors] };
  return { ok: true, plan };
}

export function taskAction(task: { action?: string }): TaskAction {
  return task.action === "password_reset" ? "password_reset" : "read";
}

export function executionGate(plan: Plan): { ok: true } | { ok: false; error: "named_specialist" } {
  const only = plan.onlySpecialist ?? null;
  if (only === null) return { ok: true };
  return plan.tasks.every((task) => task.specialist === only) ? { ok: true } : { ok: false, error: "named_specialist" };
}

function readOnlySpecialist(input: object, errors: Set<PlanErrorCode>): "it" | "hr" | null {
  if (!("onlySpecialist" in input) || input.onlySpecialist === null || input.onlySpecialist === undefined) return null;
  if (input.onlySpecialist === "it" || input.onlySpecialist === "hr") return input.onlySpecialist;
  errors.add("invalid_task");
  return null;
}

function readTask(value: unknown, errors: Set<PlanErrorCode>, ids: Set<string>): PlanTask | undefined {
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
    errors.add(typeof specialist === "string" && !SPECIALISTS.has(specialist) ? "unknown_specialist" : "invalid_task");
  }

  const objective = record.objective;
  if (typeof objective !== "string" || objective.trim() === "") errors.add("invalid_task");

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
    const information = typeof dependency.information === "string" ? dependency.information.trim() : "";
    if (taskId === "") errors.add("invalid_predecessor");
    if (information === "") errors.add("invalid_task");
    dependsOn.push({ taskId, information });
  }

  if (id === "" || (specialist !== "it" && specialist !== "hr") || typeof objective !== "string" || typeof order !== "number") {
    return undefined;
  }
  const action = readAction(record.action, errors);
  return { id, specialist, objective, order, dependsOn, action };
}

function readAction(value: unknown, errors: Set<PlanErrorCode>): TaskAction {
  if (value === undefined) return "read";
  if (value === "read" || value === "password_reset") return value;
  errors.add("invalid_task");
  return "read";
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

export function plannerInstructions(identity: DemoUser): string {
  return [
    "You write a task plan for a three-agent enterprise assistant. You do not answer the user, call tools, grant permissions, or invent agents.",
    "Specialists you may assign:",
    "- it: service status, troubleshooting, and device setup. This is the only specialist that can perform a simulated password reset.",
    "- hr: company policy, leave, and equipment profiles. This specialist cannot reset passwords.",
    `Signed-in user: ${identity.id}, role ${identity.role}. The user's role does not choose the specialist.`,
    "Rules:",
    "- Assign only it or hr. Use at most four tasks.",
    "- If the user explicitly assigns a part to a specialist, or explicitly rules a specialist out, follow that for every part the instruction covers. Do not move a covered part to the specialist who has the capability, and do not add a ruled-out specialist. An instruction that does not cover a part does not change that part.",
    "- When the user names no specialist, assign each user-facing part by subject.",
    "- id is a unique short lowercase string.",
    "- order is the position of the user-facing part this task answers, starting at 1 in the order the user raised those parts. A task that only supplies a fact for that part uses the same order. order is not execution sequence.",
    "- dependsOn is empty when the task needs no fact produced by another task in this plan. When it does, dependsOn has one entry: that task's id and a short specific name of the fact in information. Do not add a dependency only to sequence work.",
    "- Earlier user messages are context only. Do not copy a previous answer into a task objective. An objective describes only what the current message asks.",
    "- An equipment question asks which company equipment profile applies. Do not turn it into a role-specific entitlement or add specifications the user did not ask for.",
    "- action is password_reset when that task is a simulated password reset, including when the named specialist cannot perform it. Every other task is read.",
    "- onlySpecialist is it or hr when the user assigns every part to that specialist or rules the other specialist out of every part. It is null when the user does not constrain every part. Do not include a task for a ruled-out specialist.",
  ].join("\n");
}

export function plannerContext(history: { agent: string; body: string }[], message: string): string {
  const earlier = history
    .filter((row) => row.agent === "orchestrator" && row.body.startsWith("user: "))
    .slice(-6)
    .map((row) => row.body);
  const prior = earlier.length === 0 ? "" : `Earlier user messages, for context only:\n${earlier.join("\n")}\n\n`;
  return `${prior}User:\n${message}`.trim();
}

export function repairInstructions(identity: DemoUser): string {
  return [
    plannerInstructions(identity),
    "The previous plan was rejected by application code. Return one corrected plan for the same request.",
    "Fix the listed errors. Do not add a specialist the user ruled out. Do not answer the user.",
  ].join("\n");
}
