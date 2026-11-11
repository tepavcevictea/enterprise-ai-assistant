import { isDemoUser, type DemoUserId } from "./identity";
import { SessionObject } from "./session";

export { SessionObject };

function userFrom(request: Request): DemoUserId | undefined {
  const header = request.headers.get("x-demo-user");
  return isDemoUser(header) ? header : undefined;
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.searchParams.has("objectId")) {
      return Response.json({ error: "object_id_rejected" }, { status: 400 });
    }
    const userId = userFrom(request);
    if (userId === undefined) return Response.json({ error: "unknown_user" }, { status: 400 });

    if (request.method === "GET" && url.pathname === "/session") {
      return env.SESSION.getByName(userId).fetch(
        new Request(request.url, { method: "POST", body: JSON.stringify({ action: "read" }) }),
      );
    }
    if (request.method === "POST" && url.pathname === "/session/reset") {
      return env.SESSION.getByName(userId).fetch(
        new Request(request.url, { method: "POST", body: JSON.stringify({ action: "reset-session" }) }),
      );
    }
    if (request.method === "POST" && url.pathname === "/messages") {
      let payload: { message?: unknown; idempotencyKey?: unknown; objectId?: unknown };
      try {
        payload = (await request.json()) as { message?: unknown; idempotencyKey?: unknown; objectId?: unknown };
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }
      if (payload.objectId !== undefined) {
        return Response.json({ error: "object_id_rejected" }, { status: 400 });
      }
      return env.SESSION.getByName(userId).fetch(
        new Request(request.url, {
          method: "POST",
          body: JSON.stringify({
            action: "message",
            message: payload.message,
            idempotencyKey: payload.idempotencyKey,
          }),
        }),
      );
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },
};
