import type { AgentId } from "./capabilities";
import { permits } from "./capabilities";
import type { DemoUserId } from "./identity";

export const RESET_DENIED = "You do not have permission to reset a password.";

export const RESET_WITHHELD = "The assigned specialist cannot reset a password.";

export type PasswordResetRecord = {
  targetUser: DemoUserId;
  turnId: string;
  simulation: true;
  detail: string;
};

export type PasswordResetResult =
  | { ok: true; authorization: "allowed"; record: PasswordResetRecord }
  | { ok: false; authorization: "denied"; error: "denied" };

export function simulatePasswordReset(input: {
  userId: DemoUserId;
  agent: AgentId;
  turnId: string;
}): PasswordResetResult {
  if (!permits(input.userId, input.agent, "password_reset")) {
    return { ok: false, authorization: "denied", error: "denied" };
  }
  return {
    ok: true,
    authorization: "allowed",
    record: {
      targetUser: input.userId,
      turnId: input.turnId,
      simulation: true,
      detail: `Simulated password reset for ${input.userId}. No real credential was changed.`,
    },
  };
}
