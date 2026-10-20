import "server-only";

// Twenty CRM provider implementation for the provider-agnostic CrmConnector
// facade. Maps cinatra-shape verbs to Twenty's catalog tools via the
// dispatcher `execute_tool` MCP call.
//
// Every argument this file sends and every answer it reads goes through the
// shared tool contract (src/twenty-tool-contract.mjs), which the bootstrap
// proof runs against a live Twenty on every change: find tools take their
// filters at the TOP level beside `limit`/`offset` (at most 100 records a
// call, so long reads page), record answers are `{ success, result }`, view
// and metadata answers are bare, writes answer `result: { id }` only, and a
// `{ success: false }` answer throws (readToolOutput). Every answer is read
// through the contract's one field table, and every reader returns a projection
// holding only the checked fields: a malformed entry throws a TwentyMcpError
// and never reads as an absent list or an empty record, and this file reads no
// field of an answer that no check has covered.
//
// Lists (cinatra#3562): a people list is any person view that Twenty's view
// picker shows (TABLE, KANBAN, CALENDAR), named as Twenty renders it
// (`All {objectLabelPlural}` reads `All People`), and its members are what the
// view's own filter matches (get_view_query_parameters), read twice in full.
// A filter whose meaning depends on the viewer refuses by name. The person
// views are read completely: past get_views' ceiling of 100, from Twenty's
// REST metadata API. A company list keeps the slug rule: a company view that
// carries the filter `inLists CONTAINS <slug>`, whose members are the records
// whose `inLists` array holds the slug, found among the first 100 company
// views (an answer of 100 fails closed). Every list read runs for the person
// running it, on Cinatra's Twenty connection as shared with them (the
// "person" call mode); every other call keeps the host's worker gate.
//
// All upstream calls go through `executeTwentyMcpTool` which resolves the
// live Twenty row from the external MCP registry and attaches the bearer
// server-side.

import type {
  CrmConnector,
  CrmContact,
  CrmAccount,
  CrmList,
  CrmListMembership,
} from "@cinatra-ai/sdk-extensions";

import {
  executeTwentyMcpTool,
  getTwentyRest,
  readToolOutput,
  twentyMcpError,
  TwentyMcpError,
  type TwentyCallMode,
} from "./twenty-mcp-call";
import {
  OBJECTS,
  LIST_FIELD,
  VIEWS_LIMIT,
  companySearchFilter,
  createListFilterArgs,
  createRecordArgs,
  createViewArgs,
  emailFilter,
  findArgs,
  findOneArgs,
  FIELD_METADATA_LIMIT,
  canonicalJson,
  getFieldMetadataArgs,
  getFieldMetadataByIdArgs,
  getObjectMetadataArgs,
  getObjectMetadataByIdArgs,
  getViewFiltersArgs,
  getViewQueryParametersArgs,
  getViewsArgs,
  isListedViewType,
  isSlug,
  memberFindFilter,
  membershipFilter,
  membershipUpdateArgs,
  personSearchFilter,
  readAllPages,
  readArrayAnswer,
  readCreatedEntity,
  readEntries,
  readFindOne,
  readFindPage,
  readListFieldId,
  readListSlug,
  readListSlugs,
  readMemberIds,
  readObjectIds,
  readOneById,
  readViewFilters,
  readViewQuery,
  refusal,
  renderViewName,
  readWrittenId,
  slugify,
  slugsWith,
  slugsWithout,
  updateRecordArgs,
  viewerDependence,
  viewsAtCeiling,
  type FindPage,
  type RecordType,
  type ViewLabels,
} from "./twenty-tool-contract.mjs";

// ---------------------------------------------------------------------------
// The projections the contract readers return (ENTRY_FIELDS: the fields cinatra reads).
// ---------------------------------------------------------------------------

type TwentyName = { firstName?: string | null; lastName?: string | null };
type TwentyEmails = { primaryEmail?: string | null };
type TwentyLinks = { primaryLinkUrl?: string | null };

type TwentyPerson = {
  id: string;
  name?: TwentyName | null;
  emails?: TwentyEmails | null;
  jobTitle?: string | null;
  linkedinLink?: TwentyLinks | null;
  xLink?: TwentyLinks | null;
  companyId?: string | null;
  cinatraObjectId?: string | null;
  apolloPersonId?: string | null;
  enrichmentStatus?: string | null;
  inLists?: string[] | null;
};

type TwentyCompany = {
  id: string;
  name?: string | null;
  domainName?: TwentyLinks | null;
  cinatraObjectId?: string | null;
  apolloOrganizationId?: string | null;
  inLists?: string[] | null;
};

type TwentyView = {
  id: string;
  name: string;
  type: string;
  objectMetadataId: string;
};

type TwentyCreatedView = {
  id: string;
  name: string;
};

// ---------------------------------------------------------------------------
// Map: cinatra-shape <-> Twenty
// ---------------------------------------------------------------------------

function combineName(name: TwentyName | null | undefined): string {
  if (!name) return "";
  return [name.firstName, name.lastName].filter(Boolean).join(" ").trim();
}

function mapPersonToContact(p: TwentyPerson): CrmContact {
  return {
    id: p.id,
    cinatraObjectId: p.cinatraObjectId ?? undefined,
    name: combineName(p.name) || "",
    email: p.emails?.primaryEmail ?? null,
    title: p.jobTitle ?? null,
    accountId: p.companyId ?? null,
    inLists: p.inLists ?? [],
    apolloPersonId: p.apolloPersonId ?? null,
    enrichmentStatus: p.enrichmentStatus ?? null,
    linkedinUrl: p.linkedinLink?.primaryLinkUrl ?? null,
    twitterHandle: p.xLink?.primaryLinkUrl ?? null,
  };
}

function mapCompanyToAccount(c: TwentyCompany): CrmAccount {
  return {
    id: c.id,
    cinatraObjectId: c.cinatraObjectId ?? undefined,
    name: c.name ?? "",
    domainName: c.domainName?.primaryLinkUrl ?? null,
    inLists: c.inLists ?? [],
    apolloOrganizationId: c.apolloOrganizationId ?? null,
  };
}

/** The contact a successful write stands for when its re-read is not available. */
function contactFromWrite(id: string, input: Partial<CrmContact>): CrmContact {
  return {
    id,
    cinatraObjectId: input.cinatraObjectId ?? undefined,
    name: input.name ?? "",
    email: input.email ?? null,
    title: input.title ?? null,
    accountId: input.accountId ?? null,
    inLists: input.inLists ?? [],
    apolloPersonId: input.apolloPersonId ?? null,
    enrichmentStatus: input.enrichmentStatus ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    twitterHandle: input.twitterHandle ?? null,
  };
}

/** The account a successful write stands for when its re-read is not available. */
function accountFromWrite(id: string, input: Partial<CrmAccount>): CrmAccount {
  return {
    id,
    cinatraObjectId: input.cinatraObjectId ?? undefined,
    name: input.name ?? "",
    domainName: input.domainName ?? null,
    inLists: input.inLists ?? [],
    apolloOrganizationId: input.apolloOrganizationId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Calls (every one through the shared contract)
// ---------------------------------------------------------------------------

// `mode` is the call's bearer decision (./twenty-mcp-call TwentyCallMode): the
// six list methods pass "person"; every other caller keeps the "worker" default,
// whose transport call is today's two-argument call byte for byte.
async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  mode: TwentyCallMode = "worker",
): Promise<unknown> {
  const result =
    mode === "person" ? await executeTwentyMcpTool(toolName, args, "person") : await executeTwentyMcpTool(toolName, args);
  return readToolOutput(toolName, result);
}

async function findPage<R>(
  objectType: RecordType,
  filter: Record<string, unknown>,
  page: { limit: number; offset: number },
  mode: TwentyCallMode = "worker",
): Promise<FindPage<R>> {
  const tool = OBJECTS[objectType].find;
  return readFindPage<R>(tool, await callTool(tool, findArgs(filter, page), mode), twentyMcpError);
}

async function findAll<R>(
  objectType: RecordType,
  filter: Record<string, unknown>,
  want?: number,
  mode: TwentyCallMode = "worker",
): Promise<R[]> {
  return readAllPages<R>((page) => findPage<R>(objectType, filter, page, mode), {
    want: want ?? Number.POSITIVE_INFINITY,
    toolName: OBJECTS[objectType].find,
    makeError: twentyMcpError,
  });
}

/** One record by id: null when the answer holds zero records (Twenty answers an
 *  unknown id so); every failed answer throws, whatever its message says. */
async function findOne<R>(objectType: RecordType, id: string, mode: TwentyCallMode = "worker"): Promise<R | null> {
  const tool = OBJECTS[objectType].findOne;
  return readFindOne<R>(tool, await callTool(tool, findOneArgs(id), mode), twentyMcpError);
}

async function writeRecord(
  toolName: string,
  args: Record<string, unknown>,
  mode: TwentyCallMode = "worker",
): Promise<string> {
  return readWrittenId(toolName, await callTool(toolName, args, mode), twentyMcpError);
}

/** The record after a successful write: re-read by id. A write that succeeded is
 *  never reported as failed: when the re-read fails, the written values stand. */
async function reRead<R>(objectType: RecordType, id: string): Promise<R | null> {
  try {
    return await findOne<R>(objectType, id);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Connector implementation
// ---------------------------------------------------------------------------

export const twentyConnector: CrmConnector = {
  providerId: "twenty",

  // ----- Contacts (Twenty: Person) -----

  async searchContacts({ query, limit }): Promise<CrmContact[]> {
    const people = await findAll<TwentyPerson>("contact", personSearchFilter(query), limit ?? 25);
    return people.map(mapPersonToContact);
  },

  async getContact({ id }): Promise<CrmContact | null> {
    const person = await findOne<TwentyPerson>("contact", id);
    return person ? mapPersonToContact(person) : null;
  },

  async createContact(input): Promise<CrmContact> {
    const id = await writeRecord(OBJECTS.contact.create, createRecordArgs("contact", input));
    const person = await reRead<TwentyPerson>("contact", id);
    return person ? mapPersonToContact(person) : contactFromWrite(id, input);
  },

  async updateContact({ id, patch }): Promise<CrmContact> {
    const args = updateRecordArgs("contact", id, patch);
    if (args) await writeRecord(OBJECTS.contact.update, args);
    const person = await reRead<TwentyPerson>("contact", id);
    return person ? mapPersonToContact(person) : contactFromWrite(id, patch);
  },

  async findContactByEmail({ email }): Promise<CrmContact | null> {
    const { records } = await findPage<TwentyPerson>("contact", emailFilter(email), { limit: 1, offset: 0 });
    const first = records[0];
    return first ? mapPersonToContact(first) : null;
  },

  // ----- Accounts (Twenty: Company) -----

  async searchAccounts({ query, limit }): Promise<CrmAccount[]> {
    const companies = await findAll<TwentyCompany>("account", companySearchFilter(query), limit ?? 25);
    return companies.map(mapCompanyToAccount);
  },

  async getAccount({ id }): Promise<CrmAccount | null> {
    const company = await findOne<TwentyCompany>("account", id);
    return company ? mapCompanyToAccount(company) : null;
  },

  async createAccount(input): Promise<CrmAccount> {
    const id = await writeRecord(OBJECTS.account.create, createRecordArgs("account", input));
    const company = await reRead<TwentyCompany>("account", id);
    return company ? mapCompanyToAccount(company) : accountFromWrite(id, input);
  },

  async updateAccount({ id, patch }): Promise<CrmAccount> {
    const args = updateRecordArgs("account", id, patch);
    if (args) await writeRecord(OBJECTS.account.update, args);
    const company = await reRead<TwentyCompany>("account", id);
    return company ? mapCompanyToAccount(company) : accountFromWrite(id, patch);
  },

  // ----- Lists (Twenty: people views by their own filter; company views by slug) -----

  async searchLists({ query, objectType }): Promise<CrmList[]> {
    const lowered = (query ?? "").trim().toLowerCase();
    const types: RecordType[] = objectType ? [objectType] : ["contact", "account"];
    const out: CrmList[] = [];
    for (const type of types) {
      if (type === "contact") {
        out.push(...(await personLists(lowered)));
        continue;
      }
      // Company lists (unchanged): fail closed before reading views — the list field's id comes from the object
      // metadata (listFieldId throws when the metadata names no person and company objects); a type whose
      // `inLists` field is not provisioned has no lists.
      if (!(await listFieldId(type))) continue;
      const views = await readViews(type);
      if (viewsAtCeiling(views)) throw viewsCeilingError(type);
      for (const view of views) {
        if (lowered && !view.name.toLowerCase().includes(lowered)) continue;
        const list = await listOf(view, type);
        if (list) out.push(list);
      }
    }
    return out;
  },

  async getList({ id }): Promise<CrmList | null> {
    const person = await readPersonViews();
    const view = person.find((v) => v.id === id);
    if (view) {
      const labels = await personLabels(person);
      return personListOf(view, labels);
    }
    // Not a person view: the company road, as before.
    const views = await readViews("account");
    const company = views.find((v) => v.id === id);
    if (company) return listOf(company, "account");
    // Not found: when the company answer held the ceiling, the list may be a view get_views left out, so the
    // miss is no answer. The person list is complete (readPersonViews).
    if (viewsAtCeiling(views)) throw viewsCeilingError("account");
    return null;
  },

  async createList(input): Promise<CrmList> {
    const slug = input.slug || slugify(input.name);
    if (!isSlug(slug)) {
      throw new TwentyMcpError(-32602, `cannot derive a list slug from "${input.name}"`);
    }
    const fieldId = await listFieldId(input.objectType);
    if (!fieldId) {
      throw new TwentyMcpError(
        -32603,
        `cannot create a list of ${OBJECTS[input.objectType].nameSingular} records — the "${LIST_FIELD}" field is not provisioned in Twenty`,
      );
    }
    const existing = await this.searchLists({ query: "", objectType: input.objectType });
    if (existing.some((l) => l.slug === slug)) {
      throw new TwentyMcpError(-32602, `a list with slug "${slug}" already exists`);
    }
    // The created view's projection: its id and its checked name (Twenty answers the
    // name it stored; a created view without a string name throws, never returns).
    const view = readCreatedEntity<TwentyCreatedView>(
      "create_view",
      await callTool("create_view", createViewArgs({ name: input.name, objectType: input.objectType }), "person"),
      twentyMcpError,
    );
    readCreatedEntity(
      "create_view_filter",
      await callTool(
        "create_view_filter",
        createListFilterArgs({ viewId: view.id, fieldMetadataId: fieldId, slug }),
        "person",
      ),
      twentyMcpError,
    );
    return { id: view.id, slug, name: view.name, objectType: input.objectType };
  },

  async getListMembers({ listId, limit }): Promise<{
    contactIds: string[];
    accountIds: string[];
  }> {
    const person = await readPersonViews();
    const view = person.find((v) => v.id === listId);
    if (!view) {
      // The company road, unchanged.
      const views = await readViews("account");
      const company = views.find((v) => v.id === listId);
      if (!company) {
        if (viewsAtCeiling(views)) throw viewsCeilingError("account");
        return { contactIds: [], accountIds: [] };
      }
      const list = await listOf(company, "account");
      if (!list) return { contactIds: [], accountIds: [] };
      const records = await findAll<{ id: string }>("account", membershipFilter(list.slug), limit, "person");
      return { contactIds: [], accountIds: records.map((r) => r.id) };
    }
    const labels = await personLabels(person);
    if (!isListedViewType(view.type) || renderViewName(view.name, labels) === null) {
      throw refusal(twentyMcpError, -32603, "view-not-listed", `view ${view.id} is not a people list Twenty's view picker shows`);
    }
    // F1: the filters judged.
    const f1 = await viewFilters(view.id);
    const fieldTypes = new Map<string, string>();
    const dependence = await viewerDependence(f1, async (fieldMetadataId: string) => {
      const known = fieldTypes.get(fieldMetadataId);
      if (known !== undefined) return known;
      const field = readOneById<{ id: string; type: string }>(
        "get_field_metadata",
        await callTool("get_field_metadata", getFieldMetadataByIdArgs(fieldMetadataId), "person"),
        fieldMetadataId,
        twentyMcpError,
      );
      fieldTypes.set(fieldMetadataId, field.type);
      return field.type;
    });
    if (dependence) {
      throw refusal(
        twentyMcpError,
        -32603,
        dependence.key,
        `view ${view.id} ("${view.name}"), filter ${dependence.filterId}: ${dependence.detail}; its members depend on who views it`,
      );
    }
    // Q1: the view's own filter, as Twenty computes it.
    const q1 = readViewQuery(
      await callTool("get_view_query_parameters", getViewQueryParametersArgs(view.id), "person"),
      twentyMcpError,
    );
    if (q1.objectNameSingular !== OBJECTS.contact.nameSingular) {
      throw refusal(twentyMcpError, -32603, "view-object-mismatch", `view ${view.id} is a view of ${q1.objectNameSingular}, not person`);
    }
    if (!isListedViewType(q1.viewType)) {
      throw refusal(twentyMcpError, -32603, "view-type-mismatch", `view ${view.id} is a ${q1.viewType} view`);
    }
    // F2: a filter change still visible now refuses.
    const f2 = await viewFilters(view.id);
    if (canonicalJson(byId(f1)) !== canonicalJson(byId(f2))) {
      throw refusal(twentyMcpError, -32603, "view-changed-during-read", `the filters of view ${view.id} changed during the read`);
    }
    const filter = memberFindFilter(q1.filter, twentyMcpError);
    const ids = await readMemberIds(
      (page: { limit: number; offset: number }) => findPage<{ id: string }>("contact", filter, page, "person"),
      { want: limit ?? Number.POSITIVE_INFINITY, toolName: OBJECTS.contact.find, makeError: twentyMcpError },
    );
    return { contactIds: ids, accountIds: [] };
  },

  async addListMember({ listId, objectId, objectType }: CrmListMembership): Promise<void> {
    const list = await this.getList({ id: listId });
    if (!list) {
      throw new TwentyMcpError(-32602, `list ${listId} not found`);
    }
    if (list.objectType !== objectType) {
      throw new TwentyMcpError(-32602, `list ${listId} holds ${list.objectType} records, not ${objectType} records`);
    }
    if (list.slug === "") throw listWithoutSlugError(listId);
    const record = await findOne<Record<string, unknown>>(objectType, objectId, "person");
    if (!record) {
      throw new TwentyMcpError(-32602, `${objectType} ${objectId} not found`);
    }
    const next = slugsWith(readListSlugs(OBJECTS[objectType].findOne, record, twentyMcpError), list.slug);
    if (!next) return;
    await writeRecord(OBJECTS[objectType].update, membershipUpdateArgs(objectId, next), "person");
  },

  async removeListMember({ listId, objectId, objectType }: CrmListMembership): Promise<void> {
    const list = await this.getList({ id: listId });
    if (!list) return;
    if (list.objectType !== objectType) {
      throw new TwentyMcpError(-32602, `list ${listId} holds ${list.objectType} records, not ${objectType} records`);
    }
    if (list.slug === "") throw listWithoutSlugError(listId);
    const record = await findOne<Record<string, unknown>>(objectType, objectId, "person");
    if (!record) return;
    const next = slugsWithout(readListSlugs(OBJECTS[objectType].findOne, record, twentyMcpError), list.slug);
    if (!next) return;
    await writeRecord(OBJECTS[objectType].update, membershipUpdateArgs(objectId, next), "person");
  },
};

// ---------------------------------------------------------------------------
// List helpers (every call in person mode: the list methods run for the person running them)
// ---------------------------------------------------------------------------

/** The error of a read that needs every view of an object when get_views answered its ceiling. */
function viewsCeilingError(objectType: RecordType): TwentyMcpError {
  return new TwentyMcpError(
    -32603,
    `get_views answered ${VIEWS_LIMIT} ${OBJECTS[objectType].nameSingular} views, the ceiling of Twenty's get_views (it has no offset): ` +
      "views past it cannot be read, so lists cannot be read completely",
  );
}

function listWithoutSlugError(listId: string): TwentyMcpError {
  return refusal(
    twentyMcpError,
    -32602,
    "list-without-slug",
    `list ${listId} is a people view without an inLists tag, so it has no tag to write`,
  ) as TwentyMcpError;
}

function byId<T extends { id: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function readViews(objectType: RecordType): Promise<TwentyView[]> {
  return readArrayAnswer<TwentyView>(
    "get_views",
    await callTool("get_views", getViewsArgs(objectType), "person"),
    twentyMcpError,
  );
}

async function viewFilters(viewId: string) {
  return readViewFilters(await callTool("get_view_filters", getViewFiltersArgs(viewId), "person"), viewId, twentyMcpError);
}

function viewObjectMismatch(detail: string): TwentyMcpError {
  return refusal(twentyMcpError, -32603, "view-object-mismatch", detail) as TwentyMcpError;
}

/** The one distinct objectMetadataId of a views answer, or null for an empty answer; more than one refuses. */
function viewsObjectId(views: TwentyView[]): string | null {
  const ids = [...new Set(views.map((v) => v.objectMetadataId))];
  if (ids.length > 1) throw viewMismatchOf(ids);
  return ids[0] ?? null;
}

function viewMismatchOf(ids: string[]): TwentyMcpError {
  return viewObjectMismatch(`the person views answer names ${ids.length} objects (${ids.join(", ")})`);
}

/**
 * The complete person view list (S12a). get_views answers at most VIEWS_LIMIT views and has no offset; below
 * that the answer is complete and no other call is made. At the ceiling, Twenty's REST metadata API lists every
 * view of the object with no limit; that answer must name the same object and hold every view get_views gave.
 */
async function readPersonViews(): Promise<TwentyView[]> {
  const views = await readViews("contact");
  if (!viewsAtCeiling(views)) return views;
  const objectId = viewsObjectId(views) as string;
  const { status, body } = await getTwentyRest(
    `/rest/metadata/views?objectMetadataId=${encodeURIComponent(objectId)}`,
    "person",
  );
  if (!Array.isArray(body)) {
    throw refusal(
      twentyMcpError,
      -32603,
      "views-rest-failed",
      `the REST views answer (HTTP ${status}) is not a JSON array`,
    );
  }
  const all = readEntries<TwentyView>("get_views", body, "view", twentyMcpError);
  for (const v of all) {
    if (v.objectMetadataId !== objectId) {
      throw viewObjectMismatch(`the REST views answer holds view ${v.id} of object ${v.objectMetadataId}, not ${objectId}`);
    }
  }
  const restIds = new Set(all.map((v) => v.id));
  const missing = views.find((v) => !restIds.has(v.id));
  if (missing) {
    throw refusal(
      twentyMcpError,
      -32603,
      "view-changed-during-read",
      `view ${missing.id} of the get_views answer is not in the REST views answer`,
    );
  }
  return all;
}

/** The person-object rule: the labels of the one object of a person views answer (none for an empty answer). */
async function personLabels(views: TwentyView[]): Promise<ViewLabels | null> {
  const objectId = viewsObjectId(views);
  if (objectId === null) return null;
  const object = readOneById<{ id: string; nameSingular: string; labelSingular: string; labelPlural: string }>(
    "get_object_metadata",
    await callTool("get_object_metadata", getObjectMetadataByIdArgs(objectId), "person"),
    objectId,
    twentyMcpError,
  );
  if (object.nameSingular !== OBJECTS.contact.nameSingular) {
    throw viewObjectMismatch(`the person views name object ${objectId}, which is ${object.nameSingular}, not person`);
  }
  return { labelSingular: object.labelSingular, labelPlural: object.labelPlural };
}

/** The slug of a person view: its `inLists CONTAINS` tag when the field is provisioned (`fieldId`), else "". */
async function personSlugOf(viewId: string, fieldId: string | null): Promise<string> {
  if (!fieldId) return "";
  return readListSlug(await viewFilters(viewId), fieldId, twentyMcpError) ?? "";
}

/** The name a person view is listed under, or null when it is not a listed type or renders no name. */
function personListName(view: TwentyView, labels: ViewLabels | null): string | null {
  if (!isListedViewType(view.type)) return null;
  return renderViewName(view.name, labels);
}

/** The list a person view is, or null when it is not a listed type or renders no name. */
async function personListOf(view: TwentyView, labels: ViewLabels | null): Promise<CrmList | null> {
  const name = personListName(view, labels);
  if (name === null) return null;
  return { id: view.id, slug: await personSlugOf(view.id, await listFieldId("contact")), name, objectType: "contact" };
}

/**
 * Every people list whose rendered name holds `lowered` (all of them for ""), in get_views order (S12): the
 * listed types, then the rendered names, then the query; the slug is read last, only for the views kept, under
 * one read of the list field's id.
 */
async function personLists(lowered: string): Promise<CrmList[]> {
  const views = await readPersonViews();
  const labels = await personLabels(views);
  const kept: { view: TwentyView; name: string }[] = [];
  for (const view of views) {
    const name = personListName(view, labels);
    if (name === null) continue;
    if (lowered && !name.toLowerCase().includes(lowered)) continue;
    kept.push({ view, name });
  }
  if (kept.length === 0) return [];
  const fieldId = await listFieldId("contact");
  const out: CrmList[] = [];
  for (const { view, name } of kept) {
    out.push({ id: view.id, slug: await personSlugOf(view.id, fieldId), name, objectType: "contact" });
  }
  return out;
}

/** The company list a view is, or null when the view carries no `inLists CONTAINS` filter. */
async function listOf(view: TwentyView, objectType: RecordType): Promise<CrmList | null> {
  const fieldId = await listFieldId(objectType);
  if (!fieldId) return null;
  const filters = readArrayAnswer(
    "get_view_filters",
    await callTool("get_view_filters", getViewFiltersArgs(view.id), "person"),
    twentyMcpError,
  );
  const slug = readListSlug(filters, fieldId, twentyMcpError);
  if (!slug) return null;
  return { id: view.id, slug, name: view.name, objectType };
}

// The `inLists` field id of each object, read once per process from
// get_object_metadata and get_field_metadata. A missing field is not cached,
// so a field provisioned later is found on the next call.
const listFieldIds: Partial<Record<RecordType, string>> = {};
let objectIds: { contact: string; account: string } | null = null;

async function listFieldId(objectType: RecordType): Promise<string | null> {
  const cached = listFieldIds[objectType];
  if (cached) return cached;
  if (!objectIds) {
    objectIds = readObjectIds(
      readArrayAnswer(
        "get_object_metadata",
        await callTool("get_object_metadata", getObjectMetadataArgs(), "person"),
        twentyMcpError,
      ),
      twentyMcpError,
    );
    if (!objectIds) {
      throw new TwentyMcpError(-32603, "Twenty object metadata names no person and company objects");
    }
  }
  const fields = readArrayAnswer(
    "get_field_metadata",
    await callTool("get_field_metadata", getFieldMetadataArgs(objectIds[objectType]), "person"),
    twentyMcpError,
  );
  // An answer at Twenty's ceiling may leave the field out: a null id must mean "not provisioned".
  if (fields.length >= FIELD_METADATA_LIMIT) {
    throw refusal(
      twentyMcpError,
      -32603,
      "list-field-at-ceiling",
      `get_field_metadata answered ${fields.length} ${OBJECTS[objectType].nameSingular} fields, its ceiling of ${FIELD_METADATA_LIMIT}`,
    );
  }
  const fieldId = readListFieldId(fields, twentyMcpError);
  if (fieldId) listFieldIds[objectType] = fieldId;
  return fieldId;
}

/** Forget the cached object and field ids (tests). */
export function _resetTwentyListCache(): void {
  objectIds = null;
  delete listFieldIds.contact;
  delete listFieldIds.account;
}
