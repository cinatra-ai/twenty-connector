// The idempotent provisioning of the custom fields the Twenty connector reads
// and writes (CONNECTOR_CUSTOM_FIELDS of src/twenty-tool-contract.mjs),
// through Twenty's own MCP metadata tools.
//
// The connector keeps list membership in a person's or company's `inLists`
// array and reads four more custom fields. A workspace that lacks them reads
// every list as empty. The development setup hook (src/dev-setup.ts) and the
// bootstrap proof's step 8 (scripts/twenty-bootstrap/twenty-bootstrap-proof.mjs)
// both create them through this module, so the road the proof runs against a
// live Twenty in CI is the road a development install takes.
//
// EVERY ANSWER IS READ THROUGH THE CONTRACT: each call result goes through the
// contract's readToolOutput (the MCP error flag, a missing or unparsable text
// item and a `{ success: false }` answer throw; the tool's own failure with
// code -32000), and what it returns is read again by the tool's own reader
// (readObjectIds, readArrayAnswer, readCreatedEntity), so this module reads
// only checked fields of a projection and never indexes a raw answer. Every
// argument is built by the contract's builders (getObjectMetadataArgs,
// getFieldMetadataArgs, createFieldMetadataArgs).
//
// Dependency-free (Node built-ins and the global fetch only, no server-only)
// so it loads from BOTH the TypeScript dev-setup hook and the plain-node proof.
//
// SECRET BOUNDARY: the key goes into the Authorization header of the MCP
// request and nowhere else; errors carry fixed words and Twenty's own message.

import {
  CONNECTOR_CUSTOM_FIELDS,
  FIELD_METADATA_LIMIT,
  TwentyToolContractError,
  createFieldMetadataArgs,
  getFieldMetadataArgs,
  getObjectMetadataArgs,
  readArrayAnswer,
  readCreatedEntity,
  readObjectIds,
  readToolOutput,
} from "./twenty-tool-contract.mjs";

function defaultMakeError(code, message, data) {
  return new TwentyToolContractError(code, message, data);
}

/**
 * A `send(toolName, args)` that posts ONE `execute_tool` JSON-RPC request to a
 * Twenty MCP endpoint with the key as the bearer and resolves to the JSON-RPC
 * `result` (the MCP call result), which the caller reads through the contract.
 * Twenty answers JSON or a one-event SSE stream. `timeoutMs` bounds the
 * request and the reading of its answer. A transport failure (the request,
 * the HTTP status, the answer's body, an envelope that is not JSON-RPC, a
 * JSON-RPC error) throws through `makeError` in fixed words, never with the key.
 *
 * @param {{ mcpUrl: string; apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number;
 *           makeError?: (code: number, message: string, data?: unknown) => Error }} opts
 */
export function mcpToolSender({ mcpUrl, apiKey, fetchImpl, timeoutMs = 15000, makeError = defaultMakeError }) {
  return async (toolName, args) => {
    const doFetch = fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let text;
    // The timeout bounds the whole exchange, the answer's body included: a body
    // that stalls (or an event stream left open) is aborted, never awaited forever.
    try {
      try {
        response = await doFetch(mcpUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `schema-${toolName}-${Date.now().toString(36)}`,
            method: "tools/call",
            params: { name: "execute_tool", arguments: { toolName, arguments: args } },
          }),
          signal: controller.signal,
        });
      } catch {
        throw makeError(-32603, `${toolName}: the MCP request failed`);
      }
      if (!response.ok) throw makeError(-32603, `${toolName}: MCP HTTP ${response.status}`);
      try {
        text = await response.text();
      } catch {
        throw makeError(-32603, `${toolName}: the MCP answer could not be read`);
      }
    } finally {
      clearTimeout(timer);
    }
    const contentType = response.headers?.get?.("content-type") ?? "";
    let envelope;
    try {
      if (contentType.includes("text/event-stream")) {
        const data = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        envelope = JSON.parse(data[data.length - 1] ?? "");
      } else {
        envelope = JSON.parse(text);
      }
    } catch {
      throw makeError(-32603, `${toolName}: the MCP answer is not JSON-RPC`);
    }
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw makeError(-32603, `${toolName}: the MCP answer is not JSON-RPC`);
    }
    if (envelope.error !== undefined) {
      const code = typeof envelope.error?.code === "number" ? envelope.error.code : "unknown";
      throw makeError(-32603, `${toolName}: JSON-RPC error ${code}`);
    }
    return envelope.result;
  };
}

/**
 * Create every missing field of CONNECTOR_CUSTOM_FIELDS, idempotently:
 *   1. get_object_metadata: the person and company object ids (readObjectIds);
 *   2. per object, get_field_metadata: its fields (readArrayAnswer); a field of
 *      the same name, the same type and not inactive is present; one of
 *      another type or inactive is a conflict that is reported and never
 *      changed; an answer that holds FIELD_METADATA_LIMIT fields may leave
 *      fields out and throws (fail closed: never read as a missing field);
 *   3. a missing field is created with createFieldMetadataArgs and the answer
 *      is read as a created field (readCreatedEntity) that must carry the same
 *      name and type.
 * Twenty migrates the workspace and recomputes its field maps before it
 * answers, so a created field is writable and filterable on the next call.
 * Every failure throws: a malformed answer through the contract's readers, a
 * `{ success: false }` answer as the tool's own failure (code -32000).
 *
 * `send(toolName, args)` resolves to the raw MCP call result; `read(toolName,
 * args, result)` turns it into the contract's projection (default: the
 * contract's readToolOutput; the bootstrap proof passes its recorder, which
 * records the call first and then reads it the same way).
 *
 * @returns {Promise<{ created: string[]; existing: string[]; conflicts: string[] }>}
 */
export async function provisionConnectorFields({ send, read, makeError = defaultMakeError }) {
  const readResult = read ?? ((toolName, _args, result) => readToolOutput(toolName, result, makeError));
  const call = async (toolName, args) => readResult(toolName, args, await send(toolName, args));
  const out = { created: [], existing: [], conflicts: [] };
  const objectIds = readObjectIds(await call("get_object_metadata", getObjectMetadataArgs()), makeError);
  if (!objectIds) throw makeError(-32603, "get_object_metadata: no person and company objects");
  for (const objectType of ["contact", "account"]) {
    const specs = CONNECTOR_CUSTOM_FIELDS.filter((f) => f.objectType === objectType);
    const objectMetadataId = objectIds[objectType];
    const fieldArgs = getFieldMetadataArgs(objectMetadataId);
    const fields = readArrayAnswer("get_field_metadata", await call("get_field_metadata", fieldArgs), makeError);
    if (fields.length >= FIELD_METADATA_LIMIT) {
      throw makeError(-32603, `get_field_metadata: ${fields.length} fields, the ceiling of one read; fields may be left out`);
    }
    for (const spec of specs) {
      const label = `${objectType === "contact" ? "person" : "company"}.${spec.name}`;
      const field = fields.find((f) => f.name === spec.name);
      if (field && field.type === spec.type && field.isActive !== false) {
        out.existing.push(label);
        continue;
      }
      if (field) {
        out.conflicts.push(label);
        continue;
      }
      const created = readCreatedEntity(
        "create_field_metadata",
        await call("create_field_metadata", createFieldMetadataArgs({ objectMetadataId, name: spec.name, type: spec.type })),
        makeError,
      );
      if (created.name !== spec.name || created.type !== spec.type) {
        throw makeError(-32603, `create_field_metadata: the answer names ${created.name} (${created.type}), not ${label} (${spec.type})`);
      }
      out.created.push(label);
    }
  }
  return out;
}
