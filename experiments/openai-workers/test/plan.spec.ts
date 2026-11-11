import { expect, it } from "vitest";
import { executionGate, planSchema, validatePlan, type Plan } from "../src/plan";
import { assessPlan, planningCases } from "../src/planning-cases";
import { reviewCases } from "../src/planning-review";
import { plannerInstructions } from "../src/planner";

function task(overrides: Partial<Plan["tasks"][number]> & { id: string }): Plan["tasks"][number] {
  return {
    specialist: "it",
    objective: "Check the service status",
    order: 1,
    dependsOn: [],
    ...overrides,
  };
}

it("rejects duplicate task ids", () => {
  const result = validatePlan({
    tasks: [task({ id: "a" }), task({ id: "a", order: 2, specialist: "hr", objective: "Read the policy" })],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toContain("duplicate_task_id");
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

it("rejects a duplicated predecessor and an ordering-only dependency", () => {
  const duplicate = validatePlan({
    tasks: [
      task({ id: "policy", specialist: "hr", objective: "Read the equipment policy", order: 1 }),
      task({
        id: "setup",
        order: 2,
        dependsOn: [
          { taskId: "policy", information: "equipment profile" },
          { taskId: "policy", information: "equipment profile" },
        ],
      }),
    ],
  });
  const generic = validatePlan({
    tasks: [
      task({ id: "policy", specialist: "hr", objective: "Read the equipment policy", order: 1 }),
      task({ id: "setup", order: 2, dependsOn: [{ taskId: "policy", information: "result" }] }),
    ],
  });
  expect(duplicate.ok).toBe(false);
  expect(generic.ok).toBe(false);
  if (!duplicate.ok) expect(duplicate.errors).toContain("unnecessary_dependency");
  if (!generic.ok) expect(generic.errors).toContain("unnecessary_dependency");
});

it("accepts an executable plan and does not name a business handoff field", () => {
  const result = validatePlan({
    tasks: [
      task({ id: "policy", specialist: "hr", objective: "Determine the equipment profile", order: 1 }),
      task({
        id: "setup",
        order: 2,
        dependsOn: [{ taskId: "policy", information: "equipment profile" }],
      }),
    ],
  });
  expect(result.ok).toBe(true);
  expect(JSON.stringify(planSchema.toJSONSchema())).not.toContain("equipmentProfile");
});

it("does not execute a plan that violates a named specialist constraint", () => {
  const plan: Plan = { tasks: [task({ id: "reset", objective: "Reset the password" })] };
  const before = JSON.stringify(plan);
  const gate = executionGate(plan, { onlySpecialist: "hr" });
  expect(gate).toEqual({ ok: false, error: "named_specialist" });
  expect(JSON.stringify(plan)).toBe(before);
  expect(executionGate(plan, { onlySpecialist: null })).toEqual({ ok: true });
});

it("keeps the evaluated requests out of the planner instructions", () => {
  const instructions = [
    plannerInstructions({ id: "alex", role: "Employee" }),
    plannerInstructions({ id: "jordan", role: "IT Support" }),
  ].join("\n");
  expect(instructions).not.toContain("equipmentProfile");
  expect(instructions).not.toContain("already knows a policy fact");
  expect(instructions).toContain("order is not execution sequence");
  expect(instructions).toContain("do not add a ruled-out specialist");
  for (const testCase of [...planningCases, ...reviewCases]) {
    expect(instructions).not.toContain(testCase.request);
  }
  expect(planningCases).toHaveLength(15);
  expect(reviewCases).toHaveLength(9);
});

it("accepts the independent VPN and vacation split", () => {
  const testCase = planningCases.find((item) => item.id === "A1");
  expect(testCase).toBeDefined();
  if (testCase === undefined) return;
  const plan: Plan = {
    tasks: [
      task({ id: "vpn", objective: "Find why the VPN is not connecting", order: 1 }),
      task({
        id: "leave",
        specialist: "hr",
        objective: "Find the normal vacation approval time",
        order: 2,
      }),
    ],
  };
  expect(assessPlan(testCase, plan).issues).toEqual([]);
});

it("treats one dependent question as one shared order, not clause position", () => {
  const testCase = reviewCases.find((item) => item.id === "R-B3");
  expect(testCase).toBeDefined();
  if (testCase === undefined) return;
  const shared: Plan = {
    tasks: [
      task({
        id: "policy",
        specialist: "hr",
        objective: "Determine the equipment profile under company policy",
        order: 1,
      }),
      task({
        id: "setup",
        objective: "Explain how to configure the laptop",
        order: 1,
        dependsOn: [{ taskId: "policy", information: "equipment profile" }],
      }),
    ],
  };
  expect(assessPlan(testCase, shared).issues).toEqual([]);
  const clausePosition: Plan = {
    tasks: [
      { ...shared.tasks[1], order: 1, id: "setup" },
      { ...shared.tasks[0], order: 2, id: "policy" },
    ],
  };
  expect(assessPlan(testCase, clausePosition).issues).toContain("order");
});

it("honors an explicit specialist covering every part of the message", () => {
  const testCase = reviewCases.find((item) => item.id === "R-A5");
  expect(testCase).toBeDefined();
  if (testCase === undefined) return;
  const honored: Plan = {
    tasks: [
      task({ id: "headset", objective: "Troubleshoot the headset in meetings", order: 1 }),
      task({
        id: "leave",
        objective: "State the bereavement leave allowance",
        order: 2,
      }),
    ],
  };
  expect(assessPlan(testCase, honored).issues).toEqual([]);
  const overridden: Plan = {
    tasks: [
      honored.tasks[0],
      task({
        id: "leave",
        specialist: "hr",
        objective: "State the bereavement leave allowance",
        order: 2,
      }),
    ],
  };
  expect(assessPlan(testCase, overridden).issues).toContain("named_specialist");
});

it("scores an independent plan with an extra edge as an unnecessary dependency", () => {
  const testCase = planningCases.find((item) => item.id === "A1");
  expect(testCase).toBeDefined();
  if (testCase === undefined) return;
  const scored = assessPlan(testCase, {
    tasks: [
      task({ id: "vpn", objective: "Find why the VPN is not connecting", order: 1 }),
      task({
        id: "leave",
        specialist: "hr",
        objective: "Find the normal vacation approval time",
        order: 2,
        dependsOn: [{ taskId: "vpn", information: "vpn status" }],
      }),
    ],
  });
  expect(scored.issues).toContain("unnecessary_dependency");
});
