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
// `{ success: false }` answer throws (readToolOutput).
//
// Lists: a list is a person or company view that carries the filter
// `inLists CONTAINS <slug>`; its slug is read back from that filter. A record
// is a member when its `inLists` array holds the slug. A view without that
// filter is not a list, so views that already existed in the CRM have no
// members until records are tagged. A list is found among the first 100 views
// of its object (get_views answers at most 100 and has no offset); when an
// answer holds 100 views, a read that needs every view fails closed with an
// error naming that ceiling instead of answering a shorter list.
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

import { executeTwentyMcpTool, readToolOutput, twentyMcpError, TwentyMcpError } from "./twenty-mcp-call";
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
  getFieldMetadataArgs,
  getObjectMetadataArgs,
  getViewFiltersArgs,
  getViewsArgs,
  isSlug,
  listFieldIdFrom,
  listSlugFromFilters,
  membershipFilter,
  membershipUpdateArgs,
  objectIdsFrom,
  personSearchFilter,
  readAllPages,
  readArrayAnswer,
  readCreatedEntity,
  readFindOne,
  readFindPage,
  readListSlugs,
  readWrittenId,
  slugify,
  slugsOf,
  slugsWith,
  slugsWithout,
  updateRecordArgs,
  viewsAtCeiling,
  type FindPage,
  type RecordType,
} from "./twenty-tool-contract.mjs";

// ---------------------------------------------------------------------------
// Twenty raw shapes (subset of fields cinatra reads).
// ---------------------------------------------------------------------------

type TwentyName = { firstName?: string; lastName?: string };
type TwentyEmails = { primaryEmail?: string };
type TwentyLinks = { primaryLinkUrl?: string };

type TwentyPerson = {
  id: string;
  name?: TwentyName;
  emails?: TwentyEmails;
  jobTitle?: string;
  linkedinLink?: TwentyLinks;
  xLink?: TwentyLinks;
  companyId?: string | null;
  cinatraObjectId?: string | null;
  apolloPersonId?: string | null;
  enrichmentStatus?: string | null;
  inLists?: string[] | null;
};

type TwentyCompany = {
  id: string;
  name?: string;
  domainName?: string | { primaryLinkUrl?: string };
  cinatraObjectId?: string | null;
  apolloOrganizationId?: string | null;
  inLists?: string[] | null;
};

type TwentyView = {
  id: string;
  name?: string;
  objectMetadataId?: string;
};

// ---------------------------------------------------------------------------
// Map: cinatra-shape <-> Twenty
// ---------------------------------------------------------------------------

function combineName(name: TwentyName | undefined): string {
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
    inLists: slugsOf(p),
    apolloPersonId: p.apolloPersonId ?? null,
    enrichmentStatus: p.enrichmentStatus ?? null,
    linkedinUrl: p.linkedinLink?.primaryLinkUrl ?? null,
    twitterHandle: p.xLink?.primaryLinkUrl ?? null,
  };
}

function mapCompanyToAccount(c: TwentyCompany): CrmAccount {
  const domain =
    typeof c.domainName === "string"
      ? c.domainName
      : c.domainName?.primaryLinkUrl ?? null;
  return {
    id: c.id,
    cinatraObjectId: c.cinatraObjectId ?? undefined,
    name: c.name ?? "",
    domainName: domain,
    inLists: slugsOf(c),
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

async function callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await executeTwentyMcpTool(toolName, args);
  return readToolOutput(toolName, result);
}

async function findPage<R>(
  objectType: RecordType,
  filter: Record<string, unknown>,
  page: { limit: number; offset: number },
): Promise<FindPage<R>> {
  const tool = OBJECTS[objectType].find;
  return readFindPage<R>(tool, await callTool(tool, findArgs(filter, page)), twentyMcpError);
}

async function findAll<R>(
  objectType: RecordType,
  filter: Record<string, unknown>,
  want?: number,
): Promise<R[]> {
  return readAllPages<R>((page) => findPage<R>(objectType, filter, page), {
    want: want ?? Number.POSITIVE_INFINITY,
  });
}

/** One record by id: null when the answer holds zero records (Twenty answers an
 *  unknown id so); every failed answer throws, whatever its message says. */
async function findOne<R>(objectType: RecordType, id: string): Promise<R | null> {
  const tool = OBJECTS[objectType].findOne;
  return readFindOne<R>(tool, await callTool(tool, findOneArgs(id)), twentyMcpError);
}

async function writeRecord(toolName: string, args: Record<string, unknown>): Promise<string> {
  return readWrittenId(toolName, await callTool(toolName, args), twentyMcpError);
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

  // ----- Lists (Twenty: a view filtered on `inLists CONTAINS <slug>`) -----

  async searchLists({ query, objectType }): Promise<CrmList[]> {
    const lowered = (query ?? "").trim().toLowerCase();
    const types: RecordType[] = objectType ? [objectType] : ["contact", "account"];
    const out: CrmList[] = [];
    for (const type of types) {
      // Fail closed before reading views: the list field's id comes from the object metadata
      // (listFieldId throws when the metadata names no person and company objects); a type whose
      // `inLists` field is not provisioned has no lists.
      if (!(await listFieldId(type))) continue;
      const views = await readViews(type);
      if (viewsAtCeiling(views)) throw viewsCeilingError(type);
      for (const view of views) {
        if (lowered && !(view.name ?? "").toLowerCase().includes(lowered)) continue;
        const list = await listOf(view, type);
        if (list) out.push(list);
      }
    }
    return out;
  },

  async getList({ id }): Promise<CrmList | null> {
    let atCeiling: RecordType | null = null;
    for (const type of ["contact", "account"] as const) {
      const views = await readViews(type);
      const view = views.find((v) => v.id === id);
      if (view) return listOf(view, type);
      if (!atCeiling && viewsAtCeiling(views)) atCeiling = type;
    }
    // Not found: when an object's answer held the ceiling, the list may be a view
    // get_views left out, so the miss is no answer.
    if (atCeiling) throw viewsCeilingError(atCeiling);
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
    const view = readCreatedEntity<TwentyView>(
      "create_view",
      await callTool("create_view", createViewArgs({ name: input.name, objectType: input.objectType })),
      twentyMcpError,
    );
    readCreatedEntity(
      "create_view_filter",
      await callTool("create_view_filter", createListFilterArgs({ viewId: view.id, fieldMetadataId: fieldId, slug })),
      twentyMcpError,
    );
    return { id: view.id, slug, name: view.name ?? input.name, objectType: input.objectType };
  },

  async getListMembers({ listId, limit }): Promise<{
    contactIds: string[];
    accountIds: string[];
  }> {
    const list = await this.getList({ id: listId });
    if (!list) return { contactIds: [], accountIds: [] };
    const records = await findAll<{ id: string }>(list.objectType, membershipFilter(list.slug), limit);
    const ids = records.map((r) => r.id);
    return list.objectType === "contact"
      ? { contactIds: ids, accountIds: [] }
      : { contactIds: [], accountIds: ids };
  },

  async addListMember({ listId, objectId, objectType }: CrmListMembership): Promise<void> {
    const list = await this.getList({ id: listId });
    if (!list) {
      throw new TwentyMcpError(-32602, `list ${listId} not found`);
    }
    if (list.objectType !== objectType) {
      throw new TwentyMcpError(-32602, `list ${listId} holds ${list.objectType} records, not ${objectType} records`);
    }
    const record = await findOne<Record<string, unknown>>(objectType, objectId);
    if (!record) {
      throw new TwentyMcpError(-32602, `${objectType} ${objectId} not found`);
    }
    const next = slugsWith(readListSlugs(OBJECTS[objectType].findOne, record, twentyMcpError), list.slug);
    if (!next) return;
    await writeRecord(OBJECTS[objectType].update, membershipUpdateArgs(objectId, next));
  },

  async removeListMember({ listId, objectId, objectType }: CrmListMembership): Promise<void> {
    const list = await this.getList({ id: listId });
    if (!list) return;
    if (list.objectType !== objectType) {
      throw new TwentyMcpError(-32602, `list ${listId} holds ${list.objectType} records, not ${objectType} records`);
    }
    const record = await findOne<Record<string, unknown>>(objectType, objectId);
    if (!record) return;
    const next = slugsWithout(readListSlugs(OBJECTS[objectType].findOne, record, twentyMcpError), list.slug);
    if (!next) return;
    await writeRecord(OBJECTS[objectType].update, membershipUpdateArgs(objectId, next));
  },
};

// ---------------------------------------------------------------------------
// List helpers
// ---------------------------------------------------------------------------

/** The error of a read that needs every view of an object when get_views answered its ceiling. */
function viewsCeilingError(objectType: RecordType): TwentyMcpError {
  return new TwentyMcpError(
    -32603,
    `get_views answered ${VIEWS_LIMIT} ${OBJECTS[objectType].nameSingular} views, the ceiling of Twenty's get_views (it has no offset): ` +
      "views past it cannot be read, so lists cannot be read completely",
  );
}

async function readViews(objectType: RecordType): Promise<TwentyView[]> {
  return readArrayAnswer<TwentyView>(
    "get_views",
    await callTool("get_views", getViewsArgs(objectType)),
    twentyMcpError,
  );
}

/** The list a view is, or null when the view carries no `inLists CONTAINS` filter. */
async function listOf(view: TwentyView, objectType: RecordType): Promise<CrmList | null> {
  const fieldId = await listFieldId(objectType);
  if (!fieldId) return null;
  const filters = readArrayAnswer(
    "get_view_filters",
    await callTool("get_view_filters", getViewFiltersArgs(view.id)),
    twentyMcpError,
  );
  const slug = listSlugFromFilters(filters, fieldId);
  if (!slug) return null;
  return { id: view.id, slug, name: view.name ?? view.id, objectType };
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
    objectIds = objectIdsFrom(
      readArrayAnswer(
        "get_object_metadata",
        await callTool("get_object_metadata", getObjectMetadataArgs()),
        twentyMcpError,
      ),
    );
    if (!objectIds) {
      throw new TwentyMcpError(-32603, "Twenty object metadata names no person and company objects");
    }
  }
  const fieldId = listFieldIdFrom(
    readArrayAnswer(
      "get_field_metadata",
      await callTool("get_field_metadata", getFieldMetadataArgs(objectIds[objectType])),
      twentyMcpError,
    ),
  );
  if (fieldId) listFieldIds[objectType] = fieldId;
  return fieldId;
}

/** Forget the cached object and field ids (tests). */
export function _resetTwentyListCache(): void {
  objectIds = null;
  delete listFieldIds.contact;
  delete listFieldIds.account;
}
