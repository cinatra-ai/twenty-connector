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
// create_view_filter) answer their value bare (an array or an object). A tool
// that fails answers `{ success: false, message, error }` as ordinary content,
// never as an MCP error: readToolOutput turns that into a thrown error.
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

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/**
 * Read one `execute_tool` call result: parse its first text entry as JSON and
 * throw on every failure — an MCP-level error flag, a missing or unparsable
 * text entry, and a tool answer `{ success: false }`.
 */
export function readToolOutput(toolName, callResult, makeError = defaultMakeError) {
  const content = Array.isArray(callResult?.content) ? callResult.content : [];
  const entry = content.find((c) => c && c.type === "text" && typeof c.text === "string");
  if (callResult?.isError) {
    throw makeError(-32000, `Twenty tool error (${toolName}): ${entry?.text ?? "(no message)"}`, callResult);
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
    throw makeError(-32000, `${toolName} failed: ${typeof why === "string" ? why : JSON.stringify(why)}`, payload);
  }
  return payload;
}

function recordResult(toolName, payload, makeError) {
  if (!isPlainObject(payload) || payload.success !== true || !isPlainObject(payload.result)) {
    throw makeError(
      -32603,
      `${toolName}: unexpected answer shape (${describeShape(payload)}); expected { success: true, result: {...} }`,
    );
  }
  return payload.result;
}

/** find_people / find_companies: `{ success, result: { records, count } }` — both are required, and every
 *  record is a plain object (a record of another shape is never read as one without fields). */
export function readFindPage(toolName, payload, makeError = defaultMakeError) {
  const result = recordResult(toolName, payload, makeError);
  if (!Array.isArray(result.records)) {
    throw makeError(-32603, `${toolName}: unexpected answer shape (result.records is ${describeShape(result.records)})`);
  }
  const odd = result.records.findIndex((r) => !isPlainObject(r));
  if (odd >= 0) {
    throw makeError(
      -32603,
      `${toolName}: unexpected answer shape (result.records[${odd}] is ${describeShape(result.records[odd])}, not an object)`,
    );
  }
  if (typeof result.count !== "number") {
    throw makeError(-32603, `${toolName}: unexpected answer shape (result.count is ${describeShape(result.count)})`);
  }
  return { records: result.records, count: result.count };
}

/** find_one_person / find_one_company: the first of `result.records`, or null when none matched. */
export function readFindOne(toolName, payload, makeError = defaultMakeError) {
  const { records } = readFindPage(toolName, payload, makeError);
  return records[0] ?? null;
}

/** create_* / update_*: Twenty runs them slim, so the answer carries `result: { id }` only. */
export function readWrittenId(toolName, payload, makeError = defaultMakeError) {
  const result = recordResult(toolName, payload, makeError);
  if (typeof result.id !== "string" || result.id.length === 0) {
    throw makeError(-32603, `${toolName}: unexpected answer shape (result.id is ${describeShape(result.id)})`);
  }
  return result.id;
}

/** get_views / get_view_filters / get_object_metadata / get_field_metadata: a bare array. */
export function readArrayAnswer(toolName, payload, makeError = defaultMakeError) {
  if (!Array.isArray(payload)) {
    throw makeError(-32603, `${toolName}: unexpected answer shape (${describeShape(payload)}); expected an array`);
  }
  return payload;
}

/** create_view / create_view_filter: the bare created object, which carries its id. */
export function readCreatedEntity(toolName, payload, makeError = defaultMakeError) {
  if (!isPlainObject(payload) || typeof payload.id !== "string" || payload.id.length === 0) {
    throw makeError(-32603, `${toolName}: unexpected answer shape (${describeShape(payload)}); expected an object with an id`);
  }
  return payload;
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

export function slugify(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isSlug(value) {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

function assertSlug(slug) {
  if (!isSlug(slug)) {
    throw new TwentyToolContractError(-32602, `"${slug}" is not a list slug (lower-case letters and digits joined by hyphens)`);
  }
}

/** The list slug a view's filters carry: the value of its `inLists CONTAINS` filter, or null. */
export function listSlugFromFilters(filters, listFieldMetadataId) {
  if (!Array.isArray(filters) || !listFieldMetadataId) return null;
  for (const f of filters) {
    if (!isPlainObject(f)) continue;
    if (f.fieldMetadataId !== listFieldMetadataId) continue;
    if (String(f.operand ?? "").toUpperCase() !== LIST_FILTER_OPERAND) continue;
    if (isSlug(f.value)) return f.value;
  }
  return null;
}

/** The id of the `inLists` field among an object's fields (get_field_metadata), or null. */
export function listFieldIdFrom(fields) {
  if (!Array.isArray(fields)) return null;
  const field = fields.find((f) => isPlainObject(f) && f.name === LIST_FIELD && typeof f.id === "string");
  return field ? field.id : null;
}

/** The person and company object ids among the workspace's objects (get_object_metadata), or null. */
export function objectIdsFrom(objects) {
  if (!Array.isArray(objects)) return null;
  const find = (name) => objects.find((o) => isPlainObject(o) && o.nameSingular === name && typeof o.id === "string");
  const person = find(OBJECTS.contact.nameSingular);
  const company = find(OBJECTS.account.nameSingular);
  return person && company ? { contact: person.id, account: company.id } : null;
}

/** True when a get_views answer holds the ceiling of VIEWS_LIMIT views, so views may have been left out. */
export function viewsAtCeiling(views) {
  return Array.isArray(views) && views.length >= VIEWS_LIMIT;
}

/** A record's list slugs for display; an absent or null field reads as none. The
 *  membership writes read the field with readListSlugs, which never reads a
 *  field of another shape as empty. */
export function slugsOf(record) {
  const value = isPlainObject(record) ? record[LIST_FIELD] : undefined;
  return Array.isArray(value) ? value.filter((s) => typeof s === "string") : [];
}

/** The slugs a membership write starts from: an absent or null field reads as
 *  none; a field that is present but not an array of strings throws, so it is
 *  never read as empty and overwritten. */
export function readListSlugs(toolName, record, makeError = defaultMakeError) {
  const value = isPlainObject(record) ? record[LIST_FIELD] : undefined;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
    throw makeError(-32603, `${toolName}: unexpected answer shape (${LIST_FIELD} is ${describeShape(value)}, not an array of strings)`);
  }
  return [...value];
}

/** The slugs after adding one: every other slug is kept; null when it is already there. */
export function slugsWith(current, slug) {
  assertSlug(slug);
  const list = Array.isArray(current) ? current : [];
  return list.includes(slug) ? null : [...list, slug];
}

/** The slugs after removing one: every other slug is kept; null when it was not there. */
export function slugsWithout(current, slug) {
  const list = Array.isArray(current) ? current : [];
  return list.includes(slug) ? list.filter((s) => s !== slug) : null;
}

/**
 * Read every page of a find: `callPage({ limit, offset })` resolves to one
 * page `{ records, count }`. Pages of at most FIND_PAGE_LIMIT records are read
 * until `want` records are in hand, a page comes back short, or the answer's
 * `count` is reached. A run of more than `maxPages` pages throws.
 */
export async function readAllPages(callPage, { want = Infinity, pageSize = FIND_PAGE_LIMIT, maxPages = 1000 } = {}) {
  const size = Math.max(1, Math.min(FIND_PAGE_LIMIT, Math.floor(pageSize)));
  const out = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page += 1) {
    if (out.length >= want) return out;
    const limit = Math.min(size, want - out.length);
    const { records, count } = await callPage({ limit, offset });
    out.push(...records);
    offset += records.length;
    if (records.length < limit) return out;
    if (count !== null && count !== undefined && offset >= count) return out;
  }
  throw new TwentyToolContractError(-32603, `find paging did not end within ${maxPages} pages`);
}
