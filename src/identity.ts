export const DEMO_USERS = ["alex", "jordan"] as const;

export type DemoUserId = (typeof DEMO_USERS)[number];

export type DemoUser = {
  id: DemoUserId;
  email: string;
  role: "Employee" | "IT Support";
};

export const USERS: Record<DemoUserId, DemoUser> = {
  alex: { id: "alex", email: "alex@northstar.example", role: "Employee" },
  jordan: { id: "jordan", email: "jordan@northstar.example", role: "IT Support" },
};

export function isDemoUser(value: unknown): value is DemoUserId {
  return typeof value === "string" && DEMO_USERS.includes(value as DemoUserId);
}
