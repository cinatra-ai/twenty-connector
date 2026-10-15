import { describe, it, expect, vi } from "vitest";

import * as contract from "../../../src/twenty-tool-contract.mjs";
import { mcpToolSender, provisionConnectorFields } from "../../../src/twenty-schema-provision.mjs";

// The provisioning of the connector's custom fields (src/twenty-schema-provision.mjs) against a fake Twenty that
// answers in the pinned release's shapes: execute_tool's JSON text of the tool's value, bare lists for the metadata
// reads, the created field bare, `{ success: false, message, error }` for a failed tool. Every answer is read through
// the tool contract (src/twenty-tool-contract.mjs).

const PERSON = "00000000-0000-4000-8000-0000000000a1";
const COMPANY = "00000000-0000-4000-8000-0000000000b2";
const KEY = "test-workspace-key-not-a-secret";

class Mine extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const mk = (code, message) => new Mine(code, message);

/** The MCP call result that carries a tool's value, as execute_tool sends it. */
function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError: false };
}

/** A fake Twenty: `fields` per object id; `answer(toolName, args)` may replace an answer. */
function fakeTwenty({ existing = [], answer } = {}) {
  const fields = { [PERSON]: [], [COMPANY]: [] };
  for (const [object, name, type, isActive] of existing) {
    fields[object === "person" ? PERSON : COMPANY].push({
      id: `fld-${object}-${name}`, name, type, isActive: isActive ?? true, label: name, isCustom: true,
    });
  }
  const sent = [];
  const send = async (toolName, args) => {
    sent.push({ toolName, args });
    const own = answer?.(toolName, args);
    if (own !== undefined) return result(own);
    if (toolName === "get_object_metadata") {
      return result([
        { id: PERSON, nameSingular: "person", namePlural: "people" },
        { id: COMPANY, nameSingular: "company", namePlural: "companies" },
      ]);
    }
    if (toolName === "get_field_metadata") return result(fields[args.objectMetadataId].map((f) => ({ ...f })));
    if (toolName === "create_field_metadata") {
      const created = { id: `fld-new-${args.name}`, name: args.name, type: args.type, label: args.label, isActive: true, isCustom: true };
      fields[args.objectMetadataId].push(created);
      return result(created);
    }
    return result({ success: false, message: "unknown tool", error: "unknown tool" });
  };
  return { send, sent, fields };
}

const ALL = [
  ["person", "cinatraObjectId", "TEXT"], ["person", "apolloPersonId", "TEXT"], ["person", "enrichmentStatus", "TEXT"],
  ["person", "inLists", "ARRAY"], ["company", "cinatraObjectId", "TEXT"], ["company", "apolloOrganizationId", "TEXT"],
  ["company", "inLists", "ARRAY"],
];
const LABELS = ALL.map(([o, n]) => `${o}.${n}`).sort();

describe("the connector's custom fields, provisioned through Twenty's MCP metadata tools and the tool contract", () => {
  it("a missing field is created: a fresh workspace gets all seven, each with the arguments the contract builds", async () => {
    const twenty = fakeTwenty();
    const out = await provisionConnectorFields({ send: twenty.send, makeError: mk });
    expect(out.created.sort()).toEqual(LABELS);
    expect(out.existing).toEqual([]);
    expect(out.conflicts).toEqual([]);
    const creates = twenty.sent.filter((c) => c.toolName === "create_field_metadata").map((c) => c.args);
    expect(creates).toEqual(
      ALL.map(([o, name, type]) => ({ objectMetadataId: o === "person" ? PERSON : COMPANY, type, name, label: name, isNullable: true })),
    );
    expect(twenty.sent[0]).toEqual({ toolName: "get_object_metadata", args: contract.getObjectMetadataArgs() });
    expect(twenty.sent.filter((c) => c.toolName === "get_field_metadata").map((c) => c.args)).toEqual([
      contract.getFieldMetadataArgs(PERSON), contract.getFieldMetadataArgs(COMPANY),
    ]);
  });

  it("idempotent: a second run against the same workspace finds all seven present and creates nothing", async () => {
    const twenty = fakeTwenty();
    await provisionConnectorFields({ send: twenty.send, makeError: mk });
    const before = twenty.sent.length;
    const again = await provisionConnectorFields({ send: twenty.send, makeError: mk });
    expect(again.created).toEqual([]);
    expect(again.existing.sort()).toEqual(LABELS);
    expect(twenty.sent.slice(before).some((c) => c.toolName === "create_field_metadata")).toBe(false);
  });

  it("only the missing fields are created; a field of another type or an inactive one is a conflict, never changed", async () => {
    const twenty = fakeTwenty({
      existing: [["person", "cinatraObjectId", "TEXT"], ["person", "inLists", "TEXT"], ["company", "inLists", "ARRAY", false]],
    });
    const out = await provisionConnectorFields({ send: twenty.send, makeError: mk });
    expect(out.existing).toEqual(["person.cinatraObjectId"]);
    expect(out.conflicts.sort()).toEqual(["company.inLists", "person.inLists"]);
    expect(out.created.sort()).toEqual(["company.apolloOrganizationId", "company.cinatraObjectId", "person.apolloPersonId",
      "person.enrichmentStatus"]);
    expect(twenty.sent.every((c) => ["get_object_metadata", "get_field_metadata", "create_field_metadata"].includes(c.toolName))).toBe(true);
  });

  it("a malformed metadata answer throws through the contract, naming the tool, the place and the kind, and creates nothing", async () => {
    for (const [tool, bad, place] of [
      ["get_object_metadata", { objects: [] }, "answer is an object"],
      ["get_field_metadata", [{ id: "fld-1", name: "inLists" }], "type is absent"],
      ["get_field_metadata", [{ name: "inLists", type: "ARRAY" }], "id is absent"],
      ["get_field_metadata", [7], "answer[0] is a number"],
      ["create_field_metadata", { id: "fld-2", name: "inLists" }, "type is absent"],
      ["create_field_metadata", [], "answer is an array"],
    ]) {
      const twenty = fakeTwenty({ answer: (t) => (t === tool ? bad : undefined) });
      const err = await provisionConnectorFields({ send: twenty.send, makeError: mk }).then(() => null, (e) => e);
      expect(err, `${tool} ${JSON.stringify(bad)}`).toBeInstanceOf(Mine);
      expect(err.message).toContain(`${tool}: unexpected answer shape (${place}`);
      if (tool !== "create_field_metadata") {
        expect(twenty.sent.some((c) => c.toolName === "create_field_metadata")).toBe(false);
      }
    }
  });

  it("a { success: false } answer throws the tool's own failure (code -32000): a key without the data-model permission reads no workspace", async () => {
    for (const tool of ["get_object_metadata", "get_field_metadata", "create_field_metadata"]) {
      const twenty = fakeTwenty({
        answer: (t) => (t === tool ? { success: false, message: `Tool "${t}" not found`, error: "not found" } : undefined),
      });
      const err = await provisionConnectorFields({ send: twenty.send, makeError: mk }).then(() => null, (e) => e);
      expect(err, tool).toBeInstanceOf(Mine);
      expect(err.code).toBe(-32000);
      expect(err.message).toBe(`${tool} failed: not found`);
    }
  });

  it("a created field that names another field or type throws instead of counting as created", async () => {
    const twenty = fakeTwenty({
      answer: (t, a) => (t === "create_field_metadata" ? { id: "fld-x", name: `${a.name}X`, type: a.type } : undefined),
    });
    await expect(provisionConnectorFields({ send: twenty.send, makeError: mk })).rejects.toThrow(
      /create_field_metadata: the answer names cinatraObjectIdX \(TEXT\), not person\.cinatraObjectId \(TEXT\)/,
    );
  });

  it("a field list at the ceiling of one read throws (fields may be left out), never reads as a missing field", async () => {
    const full = Array.from({ length: contract.FIELD_METADATA_LIMIT }, (_, i) => ({ id: `fld-${i}`, name: `f${i}`, type: "TEXT" }));
    const twenty = fakeTwenty({ answer: (t) => (t === "get_field_metadata" ? full : undefined) });
    await expect(provisionConnectorFields({ send: twenty.send, makeError: mk })).rejects.toThrow(/the ceiling of one read/);
    expect(twenty.sent.some((c) => c.toolName === "create_field_metadata")).toBe(false);
  });

  it("every call result goes through `read` (the proof's recorder) and the module reads only its projection again", async () => {
    const twenty = fakeTwenty();
    const seen = [];
    const read = vi.fn((toolName, args, res) => {
      seen.push(toolName);
      return contract.readToolOutput(toolName, res, mk);
    });
    const out = await provisionConnectorFields({ send: twenty.send, read, makeError: mk });
    expect(out.created).toHaveLength(7);
    expect(seen).toEqual(twenty.sent.map((c) => c.toolName));
    expect(read.mock.calls.every(([t, a], i) => t === twenty.sent[i].toolName && a === twenty.sent[i].args)).toBe(true);
    // A `read` that hands back a raw, unchecked answer is still read by the tool's own reader: it throws.
    const raw = fakeTwenty({ answer: (t) => (t === "get_field_metadata" ? [{ name: "inLists" }] : undefined) });
    await expect(
      provisionConnectorFields({ send: raw.send, read: (t, a, res) => JSON.parse(res.content[0].text), makeError: mk }),
    ).rejects.toThrow(/get_field_metadata: unexpected answer shape \(id is absent/);
  });

  it("the seven fields are the custom fields of the contract's person and company kinds, and the builder refuses any other", () => {
    const standard = { person: ["id", "name", "emails", "jobTitle", "linkedinLink", "xLink", "companyId"], company: ["id", "name", "domainName"] };
    for (const [kind, objectType] of [["person", "contact"], ["company", "account"]]) {
      const custom = Object.keys(contract.ENTRY_FIELDS[kind]).filter((f) => !standard[kind].includes(f)).sort();
      expect(contract.CONNECTOR_CUSTOM_FIELDS.filter((f) => f.objectType === objectType).map((f) => f.name).sort()).toEqual(custom);
    }
    expect(() => contract.createFieldMetadataArgs({ objectMetadataId: PERSON, name: "inLists", type: "TEXT" })).toThrow(
      /is not a custom field of the connector/,
    );
    expect(() => contract.createFieldMetadataArgs({ objectMetadataId: PERSON, name: "jobTitle", type: "TEXT" })).toThrow(
      /is not a custom field of the connector/,
    );
  });
});

describe("mcpToolSender: one execute_tool request per call, the key as the bearer only", () => {
  function fetchAnswering(body, { status = 200, contentType = "application/json" } = {}) {
    return vi.fn(async () => ({ ok: status === 200, status, headers: { get: () => contentType }, text: async () => body }));
  }

  it("posts execute_tool with the key as the bearer and resolves to the JSON-RPC result, JSON or SSE", async () => {
    const res = result([{ id: PERSON, nameSingular: "person" }]);
    for (const [body, contentType] of [
      [JSON.stringify({ jsonrpc: "2.0", id: 1, result: res }), "application/json"],
      [`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: res })}\n\n`, "text/event-stream"],
    ]) {
      const fetchImpl = fetchAnswering(body, { contentType });
      const send = mcpToolSender({ mcpUrl: "http://localhost:3300/mcp", apiKey: KEY, fetchImpl, makeError: mk });
      expect(await send("get_object_metadata", { limit: 100 })).toEqual(res);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("http://localhost:3300/mcp");
      expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
      const rpc = JSON.parse(init.body);
      expect(rpc.method).toBe("tools/call");
      expect(rpc.params).toEqual({ name: "execute_tool", arguments: { toolName: "get_object_metadata", arguments: { limit: 100 } } });
      expect(init.body).not.toContain(KEY);
    }
  });

  it("an HTTP refusal, a JSON-RPC error, an envelope that is no JSON-RPC object or a network failure throws, never with the key", async () => {
    const cases = [
      fetchAnswering("unauthorized", { status: 401 }),
      fetchAnswering(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: `bad ${KEY}` } })),
      fetchAnswering("not json"),
      fetchAnswering("[1]"),
      vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED ${KEY}`);
      }),
    ];
    for (const fetchImpl of cases) {
      const send = mcpToolSender({ mcpUrl: "http://localhost:3300/mcp", apiKey: KEY, fetchImpl, makeError: mk });
      const err = await send("get_object_metadata", { limit: 100 }).then(() => null, (e) => e);
      expect(err).toBeInstanceOf(Mine);
      expect(err.message).toMatch(/^get_object_metadata: /);
      expect(err.message).not.toContain(KEY);
    }
  });

  it("an answer whose body stalls is aborted at the timeout and throws in fixed words, never with the key", async () => {
    // The headers arrive, the body never ends (an event stream left open): only the request's signal ends it.
    const fetchImpl = vi.fn(async (_url, init) => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      text: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error(`aborted ${KEY}`)));
        }),
    }));
    const send = mcpToolSender({ mcpUrl: "http://localhost:3300/mcp", apiKey: KEY, fetchImpl, timeoutMs: 20, makeError: mk });
    const err = await send("get_field_metadata", { limit: 100 }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Mine);
    expect(err.message).toBe("get_field_metadata: the MCP answer could not be read");
    expect(err.message).not.toContain(KEY);
  });
});
