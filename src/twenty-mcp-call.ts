import "server-only";

// Server-side helper for issuing a single MCP `execute_tool` call against the
// live Twenty MCP server (`/mcp`), resolving the workspace-scope row +
// upstream bearer from the external MCP registry READ surface on the
// host-bound deps slot (cinatra#172 Stage H4 — bound at serverEntry
// activation by `register(ctx)` adapting
// `@cinatra-ai/host:external-mcp-registry`; `@/lib/external-mcp-registry`
// stays host-side).
//
// Note: this helper bypasses the host-side Layer B proxy at
// /api/external-mcp/proxy/[serverId]. That proxy is the LLM-facing
// enforcement point — server-side code is trusted and can hit the upstream
// directly. The proxy validates `toolName` against `allowed_catalog_tools`;
// server-side callers are responsible for using the right tool names. The
// minted bearer is in-process only and never crosses any wire boundary other
// than the upstream Twenty call below (see the deps-slot TRUST note).
//
// All Twenty `execute_tool` calls take this shape:
//   { jsonrpc: "2.0", id, method: "tools/call",
//     params: { name: "execute_tool", arguments: { toolName, arguments } } }
//
// Twenty returns either application/json or text/event-stream per the
// Streamable HTTP MCP spec.

import { randomUUID } from "node:crypto";

import { getTwentyDeps, type ExternalMcpServerRecordShape } from "./deps";

export const TWENTY_WORKSPACE_ROW_ID = "twenty-workspace";

/** Resolve the live Twenty workspace row by id, or null if the dev-auto-setup
 *  hook hasn't inserted it yet. */
export function getTwentyRow(): ExternalMcpServerRecordShape | null {
  const byId = getTwentyDeps().getServerById(TWENTY_WORKSPACE_ROW_ID);
  if (byId) return byId;
  // Fallback: if the operator named the row differently, find any enabled
  // workspace-scope row whose label starts with "Twenty" — useful in mixed
  // deployments without being too permissive.
  return (
    getTwentyDeps()
      .listServers()
      .find((r) => r.enabled && r.scope === "workspace" && /twenty/i.test(r.label)) ?? null
  );
}

export class TwentyMcpError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "TwentyMcpError";
    this.code = code;
    this.data = data;
  }
}

export class TwentyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwentyConfigError";
  }
}

type ToolsCallResult = {
  content?: Array<
    | { type: "text"; text: string }
    | { type: "json"; json: unknown }
    | { type: string; [k: string]: unknown }
  >;
  isError?: boolean;
  structuredContent?: unknown;
};

/**
 * Call `tools/call name=execute_tool` against the live Twenty MCP server.
 *
 * Returns the parsed `content` array from the JSON-RPC `result`. Most Twenty
 * catalog tools return a single `{ type: "text", text: <JSON string> }` entry
 * — callers typically `JSON.parse(content[0].text)` to get the structured
 * payload.
 *
 * Throws TwentyConfigError when no Twenty row is configured / enabled.
 * Throws TwentyMcpError on upstream JSON-RPC errors.
 */
export async function executeTwentyMcpTool(
  toolName: string,
  toolArguments: Record<string, unknown>,
): Promise<ToolsCallResult> {
  const row = getTwentyRow();
  if (!row) {
    throw new TwentyConfigError(
      "Twenty workspace row not configured — run the dev-auto-setup hook or call `setup-page` to register one.",
    );
  }
  if (!row.enabled) {
    throw new TwentyConfigError(`Twenty workspace row ${row.id} is disabled.`);
  }

  const bearer = await getTwentyDeps().resolveBearer(row);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;

  const jsonRpc = {
    jsonrpc: "2.0" as const,
    id: randomUUID(),
    method: "tools/call" as const,
    params: {
      name: "execute_tool",
      arguments: { toolName, arguments: toolArguments },
    },
  };

  let response: Response;
  try {
    response = await fetch(row.serverUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(jsonRpc),
    });
  } catch (err) {
    throw new TwentyMcpError(
      -32603,
      `upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new TwentyMcpError(
      response.status,
      `upstream HTTP ${response.status}`,
      body.slice(0, 500),
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  let parsed: { result?: ToolsCallResult; error?: { code: number; message: string; data?: unknown } };
  if (contentType.includes("text/event-stream")) {
    parsed = parseSseEnvelope(await response.text());
  } else {
    parsed = JSON.parse(await response.text());
  }

  if (parsed.error) {
    throw new TwentyMcpError(parsed.error.code, parsed.error.message, parsed.error.data);
  }
  if (!parsed.result) {
    throw new TwentyMcpError(-32603, "upstream returned no result");
  }
  if (parsed.result.isError) {
    const firstText =
      parsed.result.content?.find((c) => c.type === "text") as
        | { text: string }
        | undefined;
    throw new TwentyMcpError(
      -32000,
      `Twenty tool error: ${firstText?.text ?? "(no message)"}`,
      parsed.result,
    );
  }
  return parsed.result;
}

/** Extract the first text-content entry's payload as a parsed JSON value. */
export function readJsonContent<T = unknown>(result: ToolsCallResult): T {
  const entry = result.content?.find((c) => c.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  if (!entry) {
    throw new TwentyMcpError(-32603, "tool result has no text content");
  }
  try {
    return JSON.parse(entry.text) as T;
  } catch (err) {
    throw new TwentyMcpError(
      -32603,
      `failed to parse tool result as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function parseSseEnvelope(text: string): {
  result?: ToolsCallResult;
  error?: { code: number; message: string; data?: unknown };
} {
  // Twenty's MCP SSE responses send a single `data:` line containing the
  // JSON-RPC envelope. We collect the first data-line and parse it.
  const dataLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  if (dataLines.length === 0) {
    throw new TwentyMcpError(-32603, "no SSE data line in upstream response");
  }
  return JSON.parse(dataLines[0]);
}
