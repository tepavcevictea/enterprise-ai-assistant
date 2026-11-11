import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { POLICIES, canReadPolicy, visiblePolicies } from "../../src/policies";
import { userFromId, type DemoRole } from "../../src/users";
import { MODE_HEADER, USER_HEADER, type McpMode } from "../../src/pinned-fetch";

type PolicyEnv = {
  MCP_MODE?: string;
};

function modeFrom(request: Request, env: PolicyEnv): McpMode {
  const header = request.headers.get(MODE_HEADER);
  const configured = header ?? env.MCP_MODE;
  if (configured === "error" || configured === "timeout") return configured;
  return "ok";
}

function roleFromAuth(): DemoRole | undefined {
  const role = getMcpAuthContext()?.props.role;
  if (role === "employee" || role === "it_support" || role === "hr_operations") {
    return role;
  }
  return undefined;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 8_000);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function createServer(signal: AbortSignal, mode: McpMode): McpServer {
  const server = new McpServer({
    name: "northstar-policies",
    version: "1.0.0",
  });

  server.registerTool(
    "searchPolicies",
    {
      description: "Search fictional Northstar policies the caller may read.",
      inputSchema: z.object({ query: z.string().min(1) }),
    },
    async ({ query }) => {
      const role = roleFromAuth();
      if (role === undefined) {
        return {
          isError: true,
          content: [{ type: "text", text: "unauthenticated" }],
        };
      }
      if (mode === "error") {
        return {
          isError: true,
          content: [{ type: "text", text: "policy service failed" }],
        };
      }
      if (mode === "timeout") {
        await waitForAbort(signal);
        return {
          isError: true,
          content: [{ type: "text", text: "policy service timed out" }],
        };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(visiblePolicies(role, query)) },
        ],
      };
    },
  );

  server.registerTool(
    "exportAllPolicies",
    {
      description: "Decoy tool. The client allowlist must refuse it.",
      inputSchema: z.object({}),
    },
    async () => {
      const role = roleFromAuth();
      const documents =
        role === undefined
          ? []
          : POLICIES.filter((policy) => canReadPolicy(role, policy));
      return {
        content: [{ type: "text", text: JSON.stringify(documents) }],
      };
    },
  );

  return server;
}

export default {
  async fetch(
    request: Request,
    env: PolicyEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const user = userFromId(request.headers.get(USER_HEADER));
    if (user === undefined) {
      return new Response("Unknown demo user", { status: 401 });
    }
    const mode = modeFrom(request, env);
    const handler = createMcpHandler(() => createServer(request.signal, mode), {
      allowedHostnames: ["policy.local"],
      responseMode: "json",
      authContext: { props: { userId: user.id, role: user.role } },
    });
    return handler(request, env, ctx);
  },
};
