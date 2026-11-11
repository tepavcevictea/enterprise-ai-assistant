import type { DemoUser } from "./identity";

export type PolicyRole = "employee" | "it_support" | "hr_operations";

export type PolicyClassification = "general" | "hr-restricted";

export type PolicyDocument = {
  id: string;
  version: string;
  title: string;
  body: string;
  classification: PolicyClassification;
  facts?: Readonly<Record<string, string>>;
};

export const LEAVE_BODY =
  "Employees request leave through the HR portal. Managers approve planned leave.";

export const RESTRICTED_TITLE = "Restricted offboarding procedure";

export const RESTRICTED_BADGE = "NS-OFFBOARD-8841";

export const EQUIPMENT_PROFILE = "standard-laptop";

export const EQUIPMENT_BODY = `The standard employee equipment profile is ${EQUIPMENT_PROFILE}.`;

export const POLICIES: readonly PolicyDocument[] = [
  {
    id: "leave-approval",
    version: "2026-01",
    title: "Leave approval policy",
    body: LEAVE_BODY,
    classification: "general",
  },
  {
    id: "equipment-profiles",
    version: "2026-01",
    title: "Equipment profiles",
    body: EQUIPMENT_BODY,
    classification: "general",
    facts: { equipmentProfile: EQUIPMENT_PROFILE },
  },
  {
    id: "onboarding",
    version: "2026-01",
    title: "Employee onboarding",
    body: "New employees complete HR onboarding before their manager assigns equipment.",
    classification: "general",
  },
  {
    id: "offboarding",
    version: "2026-01",
    title: RESTRICTED_TITLE,
    body: `HR Operations only: collect badge ${RESTRICTED_BADGE} and disable accounts within one day.`,
    classification: "hr-restricted",
  },
];

export function policyRole(role: DemoUser["role"]): PolicyRole {
  if (role === "Employee") return "employee";
  if (role === "IT Support") return "it_support";
  return "hr_operations";
}

export function canReadPolicy(role: PolicyRole, policy: PolicyDocument): boolean {
  return policy.classification === "general" || role === "hr_operations";
}

const SEARCH_STOP_WORDS = new Set([
  "about",
  "also",
  "based",
  "company",
  "does",
  "from",
  "have",
  "into",
  "policy",
  "should",
  "that",
  "their",
  "they",
  "this",
  "under",
  "what",
  "when",
  "with",
  "your",
]);

export function visiblePolicies(role: PolicyRole, query: string): PolicyDocument[] {
  const needle = query.trim().toLowerCase();
  const words = needle
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !SEARCH_STOP_WORDS.has(word));
  const scored = POLICIES.flatMap((policy) => {
    if (!canReadPolicy(role, policy)) return [];
    const text = `${policy.title}\n${policy.body}`.toLowerCase();
    const exact = needle !== "" && text.includes(needle);
    const matched = words.filter((word) => text.includes(word)).length;
    const score = exact ? Math.max(matched, 1) + words.length : matched;
    return score > 0 ? [{ policy, score }] : [];
  });
  const best = scored.reduce((highest, item) => Math.max(highest, item.score), 0);
  return scored.filter((item) => item.score === best).map((item) => item.policy);
}

export function authorizedCopies(role: PolicyRole, value: unknown): PolicyDocument[] {
  if (!Array.isArray(value)) return [];
  const copies: PolicyDocument[] = [];
  for (const item of value) {
    const match = POLICIES.find((policy) => samePolicy(policy, item) && canReadPolicy(role, policy));
    if (match !== undefined) copies.push(match);
  }
  return copies;
}

export function renderPolicies(documents: readonly PolicyDocument[]): string {
  if (documents.length === 0) return "No matching policy was found.";
  return documents
    .map((policy) => `${policy.title} (${policy.id}, version ${policy.version})\n${policy.body}`)
    .join("\n\n");
}

function samePolicy(policy: PolicyDocument, value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    item.id === policy.id &&
    item.version === policy.version &&
    item.title === policy.title &&
    item.body === policy.body &&
    item.classification === policy.classification
  );
}
