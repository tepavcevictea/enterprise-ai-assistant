export const POLICY_MCP_URL = "https://policy.local/mcp";
export const USER_HEADER = "x-northstar-user";
export const MODE_HEADER = "x-northstar-mcp-mode";

export type McpMode = "ok" | "error" | "timeout";

export type PolicyBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type ProtocolExchange = {
  method: string;
  url: string;
  rpcMethod: string | undefined;
  status: number;
  requestedRedirect: string | undefined;
  sentRedirect: "manual";
};

export class PinnedMcpError extends Error {
  constructor(readonly reason: "unpinned-destination" | "redirect") {
    super(reason);
    this.name = "PinnedMcpError";
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function rpcMethod(body: BodyInit | null | undefined): string | undefined {
  const text =
    typeof body === "string"
      ? body
      : body instanceof Uint8Array
        ? new TextDecoder().decode(body)
        : undefined;
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !("method" in parsed)) {
      return undefined;
    }
    return typeof parsed.method === "string" ? parsed.method : undefined;
  } catch {
    return undefined;
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

export function createPinnedPolicyFetch(options: {
  binding: PolicyBinding;
  userId: string;
  mode?: McpMode;
  exchanges: ProtocolExchange[];
}): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = requestUrl(input);
    if (url !== POLICY_MCP_URL) {
      throw new PinnedMcpError("unpinned-destination");
    }

    const headers = new Headers(init?.headers);
    headers.set("host", "policy.local");
    headers.set(USER_HEADER, options.userId);
    if (options.mode === undefined) headers.delete(MODE_HEADER);
    else headers.set(MODE_HEADER, options.mode);

    const signal = init?.signal ?? undefined;
    const response = await new Promise<Response>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };
      if (signal) {
        if (signal.aborted) {
          finish(() => reject(abortError(signal)));
          return;
        }
        signal.addEventListener(
          "abort",
          () => finish(() => reject(abortError(signal))),
          { once: true },
        );
      }
      options.binding
        .fetch(url, {
          method: init?.method,
          headers,
          body: init?.body,
          signal,
          redirect: "manual",
        })
        .then(
          (next) => finish(() => resolve(next)),
          (error: unknown) =>
            finish(() =>
              reject(error instanceof Error ? error : new Error(String(error))),
            ),
        );
    });

    options.exchanges.push({
      method: init?.method ?? "GET",
      url,
      rpcMethod: rpcMethod(init?.body),
      status: response.status,
      requestedRedirect: init?.redirect,
      sentRedirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      throw new PinnedMcpError("redirect");
    }
    return response;
  };
}
