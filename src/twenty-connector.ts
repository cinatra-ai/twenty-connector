import "server-only";

// Twenty CRM provider implementation for the provider-agnostic CrmConnector
// facade. Maps cinatra-shape verbs to Twenty's catalog tools via the
// dispatcher `execute_tool` MCP call. The catalog tools take TOP-LEVEL
// arguments (`{ name, cinatraObjectId, ... }`), not args wrapped in an
// `input` field — this mirrors the bootstrap-proof contract validated
// end-to-end against the local Twenty stack.
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

import { executeTwentyMcpTool, readJsonContent, TwentyMcpError } from "./twenty-mcp-call";

// ---------------------------------------------------------------------------
// Twenty raw shapes (subset of fields cinatra reads). The full record shape
// returned by Twenty's CRUD tools wraps records under a record-type key
// (`person`, `company`, `view`) at the top level of the response payload.
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

function splitName(full: string): TwentyName {
  const trimmed = full.trim();
  if (!trimmed) return {};
  const idx = trimmed.indexOf(" ");
  if (idx < 0) return { firstName: trimmed };
  return {
    firstName: trimmed.slice(0, idx),
    lastName: trimmed.slice(idx + 1).trim(),
  };
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
  const domain =
    typeof c.domainName === "string"
      ? c.domainName
      : c.domainName?.primaryLinkUrl ?? null;
  return {
    id: c.id,
    cinatraObjectId: c.cinatraObjectId ?? undefined,
    name: c.name ?? "",
    domainName: domain,
    inLists: c.inLists ?? [],
    apolloOrganizationId: c.apolloOrganizationId ?? null,
  };
}

function contactToTopLevelArgs(input: Partial<CrmContact>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = splitName(input.name);
  if (input.email !== undefined) out.emails = { primaryEmail: input.email ?? "" };
  if (input.title !== undefined) out.jobTitle = input.title ?? "";
  if (input.accountId !== undefined) out.companyId = input.accountId ?? null;
  if (input.inLists !== undefined) out.inLists = input.inLists;
  if (input.apolloPersonId !== undefined) out.apolloPersonId = input.apolloPersonId ?? "";
  if (input.enrichmentStatus !== undefined) out.enrichmentStatus = input.enrichmentStatus ?? "";
  if (input.linkedinUrl !== undefined) out.linkedinLink = { primaryLinkUrl: input.linkedinUrl ?? "" };
  if (input.twitterHandle !== undefined) out.xLink = { primaryLinkUrl: input.twitterHandle ?? "" };
  if (input.cinatraObjectId !== undefined) out.cinatraObjectId = input.cinatraObjectId ?? "";
  return out;
}

function accountToTopLevelArgs(input: Partial<CrmAccount>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.domainName !== undefined) {
    out.domainName = { primaryLinkUrl: input.domainName ?? "" };
  }
  if (input.inLists !== undefined) out.inLists = input.inLists;
  if (input.apolloOrganizationId !== undefined) {
    out.apolloOrganizationId = input.apolloOrganizationId ?? "";
  }
  if (input.cinatraObjectId !== undefined) out.cinatraObjectId = input.cinatraObjectId ?? "";
  return out;
}

// ---------------------------------------------------------------------------
// Connector implementation
// ---------------------------------------------------------------------------

export const twentyConnector: CrmConnector = {
  providerId: "twenty",

  // ----- Contacts (Twenty: Person) -----

  async searchContacts({ query, limit }): Promise<CrmContact[]> {
    const result = await executeTwentyMcpTool("find_people", {
      filter: query ? { searchName: query } : {},
      limit: limit ?? 25,
    });
    const payload = readJsonContent<{ people?: TwentyPerson[] }>(result);
    return (payload.people ?? []).map(mapPersonToContact);
  },

  async getContact({ id }): Promise<CrmContact | null> {
    try {
      const result = await executeTwentyMcpTool("find_one_person", { id });
      const payload = readJsonContent<{ person?: TwentyPerson | null }>(result);
      if (!payload.person) return null;
      return mapPersonToContact(payload.person);
    } catch (err) {
      if (err instanceof TwentyMcpError && /not.?found/i.test(err.message)) {
        return null;
      }
      throw err;
    }
  },

  async createContact(input): Promise<CrmContact> {
    const args = contactToTopLevelArgs(input);
    if (!args.name) args.name = splitName(input.name ?? "");
    const result = await executeTwentyMcpTool("create_person", args);
    const payload = readJsonContent<{ person?: TwentyPerson }>(result);
    if (!payload.person) {
      throw new TwentyMcpError(-32603, "create_person returned no person");
    }
    return mapPersonToContact(payload.person);
  },

  async updateContact({ id, patch }): Promise<CrmContact> {
    const result = await executeTwentyMcpTool("update_person", {
      id,
      ...contactToTopLevelArgs(patch),
    });
    const payload = readJsonContent<{ person?: TwentyPerson }>(result);
    if (!payload.person) {
      throw new TwentyMcpError(-32603, "update_person returned no person");
    }
    return mapPersonToContact(payload.person);
  },

  async findContactByEmail({ email }): Promise<CrmContact | null> {
    const result = await executeTwentyMcpTool("find_people", {
      filter: { "emails.primaryEmail": email },
      limit: 1,
    });
    const payload = readJsonContent<{ people?: TwentyPerson[] }>(result);
    const first = payload.people?.[0];
    return first ? mapPersonToContact(first) : null;
  },

  // ----- Accounts (Twenty: Company) -----

  async searchAccounts({ query, limit }): Promise<CrmAccount[]> {
    const result = await executeTwentyMcpTool("find_companies", {
      filter: query ? { searchName: query } : {},
      limit: limit ?? 25,
    });
    const payload = readJsonContent<{ companies?: TwentyCompany[] }>(result);
    return (payload.companies ?? []).map(mapCompanyToAccount);
  },

  async getAccount({ id }): Promise<CrmAccount | null> {
    try {
      const result = await executeTwentyMcpTool("find_one_company", { id });
      const payload = readJsonContent<{ company?: TwentyCompany | null }>(result);
      if (!payload.company) return null;
      return mapCompanyToAccount(payload.company);
    } catch (err) {
      if (err instanceof TwentyMcpError && /not.?found/i.test(err.message)) {
        return null;
      }
      throw err;
    }
  },

  async createAccount(input): Promise<CrmAccount> {
    const args = accountToTopLevelArgs(input);
    if (!args.name) args.name = input.name;
    const result = await executeTwentyMcpTool("create_company", args);
    const payload = readJsonContent<{ company?: TwentyCompany }>(result);
    if (!payload.company) {
      throw new TwentyMcpError(-32603, "create_company returned no company");
    }
    return mapCompanyToAccount(payload.company);
  },

  async updateAccount({ id, patch }): Promise<CrmAccount> {
    const result = await executeTwentyMcpTool("update_company", {
      id,
      ...accountToTopLevelArgs(patch),
    });
    const payload = readJsonContent<{ company?: TwentyCompany }>(result);
    if (!payload.company) {
      throw new TwentyMcpError(-32603, "update_company returned no company");
    }
    return mapCompanyToAccount(payload.company);
  },

  // ----- Lists (Twenty: View filtered on `inLists`) -----

  async searchLists({ query, objectType }): Promise<CrmList[]> {
    // Twenty's catalog has `get_views` (not `find_views`/`find_one_view`).
    // The tool returns all views in the workspace; we post-filter by name
    // substring and by objectType (when the per-type object-metadata-id
    // cache has been populated by ensureObjectMetadataLoaded).
    let wantedMetadataId: string | null = null;
    if (objectType) {
      await ensureObjectMetadataLoaded();
      wantedMetadataId = viewObjectMetadataIdFor(objectType);
      if (wantedMetadataId === null) {
        // Caller asked for a per-type filter but metadata could not be loaded.
        // Fail-closed before issuing the get_views call.
        throw new TwentyMcpError(
          -32603,
          `cannot filter views by objectType="${objectType}" — Twenty object metadata not available`,
        );
      }
    }
    const result = await executeTwentyMcpTool("get_views", {});
    const payload = readJsonContent<{ views?: TwentyView[] }>(result);
    const all = payload.views ?? [];
    const lowered = (query ?? "").trim().toLowerCase();
    return all
      .filter((v) => {
        if (lowered && !(v.name ?? "").toLowerCase().includes(lowered)) return false;
        if (wantedMetadataId && v.objectMetadataId !== wantedMetadataId) return false;
        return true;
      })
      .map(mapViewToList);
  },

  async getList({ id }): Promise<CrmList | null> {
    // No `find_one_view` in the catalog — list all and pick the matching id.
    const result = await executeTwentyMcpTool("get_views", {});
    const payload = readJsonContent<{ views?: TwentyView[] }>(result);
    const v = (payload.views ?? []).find((view) => view.id === id);
    return v ? mapViewToList(v) : null;
  },

  async createList(input): Promise<CrmList> {
    const slug = input.slug || slugify(input.name);
    await ensureObjectMetadataLoaded();
    const metadataId = viewObjectMetadataIdFor(input.objectType);
    if (metadataId === null) {
      throw new TwentyMcpError(
        -32603,
        `cannot create view for objectType="${input.objectType}" — Twenty object metadata not available (the view target object is required)`,
      );
    }
    const createResult = await executeTwentyMcpTool("create_view", {
      name: input.name,
      objectMetadataId: metadataId,
      type: "table",
    });
    const payload = readJsonContent<{ view?: TwentyView }>(createResult);
    if (!payload.view) {
      throw new TwentyMcpError(-32603, "create_view returned no view");
    }
    // Attach the `inLists CONTAINS <slug>` filter to the new view. The
    // catalog tool for adding a NEW filter is `create_view_filter`. Best-
    // effort: if Twenty's filter API doesn't accept this exact shape for a
    // given workspace, the list still functions via direct `inLists`
    // membership ops below.
    await executeTwentyMcpTool("create_view_filter", {
      viewId: payload.view.id,
      fieldName: "inLists",
      operand: "contains",
      value: slug,
    }).catch(() => {
      // Swallow — direct membership patches in addListMember keep working.
    });
    // Override mapViewToList's inferred objectType with the caller's
    // explicit input — guarantees the caller sees what they asked for.
    return { ...mapViewToList(payload.view), slug, objectType: input.objectType };
  },

  async getListMembers({ listId, limit }): Promise<{
    contactIds: string[];
    accountIds: string[];
  }> {
    // Ensure metadata is loaded so list.objectType is accurate before
    // dispatching to find_people vs find_companies.
    await ensureObjectMetadataLoaded();
    const list = await this.getList({ id: listId });
    if (!list) return { contactIds: [], accountIds: [] };
    if (list.objectType === "contact") {
      const result = await executeTwentyMcpTool("find_people", {
        filter: { inLists: { contains: list.slug } },
        limit: limit ?? 1000,
      });
      const payload = readJsonContent<{ people?: TwentyPerson[] }>(result);
      return { contactIds: (payload.people ?? []).map((p) => p.id), accountIds: [] };
    }
    const result = await executeTwentyMcpTool("find_companies", {
      filter: { inLists: { contains: list.slug } },
      limit: limit ?? 1000,
    });
    const payload = readJsonContent<{ companies?: TwentyCompany[] }>(result);
    return { contactIds: [], accountIds: (payload.companies ?? []).map((c) => c.id) };
  },

  async addListMember({ listId, objectId, objectType }: CrmListMembership): Promise<void> {
    const list = await this.getList({ id: listId });
    if (!list) {
      throw new TwentyMcpError(-32602, `list ${listId} not found`);
    }
    const current = await readMembershipInLists(objectId, objectType);
    if (current.includes(list.slug)) return;
    const next = [...current, list.slug];
    await patchMembershipInLists(objectId, objectType, next);
  },

  async removeListMember({ listId, objectId, objectType }: CrmListMembership): Promise<void> {
    const list = await this.getList({ id: listId });
    if (!list) return;
    const current = await readMembershipInLists(objectId, objectType);
    if (!current.includes(list.slug)) return;
    const next = current.filter((s) => s !== list.slug);
    await patchMembershipInLists(objectId, objectType, next);
  },
};

// ---------------------------------------------------------------------------
// List/membership helpers
// ---------------------------------------------------------------------------

function mapViewToList(v: TwentyView): CrmList {
  return {
    id: v.id,
    slug: slugify(v.name ?? v.id),
    name: v.name ?? v.id,
    objectType: viewObjectTypeFor(v.objectMetadataId),
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Per-type object-metadata-id cache. Lazily populated by
// `ensureObjectMetadataLoaded` on first use; can also be pre-populated by
// `_setObjectMetadataIds` (autoSetup or tests). When unset, callers that
// require per-type semantics fail-closed with a clear error.
let cachedObjectMetadataIds: { contact: string; account: string } | null = null;
let metadataLoadInflight: Promise<void> | null = null;

/** Lazily fetch + cache the Person/Company object metadata ids from Twenty.
 *  Idempotent: short-circuits when the cache is already populated;
 *  deduplicates concurrent callers via an in-flight promise. Soft-fails on
 *  upstream errors (cache stays null; callers detect + degrade). */
async function ensureObjectMetadataLoaded(): Promise<void> {
  if (cachedObjectMetadataIds !== null) return;
  if (metadataLoadInflight) {
    await metadataLoadInflight;
    return;
  }
  metadataLoadInflight = (async () => {
    try {
      const result = await executeTwentyMcpTool("get_object_metadata", {});
      const payload = readJsonContent<{
        objectMetadata?: Array<{ id: string; nameSingular?: string }>;
        objects?: Array<{ id: string; nameSingular?: string }>;
      }>(result);
      const rows = payload.objectMetadata ?? payload.objects ?? [];
      const person = rows.find((r) => r.nameSingular === "person");
      const company = rows.find((r) => r.nameSingular === "company");
      if (person && company) {
        cachedObjectMetadataIds = { contact: person.id, account: company.id };
      }
    } catch {
      // Cache stays null — callers that need per-type semantics will throw
      // with a clear error; callers that don't continue with degraded
      // behavior.
    } finally {
      metadataLoadInflight = null;
    }
  })();
  await metadataLoadInflight;
}

function viewObjectMetadataIdFor(objectType: "contact" | "account"): string | null {
  if (!cachedObjectMetadataIds) return null;
  return objectType === "contact"
    ? cachedObjectMetadataIds.contact
    : cachedObjectMetadataIds.account;
}

function viewObjectTypeFor(objectMetadataId: string | undefined): "contact" | "account" {
  if (!objectMetadataId || !cachedObjectMetadataIds) return "contact";
  return objectMetadataId === cachedObjectMetadataIds.account ? "account" : "contact";
}

/** Populate the per-type object-metadata-id cache after autoSetupLocalTwenty
 *  resolves them from Twenty. Also used by unit tests. Pass null to reset. */
export function _setObjectMetadataIds(ids: {
  contact: string;
  account: string;
} | null): void {
  cachedObjectMetadataIds = ids;
}

async function readMembershipInLists(
  objectId: string,
  objectType: "contact" | "account",
): Promise<string[]> {
  if (objectType === "contact") {
    const result = await executeTwentyMcpTool("find_one_person", { id: objectId });
    const payload = readJsonContent<{ person?: TwentyPerson | null }>(result);
    return payload.person?.inLists ?? [];
  }
  const result = await executeTwentyMcpTool("find_one_company", { id: objectId });
  const payload = readJsonContent<{ company?: TwentyCompany | null }>(result);
  return payload.company?.inLists ?? [];
}

async function patchMembershipInLists(
  objectId: string,
  objectType: "contact" | "account",
  inLists: string[],
): Promise<void> {
  if (objectType === "contact") {
    await executeTwentyMcpTool("update_person", { id: objectId, inLists });
    return;
  }
  await executeTwentyMcpTool("update_company", { id: objectId, inLists });
}
