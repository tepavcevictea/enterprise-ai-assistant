import type { DemoRole } from "./users";

export type PolicyClassification = "general" | "hr-restricted";

export type PolicyDocument = {
  id: string;
  title: string;
  body: string;
  classification: PolicyClassification;
};

export const POLICIES: readonly PolicyDocument[] = [
  {
    id: "leave-approval",
    title: "Leave approval policy",
    body: "Employees request leave through the HR portal. Managers approve planned leave.",
    classification: "general",
  },
  {
    id: "offboarding",
    title: "Restricted offboarding procedure",
    body: "HR Operations only: collect badge NS-OFFBOARD-8841 and disable accounts within one day.",
    classification: "hr-restricted",
  },
];

export function canReadPolicy(role: DemoRole, policy: PolicyDocument): boolean {
  return policy.classification === "general" || role === "hr_operations";
}

export function visiblePolicies(role: DemoRole, query: string): PolicyDocument[] {
  const needle = query.trim().toLowerCase();
  return POLICIES.filter(
    (policy) =>
      canReadPolicy(role, policy) &&
      `${policy.title}\n${policy.body}`.toLowerCase().includes(needle),
  );
}
