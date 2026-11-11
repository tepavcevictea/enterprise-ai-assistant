import { createMCPClient, type CallToolResult } from "@ai-sdk/mcp";
import type { AgentId } from "../capabilities";
import { permits } from "../capabilities";
import type { DemoUser } from "../identity";
import { authorizedCopies, policyRole, renderPolicies, type PolicyDocument } from "../policies";
import type { TraceEvent } from "../trace";
import { traceEvent } from "../trace";
import {
  POLICY_MCP_URL,
  createPinnedPolicyFetch,
  type McpMode,
  type PolicyBinding,
  type ProtocolExchange,
} from "./pinned-fetch";

export const ALLOWED_TOOLS = ["searchPolicies"] as const;

export const UNAVAILABLE_POLICY = "The policy service is unavailable.";

export type PolicyConsultation = {
  outcome: "success" | "denied" | "unavailable";
  documents: PolicyDocument[];
  report: string;
  handoff?: string;
  errorCode?: string;
};

export type PolicySearch = {
  toolNames: string[];
  result: CallToolResult;
  exchanges: ProtocolExchange[];
};

type TraceBase = { sessionId: string; turnId: string; taskId: string };

type OpenedClient = {
  client: Awaited<ReturnType<typeof createMCPClient>>;
  exchanges: ProtocolExchange[];
};

function assertAllowlisted(name: string): void {
  if (!(ALLOWED_TOOLS as readonly string[]).includes(name)) {
    throw new Error(`refusing tool outside the policy allowlist: ${name}`);
  }
}

function deniedReport(): PolicyConsultation {
  return {
    outcome: "denied",
    documents: [],
    report: "The HR specialist is not allowed to retrieve policies.",
    errorCode: "denied",
  };
}

function unavailableReport(errorCode: string): PolicyConsultation {
  return {
    outcome: "unavailable",
    documents: [],
    report: UNAVAILABLE_POLICY,
    errorCode,
  };
}

function successReport(documents: PolicyDocument[]): PolicyConsultation {
  const facts = documents.flatMap((policy) =>
    Object.entries(policy.facts ?? {}).map(([key, value]) => `${key}=${value}`),
  );
  return {
    outcome: "success",
    documents,
    report: renderPolicies(documents),
    handoff: facts.length === 0 ? "none" : facts.join("\n"),
  };
}

export function documentIds(documents: readonly PolicyDocument[]): string {
  return documents.length === 0 ? "none" : documents.map((policy) => policy.id).join(",");
}

export function policyToolText(result: CallToolResult): string {
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

async function openClient(options: {
  binding: PolicyBinding;
  userId: string;
  mode?: McpMode;
  maxRetries?: number;
  fetch?: ReturnType<typeof createPinnedPolicyFetch>;
}): Promise<OpenedClient> {
  const exchanges: ProtocolExchange[] = [];
  const client = await createMCPClient({
    clientName: "tx-services",
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
  return { client, exchanges };
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
  const opened = await openClient(options);
  try {
    const listed = await opened.client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    if (!toolNames.includes("searchPolicies")) {
      throw new Error("searchPolicies was not discovered");
    }
    const result = await opened.client.callTool({
      name: "searchPolicies",
      arguments: { query: options.query, ...options.extraArguments },
      options: options.signal ? { signal: options.signal } : undefined,
    });
    return { toolNames, result, exchanges: opened.exchanges };
  } finally {
    await opened.client.close();
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
  const opened = await openClient(options);
  try {
    const listed = await opened.client.listTools();
    return {
      toolNames: listed.tools.map((tool) => tool.name),
      inputSchemas: Object.fromEntries(listed.tools.map((tool) => [tool.name, tool.inputSchema])),
      exchanges: opened.exchanges,
    };
  } finally {
    await opened.client.close();
  }
}

export function refuseUnlistedTool(name: string): void {
  assertAllowlisted(name);
}

export type PreparedPolicyCall = {
  exchanges: ProtocolExchange[];
  invoke: (query: string, signal?: AbortSignal) => Promise<PolicyConsultation>;
  close: () => Promise<void>;
};

export async function preparePolicyCall(options: {
  binding: PolicyBinding;
  user: DemoUser;
  agent: AgentId;
  mode?: McpMode;
  signal?: AbortSignal;
  trace: (event: TraceEvent) => void;
  base: TraceBase;
}): Promise<{ ok: true; prepared: PreparedPolicyCall } | { ok: false; consultation: PolicyConsultation }> {
  const record = (event: Omit<TraceEvent, "traceId" | "sessionId" | "turnId" | "timestamp">) => {
    options.trace(traceEvent(options.base, { ...event, taskId: options.base.taskId }));
  };
  if (!permits(options.user.id, options.agent, "hr_policy")) {
    record({
      agentId: options.agent,
      eventType: "tool.denied",
      toolId: "searchPolicies",
      authorization: "denied",
      errorCode: "denied",
    });
    return { ok: false, consultation: deniedReport() };
  }

  let opened: OpenedClient;
  try {
    opened = await openClient({
      binding: options.binding,
      userId: options.user.id,
      mode: options.mode,
    });
  } catch {
    record({
      agentId: options.agent,
      eventType: "tool.result",
      toolId: "searchPolicies",
      authorization: "allowed",
      outcome: "unavailable",
      errorCode: "policy_unavailable",
    });
    return { ok: false, consultation: unavailableReport("policy_unavailable") };
  }

  try {
    const listed = await opened.client.listTools({
      options: options.signal ? { signal: options.signal } : undefined,
    });
    const names = listed.tools.map((tool) => tool.name);
    for (const name of names) {
      record({
        agentId: options.agent,
        eventType: "tool.discovered",
        toolId: name,
        authorization: name === "searchPolicies" ? "allowed" : "denied",
      });
    }
    for (const name of names) {
      if (name === "searchPolicies") continue;
      record({
        agentId: options.agent,
        eventType: "tool.denied",
        toolId: name,
        authorization: "denied",
        errorCode: "allowlist",
      });
    }
    if (!names.includes("searchPolicies")) {
      await opened.client.close();
      record({
        agentId: options.agent,
        eventType: "tool.result",
        toolId: "searchPolicies",
        authorization: "allowed",
        outcome: "unavailable",
        errorCode: "policy_unavailable",
      });
      return { ok: false, consultation: unavailableReport("policy_unavailable") };
    }
    record({
      agentId: options.agent,
      eventType: "tool.offered",
      toolId: "searchPolicies",
      authorization: "allowed",
    });
  } catch (error) {
    await opened.client.close();
    const errorCode = errorCodeFor(error);
    record({
      agentId: options.agent,
      eventType: "tool.result",
      toolId: "searchPolicies",
      authorization: "allowed",
      outcome: "unavailable",
      errorCode,
    });
    return { ok: false, consultation: unavailableReport(errorCode) };
  }

  return {
    ok: true,
    prepared: {
      exchanges: opened.exchanges,
      close: () => opened.client.close(),
      invoke: (query, signal) => invokeSearch(opened, options, query, signal, record),
    },
  };
}

async function invokeSearch(
  opened: OpenedClient,
  options: {
    user: DemoUser;
    agent: AgentId;
  },
  query: string,
  signal: AbortSignal | undefined,
  record: (event: Omit<TraceEvent, "traceId" | "sessionId" | "turnId" | "timestamp">) => void,
): Promise<PolicyConsultation> {
  if (!permits(options.user.id, options.agent, "hr_policy")) {
    record({
      agentId: options.agent,
      eventType: "tool.denied",
      toolId: "searchPolicies",
      authorization: "denied",
      errorCode: "denied",
    });
    return deniedReport();
  }
  assertAllowlisted("searchPolicies");
  record({
    agentId: options.agent,
    eventType: "tool.invoked",
    toolId: "searchPolicies",
    authorization: "allowed",
  });
  try {
    const result = await opened.client.callTool({
      name: "searchPolicies",
      arguments: { query },
      options: signal ? { signal } : undefined,
    });
    if (result.isError === true) {
      record({
        agentId: options.agent,
        eventType: "tool.result",
        toolId: "searchPolicies",
        authorization: "allowed",
        outcome: "unavailable",
        errorCode: "policy_failed",
      });
      return unavailableReport("policy_failed");
    }
    const documents = documentsFrom(options.user, policyToolText(result));
    if (documents === undefined) {
      record({
        agentId: options.agent,
        eventType: "tool.result",
        toolId: "searchPolicies",
        authorization: "allowed",
        outcome: "unavailable",
        errorCode: "policy_unavailable",
      });
      return unavailableReport("policy_unavailable");
    }
    const consultation = successReport(documents);
    record({
      agentId: options.agent,
      eventType: "tool.result",
      toolId: "searchPolicies",
      authorization: "allowed",
      outcome: "success",
      result: documentIds(documents),
      sourceIds: documents.map((policy) => policy.id),
    });
    return consultation;
  } catch (error) {
    const errorCode = errorCodeFor(error);
    record({
      agentId: options.agent,
      eventType: "tool.result",
      toolId: "searchPolicies",
      authorization: "allowed",
      outcome: "unavailable",
      errorCode,
    });
    return unavailableReport(errorCode);
  }
}

export async function executePolicyRead(options: {
  binding: PolicyBinding;
  user: DemoUser;
  agent: AgentId;
  query: string;
  mode?: McpMode;
  signal?: AbortSignal;
  trace: (event: TraceEvent) => void;
  base: TraceBase;
}): Promise<PolicyConsultation> {
  const prepared = await preparePolicyCall(options);
  if (!prepared.ok) return prepared.consultation;
  try {
    return await prepared.prepared.invoke(options.query, options.signal);
  } finally {
    await prepared.prepared.close();
  }
}

function documentsFrom(user: DemoUser, text: string): PolicyDocument[] | undefined {
  try {
    return authorizedCopies(policyRole(user.role), JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function errorCodeFor(error: unknown): string {
  if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
    return "policy_timeout";
  }
  return "policy_unavailable";
}

export function configuredMcpMode(value: string | undefined): McpMode | undefined {
  if (value === "error" || value === "timeout") return value;
  return undefined;
}
