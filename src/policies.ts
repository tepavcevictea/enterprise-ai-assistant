import type { DemoUser } from "./identity";

export type PolicyRole = "employee" | "it_support";

export type PolicyClassification = "general";

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
];

export function policyRole(role: DemoUser["role"]): PolicyRole {
  return role === "Employee" ? "employee" : "it_support";
}

export function canReadPolicy(role: PolicyRole, policy: PolicyDocument): boolean {
  return (role === "employee" || role === "it_support") && policy.classification === "general";
}

const DETAIL_FILLERS = new Set([
  "also",
  "asked",
  "asking",
  "check",
  "describe",
  "determine",
  "ask",
  "asks",
  "explain",
  "find",
  "finds",
  "found",
  "give",
  "given",
  "gives",
  "help",
  "look",
  "looking",
  "looks",
  "read",
  "reads",
  "said",
  "says",
  "show",
  "shown",
  "shows",
  "include",
  "includes",
  "just",
  "know",
  "like",
  "many",
  "more",
  "much",
  "need",
  "okay",
  "only",
  "please",
  "really",
  "report",
  "retrieve",
  "some",
  "specify",
  "specified",
  "state",
  "states",
  "still",
  "tell",
  "tells",
  "told",
  "want",
  "well",
  "whether",
  "yeah",
]);

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
  return documents.map((policy) => `${policy.title}. ${policy.body}`).join("\n\n");
}

export function citedPolicy(priorText: string): PolicyDocument | undefined {
  let found: { policy: PolicyDocument; index: number } | undefined;
  for (const policy of POLICIES) {
    const index = priorText.lastIndexOf(policy.title);
    if (index < 0 || !priorText.includes(policy.body)) continue;
    if (found === undefined || index > found.index) found = { policy, index };
  }
  return found?.policy;
}

export function describePolicyAnswer(documents: readonly PolicyDocument[], question: string): string {
  const rendered = renderPolicies(documents);
  const missing = missingTerms(question, documents);
  if (missing.length === 0) return rendered;
  const detail = missing.length > 3 ? "the extra detail in your question" : phrase(missing);
  return `${rendered}\n\nThe retrieved policy does not specify ${detail}.`;
}

function missingTerms(question: string, documents: readonly PolicyDocument[]): string[] {
  if (documents.length === 0) return [];
  const text = documents.map((policy) => `${policy.title}\n${policy.body}`).join("\n").toLowerCase();
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const word of question.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 4 || SEARCH_STOP_WORDS.has(word) || DETAIL_FILLERS.has(word) || seen.has(word)) continue;
    seen.add(word);
    if (!text.includes(word)) missing.push(word);
  }
  return missing;
}

function phrase(terms: string[]): string {
  if (terms.length === 1) return terms[0] ?? "";
  const last = terms[terms.length - 1] ?? "";
  return `${terms.slice(0, -1).join(", ")} or ${last}`;
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
