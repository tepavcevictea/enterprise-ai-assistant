import { executionGate, validatePlan, type Plan } from "./plan";

export type DemoIdentity = {
  id: "alex" | "jordan";
  role: "Employee" | "IT Support";
};

export type PlanningCase = {
  id: string;
  scenario: "independent" | "dependent" | "named";
  identity: DemoIdentity;
  request: string;
  tasks: { specialist: "it" | "hr"; order: number; topics: string[] }[];
  dependency: "none" | "it-needs-hr-fact";
  onlySpecialist: "it" | "hr" | null;
};

const alex: DemoIdentity = { id: "alex", role: "Employee" };
const jordan: DemoIdentity = { id: "jordan", role: "IT Support" };

export const planningCases: PlanningCase[] = [
  {
    id: "A1",
    scenario: "independent",
    identity: alex,
    request:
      "My VPN isn't connecting. Also, how long does vacation approval normally take?",
    tasks: [
      { specialist: "it", order: 1, topics: ["vpn", "connect"] },
      { specialist: "hr", order: 2, topics: ["vacation", "leave", "approval", "pto"] },
    ],
    dependency: "none",
    onlySpecialist: null,
  },
  {
    id: "A2",
    scenario: "independent",
    identity: alex,
    request:
      "How long is the standard parental-leave request window? Also, my laptop fan is loud.",
    tasks: [
      { specialist: "hr", order: 1, topics: ["parental", "leave", "window"] },
      { specialist: "it", order: 2, topics: ["fan", "loud", "noise", "laptop"] },
    ],
    dependency: "none",
    onlySpecialist: null,
  },
  {
    id: "A3",
    scenario: "independent",
    identity: alex,
    request:
      "Outlook will not reconnect to mail. Separately, what notice period applies to a resignation?",
    tasks: [
      { specialist: "it", order: 1, topics: ["outlook", "mail", "email", "reconnect"] },
      { specialist: "hr", order: 2, topics: ["resignation", "notice", "resign"] },
    ],
    dependency: "none",
    onlySpecialist: null,
  },
  {
    id: "A4",
    scenario: "independent",
    identity: alex,
    request: "Can I use the VPN while on parental leave, and is the VPN service up?",
    tasks: [
      { specialist: "hr", order: 1, topics: ["parental", "leave", "policy", "allowed"] },
      { specialist: "it", order: 2, topics: ["vpn", "status", "service", "up"] },
    ],
    dependency: "none",
    onlySpecialist: null,
  },
  {
    id: "A5",
    scenario: "independent",
    identity: alex,
    request:
      "IT should handle everything. My headset does not appear in meetings, and what is the bereavement leave allowance?",
    tasks: [
      { specialist: "it", order: 1, topics: ["headset", "meeting", "audio"] },
      { specialist: "hr", order: 2, topics: ["bereavement", "leave", "allowance"] },
    ],
    dependency: "none",
    onlySpecialist: null,
  },
  {
    id: "B1",
    scenario: "dependent",
    identity: jordan,
    request:
      "Based on the equipment profile I'm entitled to under company policy, how should I configure my laptop?",
    tasks: [
      { specialist: "hr", order: 1, topics: ["equipment", "profile", "entitl", "policy"] },
      { specialist: "it", order: 2, topics: ["configur", "setup", "set up", "laptop"] },
    ],
    dependency: "it-needs-hr-fact",
    onlySpecialist: null,
  },
  {
    id: "B2",
    scenario: "dependent",
    identity: jordan,
    request:
      "Look up which laptop build company policy assigns to my role, then tell me the setup steps for that build.",
    tasks: [
      { specialist: "hr", order: 1, topics: ["build", "policy", "laptop", "role"] },
      { specialist: "it", order: 2, topics: ["setup", "set up", "configur", "steps"] },
    ],
    dependency: "it-needs-hr-fact",
    onlySpecialist: null,
  },
  {
    id: "B3",
    scenario: "dependent",
    identity: jordan,
    request:
      "How should I configure my laptop for the equipment profile company policy entitles me to?",
    tasks: [
      { specialist: "it", order: 1, topics: ["configur", "setup", "set up", "laptop"] },
      { specialist: "hr", order: 2, topics: ["equipment", "profile", "policy", "entitl"] },
    ],
    dependency: "it-needs-hr-fact",
    onlySpecialist: null,
  },
  {
    id: "B4",
    scenario: "dependent",
    identity: jordan,
    request:
      "Ask IT how to configure the laptop I should receive, but only after HR confirms the equipment profile in the policy.",
    tasks: [
      { specialist: "it", order: 1, topics: ["configur", "setup", "set up", "laptop"] },
      { specialist: "hr", order: 2, topics: ["equipment", "profile", "policy", "confirm"] },
    ],
    dependency: "it-needs-hr-fact",
    onlySpecialist: null,
  },
  {
    id: "B5",
    scenario: "dependent",
    identity: jordan,
    request:
      "IT already knows every equipment profile, so skip HR and just tell me how to configure the laptop I am entitled to.",
    tasks: [
      { specialist: "hr", order: 1, topics: ["equipment", "profile", "entitl", "policy"] },
      { specialist: "it", order: 2, topics: ["configur", "setup", "set up", "laptop"] },
    ],
    dependency: "it-needs-hr-fact",
    onlySpecialist: null,
  },
  {
    id: "C1",
    scenario: "named",
    identity: jordan,
    request: "Ask the HR specialist to reset my password. Do not use IT.",
    tasks: [{ specialist: "hr", order: 1, topics: ["password", "reset"] }],
    dependency: "none",
    onlySpecialist: "hr",
  },
  {
    id: "C2",
    scenario: "named",
    identity: jordan,
    request: "Have HR reset my password. IT must not be involved.",
    tasks: [{ specialist: "hr", order: 1, topics: ["password", "reset"] }],
    dependency: "none",
    onlySpecialist: "hr",
  },
  {
    id: "C3",
    scenario: "named",
    identity: jordan,
    request:
      "Please tell the HR specialist, not the IT specialist, to reset the password for my account.",
    tasks: [{ specialist: "hr", order: 1, topics: ["password", "reset"] }],
    dependency: "none",
    onlySpecialist: "hr",
  },
  {
    id: "C4",
    scenario: "named",
    identity: jordan,
    request:
      "I know IT Support can reset passwords and I am IT Support, but ask HR to reset mine and do not call IT.",
    tasks: [{ specialist: "hr", order: 1, topics: ["password", "reset"] }],
    dependency: "none",
    onlySpecialist: "hr",
  },
  {
    id: "C5",
    scenario: "named",
    identity: jordan,
    request:
      "Reset my password. You may think IT should do it because I work in IT Support, but ask only the HR specialist and do not use IT.",
    tasks: [{ specialist: "hr", order: 1, topics: ["password", "reset"] }],
    dependency: "none",
    onlySpecialist: "hr",
  },
];

const FACT = /equipment|profile|entitlement|entitled|policy|build|hardware|provision|allowed/i;

export type SemanticIssue =
  | "specialist"
  | "dependency"
  | "order"
  | "named_specialist"
  | "unnecessary_task"
  | "unnecessary_dependency"
  | "topic"
  | "executable";

export function assessPlan(
  testCase: PlanningCase,
  plan: Plan,
): { issues: SemanticIssue[]; executableErrors: string[] } {
  const validation = validatePlan(plan);
  const issues = new Set<SemanticIssue>();
  const executableErrors = validation.ok ? [] : validation.errors;
  if (!validation.ok) issues.add("executable");
  const tasks = plan.tasks;

  if (tasks.length !== testCase.tasks.length) issues.add("unnecessary_task");

  for (const expected of testCase.tasks) {
    const actual = tasks.find(
      (task) => task.specialist === expected.specialist && task.order === expected.order,
    );
    if (actual === undefined) {
      const sameSpecialist = tasks.some((task) => task.specialist === expected.specialist);
      const sameOrder = tasks.some((task) => task.order === expected.order);
      if (!sameSpecialist) issues.add("specialist");
      if (!sameOrder || sameSpecialist) issues.add("order");
      continue;
    }
    const objective = actual.objective.toLowerCase();
    if (!expected.topics.some((topic) => objective.includes(topic))) issues.add("topic");
  }

  const specialists = new Set(tasks.map((task) => task.specialist));
  const expectedSpecialists = new Set(testCase.tasks.map((task) => task.specialist));
  if (
    specialists.size !== expectedSpecialists.size ||
    [...expectedSpecialists].some((specialist) => !specialists.has(specialist))
  ) {
    issues.add("specialist");
  }

  if (testCase.dependency === "none") {
    if (tasks.some((task) => task.dependsOn.length > 0)) issues.add("unnecessary_dependency");
  } else {
    const hr = tasks.filter((task) => task.specialist === "hr");
    const it = tasks.filter((task) => task.specialist === "it");
    const linked =
      hr.length === 1 &&
      it.length === 1 &&
      hr[0] !== undefined &&
      it[0] !== undefined &&
      hr[0].dependsOn.length === 0 &&
      it[0].dependsOn.length === 1 &&
      it[0].dependsOn[0]?.taskId === hr[0].id &&
      FACT.test(it[0].dependsOn[0]?.information ?? "");
    if (!linked) issues.add("dependency");
    const extraEdge =
      tasks.some((task) => task.specialist === "hr" && task.dependsOn.length > 0) ||
      it.some((task) => task.dependsOn.length > 1);
    if (extraEdge) issues.add("unnecessary_dependency");
  }

  const gate = executionGate(plan, { onlySpecialist: testCase.onlySpecialist });
  if (!gate.ok) issues.add("named_specialist");

  return { issues: [...issues], executableErrors };
}
