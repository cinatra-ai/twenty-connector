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
  let parsed: SseEnvelope;
  if (contentType.includes("text/event-stream")) {
    parsed = response.body
      ? await readSseEnvelope(response.body, jsonRpc.id)
      : parseSseEnvelope(await response.text(), jsonRpc.id);
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

type SseEnvelope = {
  result?: ToolsCallResult;
  error?: { code: number; message: string; data?: unknown };
};

/**
 * Read the JSON-RPC response for request `requestId` from an SSE body.
 *
 * Twenty can send notifications (for example `notifications/progress`) as
 * events before the response event. A notification carries a `method` or no
 * `id`; it is skipped. The frame returned is the one whose `id` equals the
 * request's id and that carries `result` or `error`. When no such frame
 * exists, the envelope carries neither, and the caller throws
 * "upstream returned no result". An event whose data is not JSON throws the
 * parse error.
 */
export function parseSseEnvelope(text: string, requestId: string | number): SseEnvelope {
  const reader = sseEnvelopeReader(requestId);
  return reader.push(text) ?? reader.end();
}

/**
 * Read the JSON-RPC response for request `requestId` from an SSE body stream,
 * as parseSseEnvelope does, event by event as the body arrives. The stream is
 * cancelled once the answer is read or the reading throws, so a server that
 * keeps the stream open after its answer does not hold the call.
 */
async function readSseEnvelope(
  body: ReadableStream<Uint8Array>,
  requestId: string | number,
): Promise<SseEnvelope> {
  const stream = body.getReader();
  const decoder = new TextDecoder();
  const reader = sseEnvelopeReader(requestId);
  let ended = false;
  try {
    for (;;) {
      const { done, value } = await stream.read();
      if (done) {
        ended = true;
        return reader.push(decoder.decode()) ?? reader.end();
      }
      const envelope = reader.push(decoder.decode(value, { stream: true }));
      if (envelope) return envelope;
    }
  } finally {
    if (!ended) void stream.cancel().catch(() => {});
  }
}

/**
 * Read event-stream text by the event-stream rules (HTML Living Standard,
 * "Interpreting an event stream") and select the response frame from the data
 * of its events. Text is given in pieces with `push`, cut anywhere; `push`
 * returns the envelope once the response frame is read, and no later event is
 * parsed. `end` reads what is left when the text ends: a last line or event
 * without its line end still counts. It throws when no event carried data.
 *
 * A line ends at CRLF, LF or CR. A line that starts with ":" is a comment. The
 * field name is the text before the first colon, or the whole line when it has
 * no colon (the value is then empty); one space after the colon is removed from
 * the value and nothing else is trimmed. Each `data` field adds its value and
 * a line feed to the event's data; other fields are ignored. A blank line ends
 * the event: when a data field was seen, the last line feed is removed and the
 * data is parsed as JSON, which throws for data that is not JSON.
 */
function sseEnvelopeReader(requestId: string | number): {
  push(text: string): SseEnvelope | undefined;
  end(): SseEnvelope;
} {
  let line = "";
  let afterCr = false;
  let data = "";
  let sawData = false;
  let envelope: SseEnvelope | undefined;

  function dispatch(): void {
    if (data === "") return;
    const json = data.slice(0, -1);
    data = "";
    sawData = true;
    const frame: unknown = JSON.parse(json);
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) return;
    const f = frame as {
      id?: unknown;
      method?: unknown;
      result?: ToolsCallResult;
      error?: { code: number; message: string; data?: unknown };
    };
    if (f.method !== undefined || f.id === undefined || f.id === null) return;
    if (f.id !== requestId) return;
    if (f.result === undefined && f.error === undefined) return;
    envelope = f.error !== undefined ? { error: f.error } : { result: f.result };
  }

  function readLine(text: string): void {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data += `${value}\n`;
  }

  return {
    push(text) {
      let start = 0;
      if (afterCr && text !== "") {
        if (text[0] === "\n") start = 1;
        afterCr = false;
      }
      const lineEnd = /[\r\n]/g;
      while (envelope === undefined) {
        lineEnd.lastIndex = start;
        const at = lineEnd.exec(text)?.index ?? -1;
        if (at === -1) {
          line += text.slice(start);
          break;
        }
        const complete = line + text.slice(start, at);
        line = "";
        start = at + 1;
        if (text[at] === "\r") {
          if (start === text.length) afterCr = true;
          else if (text[start] === "\n") start += 1;
        }
        readLine(complete);
      }
      return envelope;
    },
    end() {
      if (envelope === undefined && line !== "") {
        readLine(line);
        line = "";
      }
      if (envelope === undefined) dispatch();
      if (envelope !== undefined) return envelope;
      if (!sawData) {
        throw new TwentyMcpError(-32603, "no SSE data line in upstream response");
      }
      return {};
    },
  };
}
