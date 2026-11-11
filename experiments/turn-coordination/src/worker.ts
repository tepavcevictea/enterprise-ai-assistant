import { DEMO_USERS, SessionObject, type DemoUserId } from "./session";

export { SessionObject };

function isDemoUser(value: unknown): value is DemoUserId {
  return typeof value === "string" && DEMO_USERS.includes(value as DemoUserId);
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/session") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const payload = (await request.json()) as { userId?: unknown; objectId?: unknown };
    if (payload.objectId !== undefined) {
      return Response.json({ error: "object_id_rejected" }, { status: 400 });
    }
    if (!isDemoUser(payload.userId)) {
      return Response.json({ error: "unknown_user" }, { status: 400 });
    }
    return env.SESSION.getByName(payload.userId).fetch(request);
  },
};
