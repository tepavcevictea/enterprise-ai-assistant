export const DEMO_USERS = [
  { id: "alex", name: "Alex", email: "alex@northstar.example", role: "Employee" },
  { id: "jordan", name: "Jordan", email: "jordan@northstar.example", role: "IT Support" },
  { id: "taylor", name: "Taylor", email: "taylor@northstar.example", role: "HR Operations" },
] as const;

export type DemoUserId = (typeof DEMO_USERS)[number]["id"];

export type AgentId = "orchestrator" | "it" | "hr";

export type TraceEvent = {
  traceId: string;
  sessionId: string;
  turnId: string;
  taskId?: string;
  agentId: AgentId;
  eventType: string;
  timestamp: string;
  durationMs?: number;
  outcome?: string;
  toolId?: string;
  errorCode?: string;
  authorization?: "allowed" | "denied";
  sourceIds?: string[];
  result?: string;
};

export type HistoryRow = {
  agent: string;
  turnId: string;
  body: string;
};

export type PasswordResetRow = {
  turnId: string;
  targetUser: string;
  detail: string;
};

export type Snapshot = {
  name: string | undefined;
  activeTurn: string | null;
  abandonedTurn: string | null;
  generation: number;
  histories: HistoryRow[];
  traces: TraceEvent[];
  passwordResets: PasswordResetRow[];
};

export type TurnResponse = {
  turnId: string;
  reply: string;
  outcome: string;
  trace: TraceEvent[];
  replay?: boolean;
};
