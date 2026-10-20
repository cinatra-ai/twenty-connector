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
import { twentyRestBaseOf } from "./dev-setup";
import { readEntries, readToolOutput as readContractToolOutput } from "./twenty-tool-contract.mjs";

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
 * Whose decision a call's bearer is minted under. "worker": the host's worker
 * gate, today's call `resolveBearer(row)` byte for byte. "person": the list
 * methods (cinatra#3562, R66): `resolveBearer(row, { forPerson: true })`, which
 * the host decides for the person running the step, on the connection as
 * shared with them, and refuses by name. An older host ignores the second
 * argument, so the call then takes the worker gate.
 */
export type TwentyCallMode = "worker" | "person";

/** The live, enabled Twenty row, or a TwentyConfigError. */
function liveTwentyRow(): ExternalMcpServerRecordShape {
  const row = getTwentyRow();
  if (!row) {
    throw new TwentyConfigError(
      "Twenty workspace row not configured — run the dev-auto-setup hook or call `setup-page` to register one.",
    );
  }
  if (!row.enabled) {
    throw new TwentyConfigError(`Twenty workspace row ${row.id} is disabled.`);
  }
  return row;
}

/** The bearer of one call under its mode. The host's refusals pass through unchanged (no catch). */
async function bearerFor(row: ExternalMcpServerRecordShape, mode: TwentyCallMode): Promise<string | null> {
  return mode === "person"
    ? getTwentyDeps().resolveBearer(row, { forPerson: true })
    : getTwentyDeps().resolveBearer(row);
}

/**
 * Call `tools/call name=execute_tool` against the live Twenty MCP server.
 *
 * Returns the JSON-RPC `result`. Twenty catalog tools return a single
 * `{ type: "text", text: <JSON string> }` entry — callers read it with
 * `readToolOutput`, which also throws on a `{ success: false }` answer.
 *
 * Throws TwentyConfigError when no Twenty row is configured / enabled.
 * Throws TwentyMcpError on upstream JSON-RPC errors.
 */
export async function executeTwentyMcpTool(
  toolName: string,
  toolArguments: Record<string, unknown>,
  mode: TwentyCallMode = "worker",
): Promise<ToolsCallResult> {
  const row = liveTwentyRow();

  const bearer = await bearerFor(row, mode);
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
    // The content items are read through the contract's one check (their
    // projections): an item that is not an object throws a TwentyMcpError,
    // never a TypeError.
    const content = readEntries<{ type: string; text?: string | null }>(
      toolName,
      parsed.result.content ?? [],
      "content item",
      twentyMcpError,
    );
    const firstText = content.find((c) => c.type === "text");
    throw new TwentyMcpError(
      -32000,
      `Twenty tool error: ${typeof firstText?.text === "string" ? firstText.text : "(no message)"}`,
    );
  }
  return parsed.result;
}

/**
 * GET one path of the Twenty REST API of the live row (cinatra#3562 S12a: the
 * metadata views list, which has no ceiling). The row and its bearer are taken
 * exactly as `executeTwentyMcpTool` takes them. The REST base is the row's MCP
 * address without its one trailing `/mcp`, under the connector's own address
 * rule (twentyRestBaseOf); a row whose address does not end in `/mcp`, or that
 * the rule refuses, throws `views-rest-base-unknown`. A fetch failure, a non-2xx
 * status or a body that is not JSON throws `views-rest-failed`; it is never read
 * as empty. Returns the HTTP status and the parsed JSON body, so a caller that
 * refuses the body's shape can name the status.
 */
export async function getTwentyRest(
  path: string,
  mode: TwentyCallMode = "worker",
): Promise<{ status: number; body: unknown }> {
  const row = liveTwentyRow();
  let base: string;
  try {
    const trimmed = String(row.serverUrl ?? "").trim().replace(/\/+$/, "");
    if (!/\/mcp$/i.test(trimmed)) throw new Error("no trailing /mcp");
    base = twentyRestBaseOf(row.serverUrl);
  } catch {
    throw new TwentyMcpError(
      -32603,
      `twenty-connector: views-rest-base-unknown: the REST base of Twenty row ${row.id} cannot be derived from its MCP address`,
    );
  }
  const bearer = await bearerFor(row, mode);
  const headers: Record<string, string> = { accept: "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method: "GET", headers });
  } catch (err) {
    throw new TwentyMcpError(
      -32603,
      `twenty-connector: views-rest-failed: the request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    throw new TwentyMcpError(-32603, `twenty-connector: views-rest-failed: upstream HTTP ${response.status}`);
  }
  try {
    return { status: response.status, body: JSON.parse(await response.text()) };
  } catch {
    throw new TwentyMcpError(-32603, `twenty-connector: views-rest-failed: the answer (HTTP ${response.status}) is not JSON`);
  }
}

/**
 * Read one `execute_tool` result as the tool's parsed answer. Twenty reports a
 * failed tool as ordinary content (`{ success: false, message, error }`), never
 * as an MCP error, so this is the one place that turns every failure into a
 * thrown TwentyMcpError: the MCP error flag, a missing or unparsable text entry,
 * and a `success: false` answer. The answer it returns is the projection the
 * contract's readAnswer gives for the tool; callers read it with the readers of
 * src/twenty-tool-contract.mjs.
 */
export function readToolOutput(toolName: string, result: ToolsCallResult): unknown {
  return readContractToolOutput(toolName, result, twentyMcpError);
}

/** The error factory the contract readers throw through. */
export function twentyMcpError(code: number, message: string, data?: unknown): TwentyMcpError {
  return new TwentyMcpError(code, message, data);
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
