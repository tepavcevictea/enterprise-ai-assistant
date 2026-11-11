import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import type { CallToolResult } from "@ai-sdk/mcp";
import {
  POLICY_MCP_URL,
  USER_HEADER,
  createPinnedPolicyFetch,
  type PolicyBinding,
  type ProtocolExchange,
} from "../src/pinned-fetch";
import {
  discoverTools,
  refuseUnlistedTool,
  searchPolicies,
} from "../src/policy-client";

const binding = (): PolicyBinding => env.POLICY;

function textOf(result: CallToolResult): string {
  const content: unknown = result.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) => {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .join("\n");
}

function trace(exchanges: ProtocolExchange[]): string[] {
  return exchanges.map(
    (exchange) =>
      `${exchange.method} ${exchange.status} ${exchange.rpcMethod ?? "-"} redirect=${exchange.requestedRedirect ?? "-"}>${exchange.sentRedirect}`,
  );
}

it("discovers and calls the policy tool through the service binding", async () => {
  const search = await searchPolicies({
    binding: binding(),
    userId: "alex",
    query: "leave",
  });

  expect(trace(search.exchanges)).toEqual([
    "POST 200 server/discover redirect=error>manual",
    "POST 200 tools/list redirect=error>manual",
    "POST 200 tools/call redirect=error>manual",
  ]);
  expect(search.toolNames).toContain("searchPolicies");
  expect(search.toolNames).toContain("exportAllPolicies");
  expect(search.exchanges.some((exchange) => exchange.rpcMethod === "tools/list")).toBe(true);
  expect(search.exchanges.some((exchange) => exchange.rpcMethod === "tools/call")).toBe(true);
  expect(search.exchanges.every((exchange) => exchange.url === POLICY_MCP_URL)).toBe(true);
  expect(search.exchanges.every((exchange) => exchange.sentRedirect === "manual")).toBe(true);
  expect(search.exchanges.some((exchange) => exchange.status >= 300 && exchange.status < 400)).toBe(false);
  expect(search.result.isError).not.toBe(true);
  expect(textOf(search.result)).toContain("Leave approval policy");
  expect(textOf(search.result)).not.toContain("Restricted offboarding procedure");
  expect(textOf(search.result)).not.toContain("NS-OFFBOARD-8841");
});

it("hides the restricted procedure from an employee and shows it to HR Operations", async () => {
  const employee = await searchPolicies({
    binding: binding(),
    userId: "alex",
    query: "offboarding",
    extraArguments: {
      userId: "taylor",
      role: "hr_operations",
      mode: "ok",
    },
  });
  const support = await searchPolicies({
    binding: binding(),
    userId: "jordan",
    query: "offboarding",
  });
  const hr = await searchPolicies({
    binding: binding(),
    userId: "taylor",
    query: "offboarding",
  });

  for (const result of [employee.result, support.result]) {
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe("[]");
    expect(textOf(result)).not.toContain("Restricted offboarding procedure");
    expect(textOf(result)).not.toContain("NS-OFFBOARD-8841");
  }
  expect(hr.result.isError).not.toBe(true);
  expect(textOf(hr.result)).toContain("Restricted offboarding procedure");
  expect(textOf(hr.result)).toContain("NS-OFFBOARD-8841");
});

it("refuses a discovered tool that is outside the client allowlist", async () => {
  const discovered = await discoverTools({ binding: binding(), userId: "taylor" });
  expect(discovered.toolNames).toContain("exportAllPolicies");
  expect(Object.keys(discovered.inputSchemas.searchPolicies?.properties ?? {})).toEqual([
    "query",
  ]);
  expect(discovered.exchanges.some((exchange) => exchange.rpcMethod === "tools/call")).toBe(false);
  expect(() => refuseUnlistedTool("exportAllPolicies")).toThrow(/allowlist/);
});

it("rejects an unexpected redirect without a second request", async () => {
  const seen: Array<{
    url: string;
    redirect: RequestInit["redirect"];
    user: string | null;
  }> = [];
  const fetch = createPinnedPolicyFetch({
    binding: {
      fetch: async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        seen.push({
          url,
          redirect: init?.redirect,
          user: new Headers(init?.headers).get(USER_HEADER),
        });
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/mcp" },
        });
      },
    },
    userId: "alex",
    exchanges: [],
  });

  await expect(
    fetch("https://evil.example/mcp", {
      method: "POST",
      redirect: "error",
      headers: { [USER_HEADER]: "taylor" },
    }),
  ).rejects.toMatchObject({ reason: "unpinned-destination" });
  expect(seen).toHaveLength(0);

  await expect(
    fetch(POLICY_MCP_URL, {
      method: "POST",
      redirect: "error",
      headers: { [USER_HEADER]: "taylor" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call" }),
    }),
  ).rejects.toMatchObject({ reason: "redirect" });
  expect(seen).toEqual([
    { url: POLICY_MCP_URL, redirect: "manual", user: "alex" },
  ]);
});

it("throws TypeError when a binding request is built with redirect error", async () => {
  await expect(
    env.POLICY.fetch(POLICY_MCP_URL, {
      method: "POST",
      redirect: "error",
      body: "{}",
    }),
  ).rejects.toThrow(TypeError);
});

it("surfaces a tool error and does not retry it into success", async () => {
  const failed = await searchPolicies({
    binding: binding(),
    userId: "alex",
    query: "leave",
    mode: "error",
  });
  const toolCalls = failed.exchanges.filter((exchange) => exchange.rpcMethod === "tools/call");
  expect(toolCalls).toHaveLength(1);
  expect(failed.result.isError).toBe(true);
  expect(textOf(failed.result)).toContain("policy service failed");
  expect(textOf(failed.result)).not.toContain("Leave approval policy");

  const counts = { toolCalls: 0 };
  const once = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      let method: string | undefined;
      try {
        method = (JSON.parse(body) as { method?: string }).method;
      } catch {
        method = undefined;
      }
      if (method === "tools/call") {
        counts.toolCalls += 1;
        return new Response("unavailable", { status: 503 });
      }
      return binding().fetch(input, init);
    },
  };
  let transportFailure = "";
  try {
    await searchPolicies({
      binding: once,
      userId: "alex",
      query: "leave",
      maxRetries: 0,
    });
    transportFailure = "retry returned a result";
  } catch (error) {
    transportFailure = error instanceof Error ? error.message : String(error);
  }
  expect(transportFailure).toBe(
    "MCP HTTP Transport Error: POSTing to endpoint (HTTP 503): unavailable",
  );
  expect(transportFailure).not.toContain("Leave approval policy");
  expect(counts.toolCalls).toBe(1);
});

it("fails a timed-out tool call instead of returning a policy", async () => {
  let timeoutFailure = "";
  try {
    await searchPolicies({
      binding: binding(),
      userId: "taylor",
      query: "offboarding",
      mode: "timeout",
      signal: AbortSignal.timeout(200),
    });
    timeoutFailure = "timed-out call returned";
  } catch (error) {
    timeoutFailure = error instanceof Error ? error.message : String(error);
  }
  expect(timeoutFailure).toBe("Request was aborted");
  expect(timeoutFailure).not.toContain("Restricted offboarding procedure");
  expect(timeoutFailure).not.toContain("NS-OFFBOARD-8841");
});
