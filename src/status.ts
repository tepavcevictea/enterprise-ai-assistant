import type { AgentId } from "./capabilities";
import { permits } from "./capabilities";
import type { DemoUserId } from "./identity";

export const SERVICE_IDS = ["vpn", "email", "wifi"] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

export type ServiceStatus = {
  serviceId: ServiceId;
  operational: boolean;
  state: "operational" | "degraded";
  detail: string;
};

export const VPN_DETAIL =
  "Northstar VPN gateway is rejecting new sessions (ns-vpn-degraded).";

const SERVICES: Record<ServiceId, ServiceStatus> = {
  vpn: {
    serviceId: "vpn",
    operational: false,
    state: "degraded",
    detail: VPN_DETAIL,
  },
  email: {
    serviceId: "email",
    operational: true,
    state: "operational",
    detail: "Northstar mail is accepting connections.",
  },
  wifi: {
    serviceId: "wifi",
    operational: true,
    state: "operational",
    detail: "Northstar office wireless is available.",
  },
};

export type StatusResult =
  | { ok: true; authorization: "allowed"; status: ServiceStatus }
  | { ok: false; authorization: "denied"; error: "denied" | "unknown_service" };

export function runServiceStatus(input: {
  userId: DemoUserId;
  agent: AgentId;
  serviceId: string;
}): StatusResult {
  if (!permits(input.userId, input.agent, "service_status")) {
    return { ok: false, authorization: "denied", error: "denied" };
  }
  if (!isServiceId(input.serviceId)) {
    return { ok: false, authorization: "denied", error: "unknown_service" };
  }
  return { ok: true, authorization: "allowed", status: SERVICES[input.serviceId] };
}

function isServiceId(value: string): value is ServiceId {
  return SERVICE_IDS.includes(value as ServiceId);
}
