import { DurableObject } from "cloudflare:workers";
import { isAgent } from "./capabilities";
import { isDemoUser, USERS } from "./identity";
import { modelPort } from "./models";
import type { TraceEvent } from "./trace";
import { runTurn, type HistoryEntry } from "./turn";

export const TURN_BUDGET_MS = 90_000;
const HISTORY_CAP = 20;

export type TurnResponse = {
  turnId: string;
  reply: string;
  outcome: string;
  trace: TraceEvent[];
  replay?: boolean;
};

export type Snapshot = {
  name: string | undefined;
  activeTurn: string | null;
  abandonedTurn: string | null;
  generation: number;
  histories: { agent: string; turnId: string; body: string }[];
  traces: TraceEvent[];
};

type Reservation =
  | { kind: "replay"; response: TurnResponse }
  | { kind: "conflict"; error: "turn_active" | "idempotency_mismatch" | "stale_session" }
  | { kind: "acquired" };

export class SessionObject extends DurableObject<Cloudflare.Env> {
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
      message?: unknown;
      idempotencyKey?: unknown;
    };
    if (payload.action === "read") return Response.json(this.snapshot());
    if (payload.action === "reset-session") {
      this.resetSession();
      return Response.json(this.snapshot());
    }
    if (payload.action === "message") return this.message(payload.message, payload.idempotencyKey);
    return Response.json({ error: "unknown_action" }, { status: 400 });
  }

  private async message(message: unknown, idempotencyKey: unknown): Promise<Response> {
    const userId = this.ctx.id.name;
    if (!isDemoUser(userId)) return Response.json({ error: "unknown_user" }, { status: 400 });
    if (typeof message !== "string" || message.trim() === "" || message.length > 2_000) {
      return Response.json({ error: "invalid_message" }, { status: 400 });
    }
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "" || idempotencyKey.length > 200) {
      return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
    }
    const text = message.trim();
    const requestHash = await digest(`${userId}\n${text}`);
    const turnId = crypto.randomUUID();
    const reservation = this.ctx.storage.transactionSync(() =>
      this.reserve({ turnId, idempotencyKey, requestHash, now: Date.now() }),
    );
    if (reservation.kind === "replay") {
      return Response.json({ ...reservation.response, replay: true });
    }
    if (reservation.kind === "conflict") {
      return Response.json({ error: reservation.error }, { status: 409 });
    }
    if (this.#gate !== undefined) await this.#gate;
    if (this.meta("active_turn") !== turnId) {
      return Response.json({ error: "stale_turn", wrote: false }, { status: 409 });
    }

    const history = this.readHistory();
    let result;
    try {
      result = await runTurn({
        user: USERS[userId],
        message: text,
        turnId,
        history,
        models: modelPort(this.env),
      });
    } catch (error) {
      const reply = "The turn failed before a reply was stored.";
      result = {
        reply,
        outcome: "failed" as const,
        trace: [] as TraceEvent[],
        entries: [
          { agent: "orchestrator" as const, body: `user: ${text}` },
          { agent: "orchestrator" as const, body: `assistant: ${reply}` },
        ],
        error,
      };
    }
    const response: TurnResponse = {
      turnId,
      reply: result.reply,
      outcome: result.outcome,
      trace: result.trace,
    };
    const wrote = this.ctx.storage.transactionSync(() =>
      this.finish({
        turnId,
        idempotencyKey,
        requestHash,
        response,
        entries: result.entries,
      }),
    );
    if (!wrote) return Response.json({ error: "stale_turn", wrote: false }, { status: 409 });
    return Response.json(response);
  }

  private reserve(command: {
    turnId: string;
    idempotencyKey: string;
    requestHash: string;
    now: number;
  }): Reservation {
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
      return { kind: "replay", response: JSON.parse(stored.response_json) as TurnResponse };
    }
    const active = this.meta("active_turn");
    const started = this.meta("active_started_at");
    if (active !== undefined) {
      const age = command.now - Number(started ?? command.now);
      if (age < TURN_BUDGET_MS) return { kind: "conflict", error: "turn_active" };
      this.setMeta("abandoned_turn", active);
    }
    this.setMeta("active_turn", command.turnId);
    this.setMeta("active_started_at", String(command.now));
    return { kind: "acquired" };
  }

  private finish(command: {
    turnId: string;
    idempotencyKey: string;
    requestHash: string;
    response: TurnResponse;
    entries: HistoryEntry[];
  }): boolean {
    if (this.meta("active_turn") !== command.turnId) return false;
    for (const entry of command.entries) {
      if (!isAgent(entry.agent)) continue;
      this.sql.exec(
        `INSERT INTO history (agent, turn_id, body) VALUES (?, ?, ?)`,
        entry.agent,
        command.turnId,
        entry.body,
      );
      this.sql.exec(
        `DELETE FROM history WHERE agent = ? AND id NOT IN (
          SELECT id FROM history WHERE agent = ? ORDER BY id DESC LIMIT ?
        )`,
        entry.agent,
        entry.agent,
        HISTORY_CAP,
      );
    }
    for (const event of command.response.trace) {
      this.sql.exec(
        `INSERT INTO traces (turn_id, event_json) VALUES (?, ?)`,
        command.turnId,
        JSON.stringify(event),
      );
    }
    this.sql.exec(
      `INSERT INTO idempotency (key, request_hash, response_json, generation) VALUES (?, ?, ?, ?)`,
      command.idempotencyKey,
      command.requestHash,
      JSON.stringify(command.response),
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
      this.deleteMeta("active_turn");
      this.deleteMeta("active_started_at");
      this.setMeta("session_generation", String(this.sessionGeneration() + 1));
    });
  }

  private readHistory(): { agent: string; body: string }[] {
    return this.sql
      .exec<{ agent: string; body: string }>(`SELECT agent, body FROM history ORDER BY id`)
      .toArray();
  }

  private snapshot(): Snapshot {
    return {
      name: this.ctx.id.name,
      activeTurn: this.meta("active_turn") ?? null,
      abandonedTurn: this.meta("abandoned_turn") ?? null,
      generation: this.sessionGeneration(),
      histories: this.sql
        .exec<{ agent: string; turn_id: string; body: string }>(
          `SELECT agent, turn_id, body FROM history ORDER BY id`,
        )
        .toArray()
        .map((row) => ({ agent: row.agent, turnId: row.turn_id, body: row.body })),
      traces: this.sql
        .exec<{ event_json: string }>(`SELECT event_json FROM traces ORDER BY id`)
        .toArray()
        .map((row) => JSON.parse(row.event_json) as TraceEvent),
    };
  }

  private ensureSchema(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
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
        event_json TEXT NOT NULL
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
    return this.sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key).toArray()[0]?.value;
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

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
