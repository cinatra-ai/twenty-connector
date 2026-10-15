// The connector's contract with Twenty's MCP tools at the pinned release
// (the bootstrap-proof workflow's TWENTY_TAG): the arguments each call sends
// and the shape in which each answer is read. Dependency-free (Node built-ins
// only, no server-only) so that BOTH the connector (src/twenty-connector.ts,
// through src/twenty-mcp-call.ts) AND the plain-node bootstrap proof
// (scripts/twenty-bootstrap/twenty-bootstrap-proof.mjs) use the very same
// builders and readers: the proof's live run is the test of this module.
//
// Every tool is called through Twenty's `execute_tool`; its answer is the
// tool's return value sent as JSON text (`content[0].text`). The record tools
// (find_*, find_one_*, create_*, update_*) answer
// `{ success, message, result }`; the view and metadata tools (get_views,
// get_view_filters, get_object_metadata, get_field_metadata, create_view,
// create_view_filter, create_field_metadata) answer their value bare (an array
// or an object). A tool
// that fails answers `{ success: false, message, error }` as ordinary content,
// never as an MCP error: readToolOutput turns that into a thrown error.
//
// Every answer is read against ONE field table (ENTRY_FIELDS): each kind of
// entry an answer carries (an MCP content item, a find answer and its page, a
// person, a company and their composite fields, a written id, a view, a view
// filter, an object, a field, a created view, a created view filter and a
// created field) names
// the fields the connector and the proof rely on, each with the type the
// pinned Twenty source gives it. TOOL_ANSWERS names each tool's answer as a
// type over that table. checkEntry checks one entry of a kind and RETURNS A
// PROJECTION that holds only the checked fields (a nested kind projected in
// turn), so no reader hands back an answer object or a field no check has
// covered. Every exported reader is named read* and reads through checkEntry;
// any other shape throws through the caller's error factory, naming the tool,
// the place (with its index) and the kind, so a malformed answer never reads
// as an empty one.
//
// Lists (the membership model, decided on twenty-connector#83): a list is a
// Twenty view of people or companies that carries ONE filter
// `inLists CONTAINS <slug>`; the slug is read back from that filter, never from
// the view's name. A record is a member of the list when its custom array field
// `inLists` holds the slug. A view without such a filter is not a list, so a
// view that already existed in the CRM has no members until records are tagged
// with a list's slug.

/** The find tools' published input schema caps `limit` at 100. */
export const FIND_PAGE_LIMIT = 100;
/** get_views answers at most `limit` views (default 50, at most 100) and has no offset:
 *  an answer that holds VIEWS_LIMIT views may leave views out, and a reader that
 *  needs every view of an object fails closed on it (viewsAtCeiling). */
export const VIEWS_LIMIT = 100;
/** get_field_metadata answers at most `limit` fields (default 100). */
export const FIELD_METADATA_LIMIT = 100;
/** The custom array field that carries a record's list slugs. */
export const LIST_FIELD = "inLists";
/**
 * The custom fields the connector reads and writes (the person and company
 * kinds of ENTRY_FIELDS name them), per record type, with the Twenty field type
 * each is created with. The development setup (src/dev-setup.ts) and the
 * bootstrap proof's step 8 create the missing ones through
 * src/twenty-schema-provision.mjs. The social links are Twenty's standard
 * linkedinLink / xLink fields, never custom ones.
 */
export const CONNECTOR_CUSTOM_FIELDS = Object.freeze([
  Object.freeze({ objectType: "contact", name: "cinatraObjectId", type: "TEXT" }),
  Object.freeze({ objectType: "contact", name: "apolloPersonId", type: "TEXT" }),
  Object.freeze({ objectType: "contact", name: "enrichmentStatus", type: "TEXT" }),
  Object.freeze({ objectType: "contact", name: "inLists", type: "ARRAY" }),
  Object.freeze({ objectType: "account", name: "cinatraObjectId", type: "TEXT" }),
  Object.freeze({ objectType: "account", name: "apolloOrganizationId", type: "TEXT" }),
  Object.freeze({ objectType: "account", name: "inLists", type: "ARRAY" }),
]);
/** The view-filter operand that marks a view as a list (upper case, ViewFilterOperand). */
export const LIST_FILTER_OPERAND = "CONTAINS";
/** The view type a list is created with (upper case, ViewType). */
export const LIST_VIEW_TYPE = "TABLE";
/** A slug: lower-case letters and digits joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The Twenty object and tool names behind each cinatra record type. */
export const OBJECTS = Object.freeze({
  contact: Object.freeze({
    nameSingular: "person",
    find: "find_people",
    findOne: "find_one_person",
    create: "create_person",
    update: "update_person",
  }),
  account: Object.freeze({
    nameSingular: "company",
    find: "find_companies",
    findOne: "find_one_company",
    create: "create_company",
    update: "update_company",
  }),
});

/** The error the readers throw unless the caller passes its own error factory. */
export class TwentyToolContractError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "TwentyToolContractError";
    this.code = code;
    this.data = data;
  }
}

function defaultMakeError(code, message, data) {
  return new TwentyToolContractError(code, message, data);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeShape(value) {
  if (Array.isArray(value)) return "an array";
  if (value === null) return "null";
  if (value === undefined) return "absent";
  if (isPlainObject(value)) return `an object with keys [${Object.keys(value).slice(0, 8).join(", ")}]`;
  return `a ${typeof value}`;
}

/**
 * THE FIELD TABLE: for each kind of entry, the fields the connector and the
 * proof rely on and the type the pinned Twenty source gives each one. A field
 * that is not named here is never read and never returned: every reader
 * returns a projection that holds only these fields.
 *   "id"          a non-empty string            "string"    a string
 *   "string?"     absent, null or a string      "number"    a number
 *   "count"       a non-negative safe integer, or its canonical decimal digits
 *                 (live Twenty sends a find page's count as a string): returned as a number
 *   "strings?"    absent, null or an array of strings (returned as a copy)
 *   "true"        exactly true                  "boolean?"  absent, null or a boolean
 *   "string|any"  any JSON value (the source allows any): a string is kept,
 *                 any other value is returned as null and never read
 *   "@kind", "@kind?", "@kind[]", "@kind[]?"  an entry of that kind (absent or
 *                 null allowed with "?"), or an array of such entries
 */
export const ENTRY_FIELDS = Object.freeze({
  // The MCP CallToolResult and its content items (every item names its type).
  "tool result": Object.freeze({ content: "@content item[]?", isError: "boolean?" }),
  "content item": Object.freeze({ type: "string", text: "string?" }),
  // find_* / find_one_* (record-crud find-records.service.ts:78-86): `{ success, result: { records, count } }`.
  "person answer": Object.freeze({ success: "true", result: "@person page" }),
  "company answer": Object.freeze({ success: "true", result: "@company page" }),
  // `count` is the query's total; a live Twenty 2.7.3 answers it as a string ("3"), so a count is read from a
  // number or its decimal digits (isCount) and projected as a number.
  "person page": Object.freeze({ records: "@person[]", count: "count" }),
  "company page": Object.freeze({ records: "@company[]", count: "count" }),
  // person.workspace-entity.ts:36-40, :52; the custom TEXT fields and the ARRAY field `inLists`
  // (scripts/twenty-bootstrap/twenty-bootstrap-proof.mjs:435-441 provisions them).
  person: Object.freeze({
    id: "id",
    name: "@full name?",
    emails: "@emails?",
    jobTitle: "string?",
    linkedinLink: "@links?",
    xLink: "@links?",
    companyId: "string?",
    cinatraObjectId: "string?",
    apolloPersonId: "string?",
    enrichmentStatus: "string?",
    inLists: "strings?",
  }),
  // company.workspace-entity.ts:35-36 (name TEXT, domainName LINKS).
  company: Object.freeze({
    id: "id",
    name: "string?",
    domainName: "@links?",
    cinatraObjectId: "string?",
    apolloOrganizationId: "string?",
    inLists: "strings?",
  }),
  // The composite fields (FULL_NAME, EMAILS, LINKS): the sub-fields the connector reads.
  "full name": Object.freeze({ firstName: "string?", lastName: "string?" }),
  emails: Object.freeze({ primaryEmail: "string?" }),
  links: Object.freeze({ primaryLinkUrl: "string?" }),
  // create_* / update_* run slim: `{ success, result: { id } }`.
  "written answer": Object.freeze({ success: "true", result: "@written" }),
  written: Object.freeze({ id: "id" }),
  // get_views (view-tools.factory.ts:292-300; view.dto.ts:29-33, both non-null).
  view: Object.freeze({ id: "id", name: "string" }),
  // get_view_filters (view-filter-tools.factory.ts:104-112; view-filter.dto.ts:16-23, non-null);
  // `value` is any JSON value (view-filter-tools.factory.ts:37-44): only a string can be a list slug.
  "view filter": Object.freeze({ id: "id", fieldMetadataId: "id", operand: "string", value: "string|any" }),
  // get_object_metadata (object-metadata-tools.factory.ts:113-122; object-metadata.dto.ts:32-39).
  object: Object.freeze({ id: "id", nameSingular: "string" }),
  // get_field_metadata (field-metadata-tools.factory.ts:171-193, the service's entities; field-metadata.dto.ts:62-80
  // id, type and name non-null, :107-109 isActive optional): the type and the active flag decide whether a custom
  // field the connector needs is present.
  field: Object.freeze({ id: "id", name: "string", type: "string", isActive: "boolean?" }),
  // create_view / create_view_filter answer the created entity bare (view.dto.ts:29-33; view-filter.dto.ts:16-23).
  "created view": Object.freeze({ id: "id", name: "string" }),
  "created view filter": Object.freeze({ id: "id", fieldMetadataId: "id", operand: "string" }),
  // create_field_metadata answers the created field bare (field-metadata-tools.factory.ts:194-231, through
  // from-flat-field-metadata-to-field-metadata-dto.util.ts:34-59: id, name and type always set).
  "created field": Object.freeze({ id: "id", name: "string", type: "string" }),
});

/** Each tool's answer, as a type over ENTRY_FIELDS. */
export const TOOL_ANSWERS = Object.freeze({
  find_people: "@person answer",
  find_one_person: "@person answer",
  find_companies: "@company answer",
  find_one_company: "@company answer",
  create_person: "@written answer",
  update_person: "@written answer",
  create_company: "@written answer",
  update_company: "@written answer",
  get_views: "@view[]",
  get_view_filters: "@view filter[]",
  get_object_metadata: "@object[]",
  get_field_metadata: "@field[]",
  create_view: "@created view",
  create_view_filter: "@created view filter",
  create_field_metadata: "@created field",
});

const FIELD_WANT = {
  id: "a non-empty string",
  string: "a string",
  "string?": "a string",
  number: "a number",
  count: "a non-negative integer or its decimal digits",
  true: "true",
  "boolean?": "a boolean",
  "strings?": "an array of strings",
};

const ABSENT = Symbol("absent");

/** The longest digit string a count may be: fifteen digits stay below Number.MAX_SAFE_INTEGER. */
const COUNT_DIGITS_MAX = 15;

/**
 * A count: a non-negative safe integer, or its canonical decimal digits ("0", or a digit 1-9 followed by
 * digits, at most COUNT_DIGITS_MAX of them). Checked character by character, never by a pattern, so the
 * time is linear in a bounded length whatever Twenty sends.
 */
function isCount(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  if (typeof value !== "string" || value.length === 0 || value.length > COUNT_DIGITS_MAX) return false;
  if (value.length > 1 && value.charCodeAt(0) === 48) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function kindOfType(type) {
  const m = /^@(.+?)(\[\])?(\?)?$/.exec(type);
  if (!m || !Object.prototype.hasOwnProperty.call(ENTRY_FIELDS, m[1])) {
    throw new TwentyToolContractError(-32603, `unknown entry type "${type}"`);
  }
  return { kind: m[1], array: Boolean(m[2]), optional: Boolean(m[3]) };
}

/** The place of a field: the fields of the whole answer are named from its root. */
function placeOf(where, field) {
  return where === "answer" ? field : `${where}.${field}`;
}

/** An array of entries of `kind`, each checked and projected. */
function checkEntries(toolName, entries, kind, where, makeError) {
  if (!Array.isArray(entries)) {
    throw makeError(-32603, `${toolName}: unexpected answer shape (${where} is ${describeShape(entries)}, not an array [${kind}])`);
  }
  return entries.map((entry, i) => checkEntry(toolName, entry, kind, `${where}[${i}]`, makeError));
}

/** One field of an entry: its checked value (a projection for a nested kind), or ABSENT. */
function checkField(toolName, value, type, field, where, kind, makeError) {
  if (type.startsWith("@")) {
    const t = kindOfType(type);
    if (t.optional && (value === undefined || value === null)) return value === null ? null : ABSENT;
    const place = placeOf(where, field);
    return t.array
      ? checkEntries(toolName, value, t.kind, place, makeError)
      : checkEntry(toolName, value, t.kind, place, makeError);
  }
  if (type === "string|any") {
    if (value === undefined) return ABSENT;
    return typeof value === "string" ? value : null;
  }
  const optional = type.endsWith("?");
  if (optional && value === undefined) return ABSENT;
  if (optional && value === null) return null;
  let ok;
  if (type === "id") ok = typeof value === "string" && value.length > 0;
  else if (type === "string" || type === "string?") ok = typeof value === "string";
  else if (type === "number") ok = typeof value === "number" && Number.isFinite(value);
  else if (type === "count") ok = isCount(value);
  else if (type === "true") ok = value === true;
  else if (type === "boolean?") ok = typeof value === "boolean";
  else if (type === "strings?") ok = Array.isArray(value) && value.every((s) => typeof s === "string");
  else throw new TwentyToolContractError(-32603, `unknown entry field type "${type}"`);
  if (!ok) {
    throw makeError(
      -32603,
      `${toolName}: unexpected answer shape (${field} is ${describeShape(value)}, not ${FIELD_WANT[type]}, in ${where} [${kind}])`,
    );
  }
  if (type === "count") return Number(value);
  return Array.isArray(value) ? [...value] : value;
}

/**
 * THE ONE CHECK: one entry of `kind` (a key of ENTRY_FIELDS) at the place
 * `where`. A value that is not a plain object, or a field of another type than
 * the table gives it, throws through `makeError`, naming the tool, the place
 * and the kind. It returns a PROJECTION: a new object holding only the checked
 * fields, never the entry itself.
 */
function checkEntry(toolName, entry, kind, where, makeError) {
  const fields = ENTRY_FIELDS[kind];
  if (!fields) throw new TwentyToolContractError(-32603, `unknown entry kind "${kind}"`);
  if (!isPlainObject(entry)) {
    throw makeError(-32603, `${toolName}: unexpected answer shape (${where} is ${describeShape(entry)}, not an object [${kind}])`);
  }
  const out = {};
  for (const [field, type] of Object.entries(fields)) {
    const value = checkField(toolName, entry[field], type, field, where, kind, makeError);
    if (value !== ABSENT) out[field] = value;
  }
  return out;
}

/** A value of `type` (an "@kind" or "@kind[]" type) at the place `where`, checked and projected. */
function checkType(toolName, value, type, where, makeError) {
  const t = kindOfType(type);
  return t.array
    ? checkEntries(toolName, value, t.kind, where, makeError)
    : checkEntry(toolName, value, t.kind, where, makeError);
}

function answerType(toolName) {
  const type = Object.prototype.hasOwnProperty.call(TOOL_ANSWERS, toolName) ? TOOL_ANSWERS[toolName] : undefined;
  if (!type) throw new TwentyToolContractError(-32603, `${toolName}: no answer is known for this tool`);
  return type;
}

/** The kind of record a find tool answers ("person" or "company"). */
function recordKind(toolName) {
  const kind = { "@person answer": "person", "@company answer": "company" }[TOOL_ANSWERS[toolName]];
  if (!kind) throw new TwentyToolContractError(-32603, `${toolName}: no record answer is known for this tool`);
  return kind;
}

/**
 * The entries of an answer, each checked as one entry of `kind` (a key of
 * ENTRY_FIELDS) and returned as its projection. Not an array, an entry that
 * is not a plain object, or a relied-on field of another type throws through
 * `makeError`, naming the tool, the index and the kind.
 */
export function readEntries(toolName, entries, kind, makeError = defaultMakeError) {
  if (!Object.prototype.hasOwnProperty.call(ENTRY_FIELDS, kind)) {
    throw new TwentyToolContractError(-32603, `unknown entry kind "${kind}"`);
  }
  return checkEntries(toolName, entries, kind, "entries", makeError);
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** One tool's parsed answer, checked as the tool's answer type (TOOL_ANSWERS) and returned as its projection. */
export function readAnswer(toolName, payload, makeError = defaultMakeError) {
  return checkType(toolName, payload, answerType(toolName), "answer", makeError);
}

/**
 * Read one `execute_tool` call result: check it and its content items, parse
 * the first text item as JSON, throw on every failure — an MCP-level error
 * flag, a missing or unparsable text entry, a tool answer `{ success: false }`
 * — and return the answer read by readAnswer (its projection).
 */
export function readToolOutput(toolName, callResult, makeError = defaultMakeError) {
  answerType(toolName);
  const result = checkEntry(toolName, callResult, "tool result", "result", makeError);
  const entry = (result.content ?? []).find((c) => c.type === "text" && typeof c.text === "string");
  if (result.isError) {
    throw makeError(-32000, `Twenty tool error (${toolName}): ${entry?.text ?? "(no message)"}`);
  }
  if (!entry) {
    throw makeError(-32603, `${toolName}: tool result has no text content`);
  }
  let payload;
  try {
    payload = JSON.parse(entry.text);
  } catch (err) {
    throw makeError(
      -32603,
      `${toolName}: failed to parse tool result as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (isPlainObject(payload) && payload.success === false) {
    const why = payload.error ?? payload.message ?? "(no message)";
    throw makeError(-32000, `${toolName} failed: ${typeof why === "string" ? why : JSON.stringify(why)}`);
  }
  return readAnswer(toolName, payload, makeError);
}

/** find_people / find_companies (and find_one_*): the projection of `result`, `{ records, count }` —
 *  both required, every record checked as a person or company. */
export function readFindPage(toolName, payload, makeError = defaultMakeError) {
  recordKind(toolName);
  return readAnswer(toolName, payload, makeError).result;
}

/** find_one_person / find_one_company: the first record's projection, or null when none matched. */
export function readFindOne(toolName, payload, makeError = defaultMakeError) {
  return readFindPage(toolName, payload, makeError).records[0] ?? null;
}

/** create_* / update_*: Twenty runs them slim, so the answer carries `result: { id }` only; the checked id. */
export function readWrittenId(toolName, payload, makeError = defaultMakeError) {
  if (TOOL_ANSWERS[toolName] !== "@written answer") {
    throw new TwentyToolContractError(-32603, `${toolName}: no write answer is known for this tool`);
  }
  return readAnswer(toolName, payload, makeError).result.id;
}

/** get_views / get_view_filters / get_object_metadata / get_field_metadata: a bare array whose
 *  entries are checked as that tool's kind and returned as projections. */
export function readArrayAnswer(toolName, payload, makeError = defaultMakeError) {
  if (!String(TOOL_ANSWERS[toolName] ?? "").endsWith("[]")) {
    throw new TwentyToolContractError(-32603, `${toolName}: no bare-array answer is known for this tool`);
  }
  return readAnswer(toolName, payload, makeError);
}

/** create_view / create_view_filter / create_field_metadata: the bare created object, checked as a created
 *  view (id, name), a created view filter (id, fieldMetadataId, operand) or a created field (id, name, type),
 *  and returned as its projection. */
export function readCreatedEntity(toolName, payload, makeError = defaultMakeError) {
  if (!String(TOOL_ANSWERS[toolName] ?? "").startsWith("@created ")) {
    throw new TwentyToolContractError(-32603, `${toolName}: no created-object answer is known for this tool`);
  }
  return readAnswer(toolName, payload, makeError);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** Escape the LIKE wildcards of a user's search text. */
function likeText(query) {
  return `%${String(query).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Name-or-email search on people (the find tools take their filters at the top level). */
export function personSearchFilter(query) {
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) return {};
  const like = likeText(q);
  return {
    or: [
      { name: { firstName: { ilike: like } } },
      { name: { lastName: { ilike: like } } },
      { emails: { primaryEmail: { ilike: like } } },
    ],
  };
}

/** Name search on companies. */
export function companySearchFilter(query) {
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) return {};
  return { name: { ilike: likeText(q) } };
}

/** Exact primary-email match (the EMAILS filter is nested, never a dotted key). */
export function emailFilter(email) {
  return { emails: { primaryEmail: { eq: email } } };
}

/** A person's name split into Twenty's first and last name at the first space. */
export function splitPersonName(full) {
  const trimmed = String(full ?? "").trim();
  if (!trimmed) return {};
  const idx = trimmed.indexOf(" ");
  if (idx < 0) return { firstName: trimmed };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1).trim() };
}

/** The Twenty fields of a person write, from the connector's contact shape (only the given keys). */
export function contactWriteFields(input) {
  const out = {};
  if (input.name !== undefined) out.name = splitPersonName(input.name);
  if (input.email !== undefined) out.emails = { primaryEmail: input.email ?? "" };
  if (input.title !== undefined) out.jobTitle = input.title ?? "";
  if (input.accountId !== undefined) out.companyId = input.accountId ?? null;
  if (input.inLists !== undefined) out[LIST_FIELD] = input.inLists;
  if (input.apolloPersonId !== undefined) out.apolloPersonId = input.apolloPersonId ?? "";
  if (input.enrichmentStatus !== undefined) out.enrichmentStatus = input.enrichmentStatus ?? "";
  if (input.linkedinUrl !== undefined) out.linkedinLink = { primaryLinkUrl: input.linkedinUrl ?? "" };
  if (input.twitterHandle !== undefined) out.xLink = { primaryLinkUrl: input.twitterHandle ?? "" };
  if (input.cinatraObjectId !== undefined) out.cinatraObjectId = input.cinatraObjectId ?? "";
  return out;
}

/** The Twenty fields of a company write, from the connector's account shape (only the given keys). */
export function accountWriteFields(input) {
  const out = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.domainName !== undefined) out.domainName = { primaryLinkUrl: input.domainName ?? "" };
  if (input.inLists !== undefined) out[LIST_FIELD] = input.inLists;
  if (input.apolloOrganizationId !== undefined) out.apolloOrganizationId = input.apolloOrganizationId ?? "";
  if (input.cinatraObjectId !== undefined) out.cinatraObjectId = input.cinatraObjectId ?? "";
  return out;
}

function writeFields(objectType, input) {
  objectFor(objectType);
  return objectType === "contact" ? contactWriteFields(input ?? {}) : accountWriteFields(input ?? {});
}

/** create_person / create_company: the fields at the TOP level (no `input` wrapper); a name is always sent. */
export function createRecordArgs(objectType, input) {
  const args = writeFields(objectType, input);
  if (!args.name) args.name = objectType === "contact" ? splitPersonName(input?.name ?? "") : input?.name;
  return args;
}

/** update_person / update_company: the id and the patched fields at the TOP level; null when nothing is patched. */
export function updateRecordArgs(objectType, id, patch) {
  const fields = writeFields(objectType, patch);
  return Object.keys(fields).length > 0 ? { id, ...fields } : null;
}

/** The membership write of one record: its id and its whole list of slugs. */
export function membershipUpdateArgs(id, slugs) {
  if (!Array.isArray(slugs) || !slugs.every((s) => typeof s === "string")) {
    throw new TwentyToolContractError(-32602, `the ${LIST_FIELD} of a membership write must be an array of strings`);
  }
  return { id, [LIST_FIELD]: slugs };
}

/** The membership filter of a list: `inLists` holds the slug. For an ARRAY field
 *  Twenty offers `containsIlike` (an element ILIKE the value); a slug carries no
 *  LIKE wildcard, so the match is exact up to case and slugs are lower case. */
export function membershipFilter(slug) {
  assertSlug(slug);
  return { [LIST_FIELD]: { containsIlike: slug } };
}

/** The arguments of one find call: the filters at the TOP level beside limit and offset. */
export function findArgs(filter, { limit = FIND_PAGE_LIMIT, offset = 0 } = {}) {
  const pageLimit = Math.max(1, Math.min(FIND_PAGE_LIMIT, Math.floor(limit)));
  const args = { ...(filter ?? {}), limit: pageLimit };
  if (offset > 0) args.offset = Math.floor(offset);
  return args;
}

export function findOneArgs(id) {
  return { id };
}

export function getViewsArgs(objectType) {
  return { objectNameSingular: objectFor(objectType).nameSingular, limit: VIEWS_LIMIT };
}

export function getObjectMetadataArgs() {
  return { limit: 100 };
}

export function getFieldMetadataArgs(objectMetadataId) {
  return { objectMetadataId, limit: FIELD_METADATA_LIMIT };
}

/** create_field_metadata: one of CONNECTOR_CUSTOM_FIELDS on an object, as Twenty's input schema takes it
 *  (field-metadata-tools.factory.ts:34-74: objectMetadataId, type, name, label; isNullable optional). */
export function createFieldMetadataArgs({ objectMetadataId, name, type }) {
  const spec = CONNECTOR_CUSTOM_FIELDS.find((f) => f.name === name && f.type === type);
  if (!spec) throw new TwentyToolContractError(-32602, `"${name}" (${type}) is not a custom field of the connector`);
  return { objectMetadataId, type, name, label: name, isNullable: true };
}

export function getViewFiltersArgs(viewId) {
  return { viewId };
}

export function createViewArgs({ name, objectType }) {
  return { name, objectNameSingular: objectFor(objectType).nameSingular, type: LIST_VIEW_TYPE };
}

export function createListFilterArgs({ viewId, fieldMetadataId, slug }) {
  assertSlug(slug);
  return { viewId, fieldMetadataId, operand: LIST_FILTER_OPERAND, value: slug };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function objectFor(objectType) {
  const o = OBJECTS[objectType];
  if (!o) throw new TwentyToolContractError(-32602, `unknown record type "${objectType}"`);
  return o;
}

/** The text without its leading and trailing hyphens, trimmed by index: linear on any input, no pattern. */
export function trimHyphens(text) {
  const s = String(text ?? "");
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) === 45) start += 1;
  while (end > start && s.charCodeAt(end - 1) === 45) end -= 1;
  return s.slice(start, end);
}

export function slugify(name) {
  return trimHyphens(String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
}

export function isSlug(value) {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

function assertSlug(slug) {
  if (!isSlug(slug)) {
    throw new TwentyToolContractError(-32602, `"${slug}" is not a list slug (lower-case letters and digits joined by hyphens)`);
  }
}

/** The list slug a view's filters carry (a get_view_filters answer, read by readArrayAnswer): the
 *  value of its `inLists CONTAINS` filter, or null. A filter on the list field whose value is not a
 *  slug is a view of the CRM's own, not a list (a view filter's value is any JSON value). */
export function readListSlug(filters, listFieldMetadataId, makeError = defaultMakeError) {
  const entries = readArrayAnswer("get_view_filters", filters, makeError);
  if (!listFieldMetadataId) return null;
  for (const f of entries) {
    if (f.fieldMetadataId !== listFieldMetadataId) continue;
    if (f.operand.toUpperCase() !== LIST_FILTER_OPERAND) continue;
    if (isSlug(f.value)) return f.value;
  }
  return null;
}

/** The id of the `inLists` field among an object's fields (a get_field_metadata answer, read by
 *  readArrayAnswer), or null when the field is not provisioned. */
export function readListFieldId(fields, makeError = defaultMakeError) {
  const field = readArrayAnswer("get_field_metadata", fields, makeError).find((f) => f.name === LIST_FIELD);
  return field ? field.id : null;
}

/** The person and company object ids among the workspace's objects (a get_object_metadata answer,
 *  read by readArrayAnswer), or null when either is missing. */
export function readObjectIds(objects, makeError = defaultMakeError) {
  const entries = readArrayAnswer("get_object_metadata", objects, makeError);
  const person = entries.find((o) => o.nameSingular === OBJECTS.contact.nameSingular);
  const company = entries.find((o) => o.nameSingular === OBJECTS.account.nameSingular);
  return person && company ? { contact: person.id, account: company.id } : null;
}

/** True when a get_views answer holds the ceiling of VIEWS_LIMIT views, so views may have been left out. */
export function viewsAtCeiling(views) {
  return Array.isArray(views) && views.length >= VIEWS_LIMIT;
}

/** The slugs a membership write changes: an array of strings, or a thrown error (never read as empty). */
function slugList(current) {
  if (!Array.isArray(current) || !current.every((s) => typeof s === "string")) {
    throw new TwentyToolContractError(-32602, `the ${LIST_FIELD} a membership write changes must be an array of strings`);
  }
  return current;
}

/** A record's list slugs (the record of a find tool, checked as that tool's person or company): an
 *  absent or null field reads as none; a record that is not an object, or a field that is present but
 *  not an array of strings, throws, so it is never read as empty and overwritten. A copy is returned. */
export function readListSlugs(toolName, record, makeError = defaultMakeError) {
  const value = checkEntry(toolName, record, recordKind(toolName), "record", makeError)[LIST_FIELD];
  return value === undefined || value === null ? [] : value;
}

/** The slugs after adding one: every other slug is kept; null when it is already there. */
export function slugsWith(current, slug) {
  assertSlug(slug);
  const list = slugList(current);
  return list.includes(slug) ? null : [...list, slug];
}

/** The slugs after removing one: every other slug is kept; null when it was not there. */
export function slugsWithout(current, slug) {
  const list = slugList(current);
  return list.includes(slug) ? list.filter((s) => s !== slug) : null;
}

/**
 * Read every page of a find tool (`toolName`, required): `callPage({ limit, offset })` resolves to
 * one page `{ records, count }`, checked as that tool's page (each record a person or company) and
 * projected. Pages of at most FIND_PAGE_LIMIT records are read until `want` records are in hand, a
 * page comes back short, or the page's `count` is reached. A run of more than `maxPages` pages throws.
 */
export async function readAllPages(
  callPage,
  { want = Infinity, pageSize = FIND_PAGE_LIMIT, maxPages = 1000, toolName, makeError = defaultMakeError } = {},
) {
  const kind = recordKind(toolName);
  const size = Math.max(1, Math.min(FIND_PAGE_LIMIT, Math.floor(pageSize)));
  const out = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page += 1) {
    if (out.length >= want) return out;
    const limit = Math.min(size, want - out.length);
    const { records, count } = checkEntry(toolName, await callPage({ limit, offset }), `${kind} page`, "result", makeError);
    out.push(...records);
    offset += records.length;
    if (records.length < limit) return out;
    if (offset >= count) return out;
  }
  throw new TwentyToolContractError(-32603, `find paging did not end within ${maxPages} pages`);
}
