import { DurableObject } from "cloudflare:workers";

export const TURN_BUDGET_MS = 1_000;
export const DEMO_USERS = ["alex", "jordan", "taylor"] as const;
export type DemoUserId = (typeof DEMO_USERS)[number];
export type AgentId = "orchestrator" | "it" | "hr";

export type HistoryEntry = {
  agent: AgentId;
  body: string;
};

export type TurnCommand = {
  turnId: string;
  idempotencyKey: string;
  requestHash: string;
  now: number;
  marker: string;
  hold?: boolean;
  pending?: string;
  entries?: HistoryEntry[];
  trace?: { eventType: string; detail: string };
  resetTarget?: DemoUserId;
};

export type Snapshot = {
  name: string | undefined;
  activeTurn: string | null;
  abandonedTurn: string | null;
  activeStartedAt: number | null;
  operationRuns: number;
  generation: number;
  pending: string | null;
  histories: { agent: string; turnId: string; body: string }[];
  traces: { turnId: string; eventType: string; detail: string }[];
  resets: { id: number; turnId: string; targetUser: string }[];
};

type Reservation =
  | { kind: "replay"; response: unknown }
  | {
      kind: "conflict";
      error: "turn_active" | "idempotency_mismatch" | "stale_session";
    }
  | { kind: "acquired" };

function isAgent(value: string): value is AgentId {
  return value === "orchestrator" || value === "it" || value === "hr";
}

export class SessionObject extends DurableObject {
  #gate: Promise<void> | undefined;
  #release: (() => void) | undefined;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
  }

  armHold(): void {
    this.#gate = new Promise((resolve) => {
      this.#release = resolve;
    });
  }

  releaseHold(): void {
    this.#release?.();
    this.#gate = undefined;
    this.#release = undefined;
  }

  async fetch(request: Request): Promise<Response> {
    const payload = (await request.json()) as {
      action?: string;
      command?: TurnCommand;
      turnId?: string;
      targetUser?: string;
    };

    if (payload.action === "read") {
      return Response.json(this.snapshot());
    }
    if (payload.action === "reset-session") {
      this.resetSession();
      return Response.json(this.snapshot());
    }
    if (payload.action === "simulate-reset") {
      return this.simulateReset(payload.turnId, payload.targetUser);
    }
    if (payload.action === "run") {
      if (payload.command === undefined) {
        return Response.json({ error: "missing_command" }, { status: 400 });
      }
      return this.run(payload.command);
    }
    return Response.json({ error: "unknown_action" }, { status: 400 });
  }

  private async run(command: TurnCommand): Promise<Response> {
    const reservation = this.ctx.storage.transactionSync(() =>
      this.reserve(command),
    );
    if (reservation.kind === "replay") {
      return Response.json({ replay: true, response: reservation.response });
    }
    if (reservation.kind === "conflict") {
      return Response.json({ error: reservation.error }, { status: 409 });
    }

    if (command.hold === true) {
      if (this.#gate === undefined) {
        return Response.json({ error: "hold_not_armed" }, { status: 500 });
      }
      await this.#gate;
    }

    const response = {
      turnId: command.turnId,
      marker: command.marker,
    };
    const wrote = this.ctx.storage.transactionSync(() =>
      this.finish(command, response),
    );
    if (!wrote) {
      return Response.json({ replay: false, wrote: false }, { status: 409 });
    }
    return Response.json({ replay: false, wrote: true, response });
  }

  private simulateReset(turnId: string | undefined, targetUser: string | undefined): Response {
    if (turnId === undefined || targetUser === undefined) {
      return Response.json({ error: "missing_reset" }, { status: 400 });
    }
    if (!DEMO_USERS.includes(targetUser as DemoUserId)) {
      return Response.json({ error: "unknown_target" }, { status: 400 });
    }
    const row = this.ctx.storage.transactionSync(() => {
      if (this.meta("active_turn") !== turnId) return undefined;
      this.sql.exec(
        `INSERT INTO resets (turn_id, target_user) VALUES (?, ?)
         ON CONFLICT(turn_id, target_user) DO NOTHING`,
        turnId,
        targetUser,
      );
      return this.sql
        .exec<{ id: number; turn_id: string; target_user: string }>(
          `SELECT id, turn_id, target_user FROM resets
           WHERE turn_id = ? AND target_user = ?`,
          turnId,
          targetUser,
        )
        .toArray()[0];
    });
    if (row === undefined) {
      return Response.json({ error: "stale_turn", wrote: false }, { status: 409 });
    }
    return Response.json({
      id: row.id,
      turnId: row.turn_id,
      targetUser: row.target_user,
    });
  }

  private reserve(command: TurnCommand): Reservation {
    const stored = this.sql
      .exec<{ request_hash: string; response_json: string; generation: number }>(
        `SELECT request_hash, response_json, generation FROM idempotency WHERE key = ?`,
        command.idempotencyKey,
      )
      .toArray()[0];
    if (stored !== undefined) {
      if (stored.generation !== this.sessionGeneration()) {
        return { kind: "conflict", error: "stale_session" };
      }
      if (stored.request_hash !== command.requestHash) {
        return { kind: "conflict", error: "idempotency_mismatch" };
      }
      return { kind: "replay", response: JSON.parse(stored.response_json) as unknown };
    }

    const active = this.meta("active_turn");
    const started = this.meta("active_started_at");
    if (active !== undefined) {
      const age = command.now - Number(started ?? command.now);
      if (age < TURN_BUDGET_MS) {
        return { kind: "conflict", error: "turn_active" };
      }
      this.setMeta("abandoned_turn", active);
    }

    this.setMeta("active_turn", command.turnId);
    this.setMeta("active_started_at", String(command.now));
    const runs = Number(this.meta("operation_runs") ?? "0") + 1;
    this.setMeta("operation_runs", String(runs));
    return { kind: "acquired" };
  }

  private finish(command: TurnCommand, response: unknown): boolean {
    if (this.meta("active_turn") !== command.turnId) return false;
    if (command.pending !== undefined) {
      this.sql.exec(
        `INSERT INTO pending (id, question) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET question = excluded.question`,
        command.pending,
      );
    }
    for (const entry of command.entries ?? []) {
      if (!isAgent(entry.agent)) continue;
      this.sql.exec(
        `INSERT INTO history (agent, turn_id, body) VALUES (?, ?, ?)`,
        entry.agent,
        command.turnId,
        entry.body,
      );
    }
    if (command.trace !== undefined) {
      this.sql.exec(
        `INSERT INTO traces (turn_id, event_type, detail) VALUES (?, ?, ?)`,
        command.turnId,
        command.trace.eventType,
        command.trace.detail,
      );
    }
    if (command.resetTarget !== undefined) {
      this.sql.exec(
        `INSERT INTO resets (turn_id, target_user) VALUES (?, ?)
         ON CONFLICT(turn_id, target_user) DO NOTHING`,
        command.turnId,
        command.resetTarget,
      );
    }
    this.sql.exec(
      `INSERT INTO idempotency (key, request_hash, response_json, generation)
       VALUES (?, ?, ?, ?)`,
      command.idempotencyKey,
      command.requestHash,
      JSON.stringify(response),
      this.sessionGeneration(),
    );
    this.deleteMeta("active_turn");
    this.deleteMeta("active_started_at");
    return true;
  }

  private resetSession(): void {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM history`);
      this.sql.exec(`DELETE FROM traces`);
      this.sql.exec(`DELETE FROM pending`);
      this.deleteMeta("active_turn");
      this.deleteMeta("active_started_at");
      this.setMeta("session_generation", String(this.sessionGeneration() + 1));
    });
  }

  private snapshot(): Snapshot {
    const started = this.meta("active_started_at");
    return {
      name: this.ctx.id.name,
      activeTurn: this.meta("active_turn") ?? null,
      abandonedTurn: this.meta("abandoned_turn") ?? null,
      activeStartedAt: started === undefined ? null : Number(started),
      operationRuns: Number(this.meta("operation_runs") ?? "0"),
      generation: this.sessionGeneration(),
      pending: this.sql
        .exec<{ question: string }>(`SELECT question FROM pending WHERE id = 1`)
        .toArray()[0]?.question ?? null,
      histories: this.sql
        .exec<{ agent: string; turn_id: string; body: string }>(
          `SELECT agent, turn_id, body FROM history ORDER BY id`,
        )
        .toArray()
        .map((row) => ({ agent: row.agent, turnId: row.turn_id, body: row.body })),
      traces: this.sql
        .exec<{ turn_id: string; event_type: string; detail: string }>(
          `SELECT turn_id, event_type, detail FROM traces ORDER BY id`,
        )
        .toArray()
        .map((row) => ({
          turnId: row.turn_id,
          eventType: row.event_type,
          detail: row.detail,
        })),
      resets: this.sql
        .exec<{ id: number; turn_id: string; target_user: string }>(
          `SELECT id, turn_id, target_user FROM resets ORDER BY id`,
        )
        .toArray()
        .map((row) => ({
          id: row.id,
          turnId: row.turn_id,
          targetUser: row.target_user,
        })),
    };
  }

  private ensureSchema(): void {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        generation INTEGER NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        body TEXT NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        detail TEXT NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS pending (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        question TEXT NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn_id TEXT NOT NULL,
        target_user TEXT NOT NULL,
        UNIQUE (turn_id, target_user)
      )`,
    );
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private sessionGeneration(): number {
    return Number(this.meta("session_generation") ?? "1");
  }

  private meta(key: string): string | undefined {
    return this.sql
      .exec<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key)
      .toArray()[0]?.value;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  private deleteMeta(key: string): void {
    this.sql.exec(`DELETE FROM meta WHERE key = ?`, key);
  }
}
