import type { DemoUserId } from "./identity";

export type AgentId = "orchestrator" | "it" | "hr";

export type Capability =
  | "service_status"
  | "troubleshooting"
  | "password_reset"
  | "hr_policy"
  | "equipment_policy"
  | "hr_restricted";

const USER_GRANTS: Record<DemoUserId, readonly Capability[]> = {
  alex: ["service_status", "troubleshooting", "hr_policy", "equipment_policy"],
  jordan: ["service_status", "troubleshooting", "hr_policy", "equipment_policy", "password_reset"],
  taylor: ["service_status", "troubleshooting", "hr_policy", "equipment_policy", "hr_restricted"],
};

const AGENT_GRANTS: Record<AgentId, readonly Capability[]> = {
  orchestrator: [],
  it: ["service_status", "troubleshooting", "password_reset"],
  hr: ["hr_policy", "equipment_policy", "hr_restricted"],
};

export function permits(userId: DemoUserId, agent: AgentId, capability: Capability): boolean {
  return USER_GRANTS[userId].includes(capability) && AGENT_GRANTS[agent].includes(capability);
}

export function isAgent(value: string): value is AgentId {
  return value === "orchestrator" || value === "it" || value === "hr";
}
