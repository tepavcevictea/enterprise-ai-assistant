export type ObservedRequest = {
  method: string;
  host: string;
  pathname: string;
  hasAuthorization: boolean;
  model: string | undefined;
  store: boolean | undefined;
  reasoningEffort: string | undefined;
  hasTemperature: boolean;
  hasTopP: boolean;
  toolNames: string[];
  signalAborted: boolean;
};

function toolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tool) => {
    if (typeof tool !== "object" || tool === null || !("name" in tool)) return [];
    return typeof tool.name === "string" ? [tool.name] : [];
  });
}

export function summarizeRequest(
  url: string,
  method: string,
  headers: Headers,
  body: string | undefined,
  initSignal: AbortSignal | undefined,
): ObservedRequest {
  let parsed: unknown;
  if (body !== undefined) {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
  }
  const record =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  const reasoning = record?.reasoning;
  const effort =
    typeof reasoning === "object" &&
    reasoning !== null &&
    "effort" in reasoning &&
    typeof reasoning.effort === "string"
      ? reasoning.effort
      : undefined;
  const target = new URL(url);
  return {
    method,
    host: target.host,
    pathname: target.pathname,
    hasAuthorization: headers.has("authorization"),
    model: typeof record?.model === "string" ? record.model : undefined,
    store: typeof record?.store === "boolean" ? record.store : undefined,
    reasoningEffort: effort,
    hasTemperature: record !== undefined && "temperature" in record,
    hasTopP: record !== undefined && ("top_p" in record || "topP" in record),
    toolNames: toolNames(record?.tools),
    signalAborted: initSignal?.aborted === true,
  };
}

export function observeFetch(
  observed: ObservedRequest[],
  inner: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const headers = new Headers(init?.headers ?? request?.headers);
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : undefined;
    observed.push(
      summarizeRequest(
        url,
        init?.method ?? request?.method ?? "GET",
        headers,
        body,
        init?.signal ?? undefined,
      ),
    );
    return inner(input, init);
  };
}
