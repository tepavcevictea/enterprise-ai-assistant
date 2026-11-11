import { expect, it } from "vitest";
import { validatePlan, type Plan } from "../src/plan";

function task(overrides: Partial<Plan["tasks"][number]> & { id: string }): Plan["tasks"][number] {
  return {
    specialist: "it",
    objective: "Check the service status",
    order: 1,
    dependsOn: [],
    ...overrides,
  };
}

it("rejects duplicate and empty task ids", () => {
  const duplicate = validatePlan({
    tasks: [task({ id: "a" }), task({ id: "a", order: 2, specialist: "hr", objective: "Read the policy" })],
  });
  expect(duplicate.ok).toBe(false);
  if (!duplicate.ok) expect(duplicate.errors).toContain("duplicate_task_id");

  const empty = validatePlan({
    tasks: [{ id: "  ", specialist: "it", objective: "Check the service status", order: 1, dependsOn: [] }],
  });
  expect(empty.ok).toBe(false);
  if (!empty.ok) expect(empty.errors).toContain("invalid_task");
});

it("rejects an unknown specialist id", () => {
  const result = validatePlan({
    tasks: [{ ...task({ id: "a" }), specialist: "finance" }],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toContain("unknown_specialist");
});

it("rejects a missing dependency", () => {
  const result = validatePlan({
    tasks: [task({ id: "setup", dependsOn: [{ taskId: "missing", information: "equipment profile" }] })],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toContain("missing_dependency");
});

it("rejects a self-reference as an invalid predecessor and a cycle", () => {
  const result = validatePlan({
    tasks: [task({ id: "setup", dependsOn: [{ taskId: "setup", information: "equipment profile" }] })],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("invalid_predecessor");
    expect(result.errors).toContain("cycle");
  }
});

it("rejects a cycle across two tasks", () => {
  const result = validatePlan({
    tasks: [
      task({ id: "a", dependsOn: [{ taskId: "b", information: "equipment profile" }] }),
      task({
        id: "b",
        specialist: "hr",
        objective: "Look up the equipment profile",
        order: 2,
        dependsOn: [{ taskId: "a", information: "setup steps" }],
      }),
    ],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toContain("cycle");
});

it("rejects an empty plan and a plan with more than four tasks", () => {
  const empty = validatePlan({ tasks: [] });
  const excessive = validatePlan({
    tasks: ["a", "b", "c", "d", "e"].map((id, index) => task({ id, order: (index % 4) + 1 })),
  });
  expect(empty.ok).toBe(false);
  expect(excessive.ok).toBe(false);
  if (!empty.ok) expect(empty.errors).toContain("task_count");
  if (!excessive.ok) expect(excessive.errors).toContain("task_count");
});

it("accepts an executable dependent plan", () => {
  const result = validatePlan({
    tasks: [
      task({ id: "policy", specialist: "hr", objective: "Determine the equipment profile", order: 1 }),
      task({
        id: "setup",
        order: 1,
        dependsOn: [{ taskId: "policy", information: "equipment profile" }],
      }),
    ],
  });
  expect(result.ok).toBe(true);
});
