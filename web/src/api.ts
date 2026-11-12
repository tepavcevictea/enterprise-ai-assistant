import type { DemoUserId, Snapshot, TurnResponse } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const ERROR_TEXT: Record<string, string> = {
  turn_active: "A request is already running for this identity. Wait for it to finish.",
  idempotency_mismatch: "That request was already used for a different message.",
  stale_session: "This session was reset. Send the question again.",
  stale_turn: "That request lost its turn and was not saved.",
  invalid_message: "Enter a question of 2,000 characters or fewer.",
  invalid_idempotency_key: "The request could not be identified. Try again.",
  invalid_json: "The assistant service could not read that request.",
  unknown_user: "Choose Alex or Jordan.",
  object_id_rejected: "The assistant service rejected the request.",
  not_found: "The assistant service has no such route.",
  unreachable: "The assistant service is not reachable. From the repository root, run npm run dev.",
  unexpected: "The assistant service returned an unexpected response.",
};

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return ERROR_TEXT[error.code] ?? ERROR_TEXT.unexpected;
  if (error instanceof TypeError) return ERROR_TEXT.unreachable;
  return ERROR_TEXT.unexpected;
}

export async function readSession(userId: DemoUserId): Promise<Snapshot> {
  return parseSnapshot(await request(`/session`, { method: "GET", userId }));
}

export async function resetSession(userId: DemoUserId): Promise<Snapshot> {
  return parseSnapshot(await request(`/session/reset`, { method: "POST", userId, body: "{}" }));
}

export async function sendMessage(userId: DemoUserId, message: string, idempotencyKey: string): Promise<TurnResponse> {
  const body = await request(`/messages`, {
    method: "POST",
    userId,
    body: JSON.stringify({ message, idempotencyKey }),
  });
  if (!isTurn(body)) throw new ApiError(200, "unexpected");
  return body;
}

async function request(path: string, input: { method: string; userId: DemoUserId; body?: string }): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetch(path, {
      method: input.method,
      headers: {
        "content-type": "application/json",
        "x-demo-user": input.userId,
      },
      body: input.body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(0, "unreachable");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String(payload.error)
        : response.status >= 500
          ? "unreachable"
          : "unexpected";
    throw new ApiError(response.status, code);
  }
  return payload;
}

function parseSnapshot(value: unknown): Snapshot {
  if (!isSnapshot(value)) throw new ApiError(200, "unexpected");
  return value;
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.histories) && Array.isArray(record.traces) && Array.isArray(record.passwordResets);
}

function isTurn(value: unknown): value is TurnResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.turnId === "string" && typeof record.reply === "string" && typeof record.outcome === "string" && Array.isArray(record.trace);
}
