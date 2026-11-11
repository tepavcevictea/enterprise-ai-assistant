export const DEMO_USERS = {
  alex: { id: "alex", role: "employee" },
  jordan: { id: "jordan", role: "it_support" },
  taylor: { id: "taylor", role: "hr_operations" },
} as const;

export type DemoUserId = keyof typeof DEMO_USERS;
export type DemoRole = (typeof DEMO_USERS)[DemoUserId]["role"];

export function userFromId(id: string | null): {
  id: DemoUserId;
  role: DemoRole;
} | undefined {
  if (id === "alex" || id === "jordan" || id === "taylor") {
    return DEMO_USERS[id];
  }
  return undefined;
}
