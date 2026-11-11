import type { PlanningCase } from "./planning-cases";

const alex = { id: "alex" as const, role: "Employee" as const };
const jordan = { id: "jordan" as const, role: "IT Support" as const };

export const reviewCases: PlanningCase[] = [
  {
    id: "R-A5",
    scenario: "named",
    identity: alex,
    request:
      "IT should handle everything. My headset does not appear in meetings, and what is the bereavement leave allowance?",
    tasks: [
      { specialist: "it", order: 1, topics: ["headset", "meeting"] },
      { specialist: "it", order: 2, topics: ["bereavement", "leave", "allowance"] },
    ],
    dependency: "none",
    onlySpecialist: "it",
  },
  {
    id: "R-A5b",
    scenario: "named",
    identity: alex,
    request:
      "Have IT take care of all of this. My monitor stays black, and how many sick days do new employees receive?",
    tasks: [
      { specialist: "it", order: 1, topics: ["monitor", "black", "screen"] },
      { specialist: "it", order: 2, topics: ["sick", "leave", "day"] },
    ],
    dependency: "none",
    onlySpecialist: "it",
  },
  {
    id: "R-split",
    scenario: "independent",
    identity: alex,
    request:
      "Ask IT why my headset does not appear in meetings. What is the bereavement leave allowance?",
    tasks: [
      { specialist: "it", order: 1, topics: ["headset", "meeting"] },
      { specialist: "hr", order: 2, topics: ["bereavement", "leave", "allowance"] },
    ],
    dependency: "none",
    onlySpecialist: null,
  },
  {
    id: "R-named-hr",
    scenario: "named",
    identity: jordan,
    request: "Ask the HR specialist to reset my password. Do not use IT.",
    tasks: [{ specialist: "hr", order: 1, topics: ["password", "reset"] }],
    dependency: "none",
    onlySpecialist: "hr",
  },
  {
    id: "R-exclude-hr",
    scenario: "named",
    identity: jordan,
    request:
      "Do not ask HR. Tell me how to configure the laptop company policy entitles me to.",
    tasks: [{ specialist: "it", order: 1, topics: ["configur", "setup", "set up", "laptop"] }],
    dependency: "none",
    onlySpecialist: "it",
  },
  {
    id: "R-B3",
    scenario: "dependent",
    identity: jordan,
    request:
      "How should I configure my laptop for the equipment profile company policy entitles me to?",
    tasks: [
      { specialist: "hr", order: 1, topics: ["equipment", "profile", "policy", "entitl"] },
      { specialist: "it", order: 1, topics: ["configur", "setup", "set up", "laptop"] },
    ],
    dependency: "it-needs-hr-fact",
    onlySpecialist: null,
  },
  {
    id: "R-B3b",
    scenario: "dependent",
    identity: jordan,
    request: "What setup should I use for the laptop profile I am entitled to under company policy?",
    tasks: [
      { specialist: "hr", order: 1, topics: ["profile", "entitl", "policy", "equipment"] },
      { specialist: "it", order: 1, topics: ["setup", "configur", "laptop"] },
    ],
    dependency: "it-needs-hr-fact",
    onlySpecialist: null,
  },
  {
    id: "R-B4",
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
    id: "R-two-questions",
    scenario: "independent",
    identity: alex,
    request: "My VPN isn't connecting. Also, how long does vacation approval normally take?",
    tasks: [
      { specialist: "it", order: 1, topics: ["vpn", "connect"] },
      { specialist: "hr", order: 2, topics: ["vacation", "leave", "approval"] },
    ],
    dependency: "none",
    onlySpecialist: null,
  },
];
