// The tool-contract record of the bootstrap proof.
//
// The proof calls every Twenty tool the connector calls, with the arguments the
// shared contract (src/twenty-tool-contract.mjs) builds, and records each call:
// `{ id, tool, args, answer }`. The record is sanitized before it is printed or
// compared — this repository is public, and the proof runs against a
// throw-away workspace whose own records are synthetic, but ids, times, the
// run's namespace and the minted key's name still vary or identify a run:
//   - every UUID becomes "<uuid>", every ISO time "<time>";
//   - the run's fixture namespace becomes "<ns>", the key name "<key-name>";
//   - anything shaped like a JWT becomes "<jwt>".
// THE RECORDER (recordAndRead) records each answer from the contract's own
// projection, never from the raw answer: every VALUE in the record is a value
// the contract's reader checked (readAnswer over the tool's TOOL_ANSWERS type);
// every other key, at the top level, inside `result` and inside each entry, is
// kept as its SHAPE only (its name and the type of its value, written "<array>",
// "<string>", ...), never its value. A find answer keeps only this run's own
// records. A failed tool's `{ success: false }` answer is recorded FIRST (its
// `message` and `error` texts, which the failure reader reads; any other key as
// its shape) and then thrown through the contract's failure reader
// (readToolOutput, code -32000). An answer the reader does not read, or an
// unparsable one, is recorded as its shape only. Long answers are trimmed by the
// proof to the entries the connector reads (the person and company objects, the
// list field, the list's view), read off those projections.
//
// The committed fixtures (scripts/twenty-bootstrap/fixtures/) hold one such
// record. The drift check compares the CONTRACT PROJECTION of each answer — its
// kind, its top-level keys and the kinds at the paths the connector's readers
// read — and the sanitized arguments, so a value that changes between runs
// (a count, a position, a name) is no drift while a changed shape is.

import {
  CONNECTOR_CUSTOM_FIELDS, readAnswer, readEntries, readToolOutput, TOOL_ANSWERS,
} from "../../../src/twenty-tool-contract.mjs";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_TIME_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SHAPE_RE = /^<(null|array|object|string|number|boolean)>$/;

/** The paths each tool's readers read; `[]` marks an array, `[0]` its first entry. */
export const CONTRACT_PATHS = Object.freeze({
  find_people: ["success", "result", "result.records[]", "result.count", "result.records[0].id", "result.records[0].inLists[]"],
  find_companies: ["success", "result", "result.records[]", "result.count", "result.records[0].id", "result.records[0].inLists[]"],
  find_one_person: ["success", "result", "result.records[]", "result.records[0].id", "result.records[0].name", "result.records[0].inLists[]"],
  find_one_company: ["success", "result", "result.records[]", "result.records[0].id", "result.records[0].name", "result.records[0].inLists[]"],
  create_person: ["success", "result", "result.id"],
  create_company: ["success", "result", "result.id"],
  update_person: ["success", "result", "result.id"],
  update_company: ["success", "result", "result.id"],
  get_object_metadata: ["[0].id", "[0].nameSingular", "[0].labelSingular", "[0].labelPlural"],
  get_field_metadata: ["[0].id", "[0].name", "[0].type"],
  get_views: ["[0].id", "[0].name", "[0].type", "[0].objectMetadataId"],
  get_view_filters: [
    "[0].id", "[0].viewId", "[0].fieldMetadataId", "[0].operand", "[0].value", "[0].subFieldName", "[0].positionInViewFilterGroup",
  ],
  get_view_query_parameters: ["objectNameSingular", "filter", "viewType"],
  create_view: ["id", "name"],
  create_view_filter: ["id", "fieldMetadataId", "operand", "value"],
  create_field_metadata: ["id", "name", "type"],
});

/** The paths read for a failed call, whatever the tool. */
export const FAILURE_PATHS = Object.freeze(["success", "message", "error"]);

/** Sanitize a value for a public record (see the header). */
export function sanitize(value, { ns, keyName } = {}) {
  if (typeof value === "string") {
    let s = value.replace(JWT_RE, "<jwt>");
    if (keyName) s = s.split(keyName).join("<key-name>");
    if (ns) s = s.split(ns).join("<ns>");
    return s.replace(UUID_RE, "<uuid>").replace(ISO_TIME_RE, "<time>");
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, { ns, keyName }));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sanitize(value[k], { ns, keyName });
    return out;
  }
  return value;
}

function kindOf(value) {
  if (value === undefined) return "absent";
  if (isShape(value)) return SHAPE_RE.exec(value)[1];
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function step(value, part) {
  if (value === undefined || value === null) return undefined;
  const m = /^([^[\]]*)(\[(\d*)\])?$/.exec(part);
  if (!m) return undefined;
  let v = m[1] === "" ? value : value?.[m[1]];
  if (m[2] && m[3] !== "") v = Array.isArray(v) ? v[Number(m[3])] : undefined;
  return v;
}

/** The kind at one path (`a.b[]` reads `a.b` and expects an array; `a[0].b` steps into the first entry). */
export function kindAt(value, path) {
  const parts = path.split(".");
  let v = value;
  for (const part of parts) v = step(v, part);
  return kindOf(v);
}

/** The contract projection of one recorded answer. */
export function projectAnswer(tool, answer) {
  const failed = answer && typeof answer === "object" && !Array.isArray(answer) && answer.success === false;
  const paths = failed ? FAILURE_PATHS : CONTRACT_PATHS[tool] ?? [];
  const projection = { kind: kindOf(answer) };
  if (answer && typeof answer === "object" && !Array.isArray(answer)) projection.keys = Object.keys(answer).sort();
  projection.paths = Object.fromEntries(paths.map((p) => [p, kindAt(answer, p)]));
  return projection;
}

/** The comparable form of a whole record: per call id, its tool, sanitized args and answer projection. */
export function projectRecord(record) {
  const calls = {};
  for (const c of record?.calls ?? []) {
    calls[c.id] = { tool: c.tool, args: c.args, answer: projectAnswer(c.tool, c.answer) };
  }
  return { twentyTag: record?.twentyTag ?? null, image: record?.image ?? null, calls };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = stable(value[k]);
    return out;
  }
  return value;
}

/** Canonical JSON (sorted keys, two-space indent, trailing newline). */
export function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

/** null when the live record matches the committed one; else one line per difference. */
export function diffRecords(committed, live) {
  const a = projectRecord(committed);
  const b = projectRecord(live);
  const lines = [];
  if (a.twentyTag !== b.twentyTag) lines.push(`twentyTag: committed ${a.twentyTag} live ${b.twentyTag}`);
  if (a.image !== b.image) lines.push(`image: committed ${a.image} live ${b.image}`);
  for (const id of Object.keys(a.calls).sort()) {
    if (!b.calls[id]) {
      lines.push(`${id}: committed, not recorded live`);
      continue;
    }
    const x = canonicalJson(a.calls[id]);
    const y = canonicalJson(b.calls[id]);
    if (x !== y) lines.push(`${id}: committed ${JSON.stringify(stable(a.calls[id]))} live ${JSON.stringify(stable(b.calls[id]))}`);
  }
  for (const id of Object.keys(b.calls).sort()) {
    if (!a.calls[id]) lines.push(`${id}: recorded live, not committed`);
  }
  return lines.length ? lines.join("\n") : null;
}

/**
 * True when a live record holds the create_field_metadata call the committed
 * fixtures pin: the connector's first custom field (CONNECTOR_CUSTOM_FIELDS[0])
 * created, as on a fresh workspace. A workspace that already had that field
 * records no create, or another field's create, so such a record explains its
 * drift and is never written over the fixtures.
 */
export function freshFieldCreateRecorded(record) {
  const [first] = CONNECTOR_CUSTOM_FIELDS;
  return (record?.calls ?? []).some(
    (c) => c.id === "create_field_metadata" && c.args?.name === first.name && c.args?.type === first.type,
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True for a recorded SHAPE: "<array>", "<string>", ... (a kept key whose value is never recorded). */
export function isShape(value) {
  return typeof value === "string" && SHAPE_RE.test(value);
}

/** The SHAPE of a value: the type of the value, never the value ("<array>", "<object>", "<string>", ...). */
export function shapeOf(value) {
  if (isShape(value)) return value;
  if (value === null) return "<null>";
  if (Array.isArray(value)) return "<array>";
  return `<${typeof value === "object" ? "object" : typeof value}>`;
}

/** An answer the contract does not read: its top-level key names (sanitized) and their shapes, never a value. */
export function shapeOnly(answer, san) {
  if (!isPlainObject(answer)) return { shapeOnly: shapeOf(answer).slice(1, -1) };
  const keys = {};
  for (const k of Object.keys(answer).sort()) keys[sanitize(k, san)] = shapeOf(answer[k]).slice(1, -1);
  return { shapeOnly: "object", keys };
}

// The checked projection, with every key of the answer the projection does not
// hold added as its shape: every value comes from the projection; the answer
// gives only key names and value types.
function withShapes(answer, projection, san) {
  if (Array.isArray(projection)) {
    return projection.map((p, i) => withShapes(Array.isArray(answer) ? answer[i] : undefined, p, san));
  }
  if (!isPlainObject(projection)) return projection;
  const out = {};
  for (const k of Object.keys(projection)) out[k] = withShapes(isPlainObject(answer) ? answer[k] : undefined, projection[k], san);
  if (isPlainObject(answer)) {
    for (const k of Object.keys(answer)) {
      if (!Object.prototype.hasOwnProperty.call(projection, k)) out[sanitize(k, san)] = shapeOf(answer[k]);
    }
  }
  return out;
}

// A failed tool's answer: `success: false`, the `message` and `error` texts the
// failure reader reads (any other value of theirs as its shape), every other key
// as its shape.
function failureRecord(answer, san) {
  const out = { success: false };
  for (const k of Object.keys(answer)) {
    if (k === "success") continue;
    const v = answer[k];
    out[sanitize(k, san)] = (k === "message" || k === "error") && typeof v === "string" ? v : shapeOf(v);
  }
  return out;
}

/**
 * What the record keeps of one parsed answer (`undefined`: unparsable): a
 * failure FIRST (before any projection), else the reader's projection with
 * every unchecked key as its shape, a find answer's records narrowed to `own`
 * (the ids this run created), a bare array narrowed by `keep` (which reads the
 * projected entries); an answer the reader does not read is its shape only.
 * Sanitized.
 */
export function recordedAnswer(tool, answer, { own, keep, san } = {}) {
  if (answer === undefined) return { shapeOnly: "unparsable" };
  if (isPlainObject(answer) && answer.success === false) return sanitize(failureRecord(answer, san), san);
  let projection;
  try {
    projection = readAnswer(tool, answer);
  } catch {
    return shapeOnly(answer, san);
  }
  let out = withShapes(answer, projection, san);
  if (keep && Array.isArray(out)) out = keep(out);
  if (/^@(person|company) answer$/.test(TOOL_ANSWERS[tool] ?? "")) {
    out.result.records = out.result.records.filter((r) => Boolean(own && own.has(r.id)));
  }
  return sanitize(out, san);
}

/**
 * One execute_tool call of the proof: when `id` names it, the call is recorded
 * (`{ id, tool, args, answer }`, the answer by recordedAnswer) BEFORE it is
 * read; then the contract's reader (readToolOutput) reads it and throws on
 * every failure (a `{ success: false }` answer with code -32000). Returns the
 * reader's projection.
 */
export function recordAndRead(calls, { id, tool, args, result, own, keep, san }) {
  if (id) {
    let text;
    try {
      const [projected] = readEntries(tool, [result], "tool result");
      text = (projected.content ?? []).find((c) => c.type === "text" && typeof c.text === "string")?.text;
    } catch {
      text = undefined;
    }
    let answer;
    try {
      answer = text === undefined ? undefined : JSON.parse(text);
    } catch {
      answer = undefined;
    }
    calls.push({ id, tool, args: sanitize(args, san), answer: recordedAnswer(tool, answer, { own, keep, san }) });
  }
  return readToolOutput(tool, result);
}
