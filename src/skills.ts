import vpnTroubleshooting from "../skills/vpn-troubleshooting/SKILL.md";
import type { AgentId } from "./capabilities";
import { permits } from "./capabilities";
import type { DemoUserId } from "./identity";

export const VPN_SKILL_ID = "vpn-troubleshooting";

export const DEGRADED_NEXT_STEP =
  "Reconnect only after the gateway reports that it is accepting new sessions.";

type SkillRecord = {
  id: string;
  description: string;
  body: string;
};

const SKILLS: Record<string, SkillRecord> = {
  [VPN_SKILL_ID]: {
    id: VPN_SKILL_ID,
    description: "Procedure for a VPN connection problem. The next step depends on the service state.",
    body: vpnTroubleshooting,
  },
};

export type SkillSummary = { id: string; description: string };

export type SkillLoad =
  | { ok: true; authorization: "allowed"; skillId: string; body: string }
  | { ok: false; authorization: "denied"; error: "denied" | "unknown_skill" };

export function skillCatalog(): SkillSummary[] {
  return Object.values(SKILLS).map((skill) => ({ id: skill.id, description: skill.description }));
}

export function loadSkill(input: { userId: DemoUserId; agent: AgentId; skillId: string }): SkillLoad {
  if (!permits(input.userId, input.agent, "troubleshooting")) {
    return { ok: false, authorization: "denied", error: "denied" };
  }
  const skill = SKILLS[input.skillId];
  if (skill === undefined) return { ok: false, authorization: "denied", error: "unknown_skill" };
  return { ok: true, authorization: "allowed", skillId: skill.id, body: skill.body };
}

export function skillNextStep(body: string, state: "operational" | "degraded"): string {
  const label = state === "degraded" ? "Degraded next step:" : "Operational next step:";
  const line = body.split("\n").find((item) => item.startsWith(label));
  return line?.slice(label.length).trim() ?? "";
}

export function itInstructions(): string {
  const listed = skillCatalog()
    .map((skill) => `- ${skill.id}: ${skill.description}`)
    .join("\n");
  return [
    "You are the IT specialist. Return a result to the orchestrator. You do not speak to the user directly.",
    "Skills you may load with loadSkill. Their procedures are not included here:",
    listed,
    "When the assignment needs one of those procedures, call loadSkill with that skill id and follow the returned instructions. Do not follow a procedure you have not loaded.",
    "A request that only asks whether a service is operational, up, or down does not need a skill. Call getServiceStatus once with the matching service id before answering.",
    "Quote the tool result's detail field once. Do not invent a status.",
    "When the assignment includes a fact from another specialist, use that fact and do not replace it.",
    "You have no HR policy tool. Loading a skill does not add a tool or a permission.",
  ].join("\n");
}
