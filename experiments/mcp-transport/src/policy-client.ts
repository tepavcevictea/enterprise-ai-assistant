import { createMCPClient, type CallToolResult } from "@ai-sdk/mcp";
import {
  POLICY_MCP_URL,
  createPinnedPolicyFetch,
  type McpMode,
  type PolicyBinding,
  type ProtocolExchange,
} from "./pinned-fetch";

export const ALLOWED_TOOLS = ["searchPolicies"] as const;

export type PolicySearch = {
  toolNames: string[];
  result: CallToolResult;
  exchanges: ProtocolExchange[];
};

function assertAllowlisted(name: string): void {
  if (!(ALLOWED_TOOLS as readonly string[]).includes(name)) {
    throw new Error(`refusing tool outside the policy allowlist: ${name}`);
  }
}

export async function searchPolicies(options: {
  binding: PolicyBinding;
  userId: string;
  query: string;
  mode?: McpMode;
  extraArguments?: Record<string, unknown>;
  signal?: AbortSignal;
  maxRetries?: number;
  fetch?: ReturnType<typeof createPinnedPolicyFetch>;
}): Promise<PolicySearch> {
  assertAllowlisted("searchPolicies");
  const exchanges: ProtocolExchange[] = [];
  const client = await createMCPClient({
    name: "mcp-transport-experiment",
    maxRetries: options.maxRetries ?? 0,
    transport: {
      type: "http",
      url: POLICY_MCP_URL,
      redirect: "error",
      fetch:
        options.fetch ??
        createPinnedPolicyFetch({
          binding: options.binding,
          userId: options.userId,
          mode: options.mode,
          exchanges,
        }),
    },
  });

  try {
    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    if (!toolNames.includes("searchPolicies")) {
      throw new Error("searchPolicies was not discovered");
    }
    const result = await client.callTool({
      name: "searchPolicies",
      arguments: { query: options.query, ...options.extraArguments },
      options: options.signal ? { signal: options.signal } : undefined,
    });
    return { toolNames, result, exchanges };
  } finally {
    await client.close();
  }
}

export async function discoverTools(options: {
  binding: PolicyBinding;
  userId: string;
}): Promise<{
  toolNames: string[];
  inputSchemas: Record<string, { properties?: Record<string, unknown> }>;
  exchanges: ProtocolExchange[];
}> {
  const exchanges: ProtocolExchange[] = [];
  const client = await createMCPClient({
    name: "mcp-transport-experiment",
    maxRetries: 0,
    transport: {
      type: "http",
      url: POLICY_MCP_URL,
      redirect: "error",
      fetch: createPinnedPolicyFetch({
        binding: options.binding,
        userId: options.userId,
        exchanges,
      }),
    },
  });
  try {
    const listed = await client.listTools();
    return {
      toolNames: listed.tools.map((tool) => tool.name),
      inputSchemas: Object.fromEntries(
        listed.tools.map((tool) => [tool.name, tool.inputSchema]),
      ),
      exchanges,
    };
  } finally {
    await client.close();
  }
}

export function refuseUnlistedTool(name: string): void {
  assertAllowlisted(name);
}
