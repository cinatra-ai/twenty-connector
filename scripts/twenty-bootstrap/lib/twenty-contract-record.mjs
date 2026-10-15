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
// Long answers are trimmed by the proof to the entries the connector reads
// (its own fixture records, the person and company objects, the list field).
//
// The committed fixtures (scripts/twenty-bootstrap/fixtures/) hold one such
// record. The drift check compares the CONTRACT PROJECTION of each answer — its
// kind, its top-level keys and the kinds at the paths the connector's readers
// read — and the sanitized arguments, so a value that changes between runs
// (a count, a position, a name) is no drift while a changed shape is.

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_TIME_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

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
  get_object_metadata: ["[0].id", "[0].nameSingular"],
  get_field_metadata: ["[0].id", "[0].name"],
  get_views: ["[0].id", "[0].name", "[0].objectMetadataId"],
  get_view_filters: ["[0].id", "[0].fieldMetadataId", "[0].operand", "[0].value"],
  create_view: ["id", "name"],
  create_view_filter: ["id", "fieldMetadataId", "operand", "value"],
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
