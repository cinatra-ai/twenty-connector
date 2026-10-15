import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ONLY the transport (`executeTwentyMcpTool`) so the connector tests run
// without a live Twenty stack. Each test sets up the answers Twenty gives, in
// the shapes Twenty sends them (record tools `{ success, message, result }`,
// view and metadata tools bare, writes `result: { id }`), and the connector
// reads them through the REAL readers of src/twenty-mcp-call.ts. Each case
// loads the connector afresh, so its metadata cache never leaks between cases.

const execMock = vi.hoisted(() => vi.fn());

vi.mock("../twenty-mcp-call", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, executeTwentyMcpTool: execMock };
});

type Answers = Record<string, unknown | unknown[]>;

/** Answer each tool with the given value (an array of `{ seq: [...] }` answers one per call, in order). */
function setupExecResult(answers: Answers) {
  const queues: Record<string, unknown[]> = {};
  for (const [tool, a] of Object.entries(answers)) {
    queues[tool] = a && typeof a === "object" && "seq" in (a as any) ? [...(a as any).seq] : [a];
  }
  execMock.mockImplementation(async (tool: string) => {
    const q = queues[tool];
    if (!q || q.length === 0) throw new Error(`unexpected call ${tool}`);
    const answer = q.length > 1 ? q.shift() : q[0];
    return { content: [{ type: "text", text: JSON.stringify(answer) }], isError: false };
  });
}

const found = (records: unknown[]) => ({
  success: true,
  message: `Found ${records.length} records`,
  result: { records, count: records.length },
  recordReferences: [],
});
const written = (id: string) => ({ success: true, message: "Record written", result: { id } });
const OBJECTS = [
  { id: "obj-person", nameSingular: "person" },
  { id: "obj-company", nameSingular: "company" },
];
const FIELDS = {
  seq: [[{ id: "fld-person-inlists", name: "inLists", type: "ARRAY" }], [{ id: "fld-company-inlists", name: "inLists", type: "ARRAY" }]],
};
const PERSON_FIELDS = [{ id: "fld-person-inlists", name: "inLists", type: "ARRAY" }];
const listFilter = (viewId: string, slug: string, field = "fld-person-inlists") => [
  { id: `f-${viewId}`, viewId, fieldMetadataId: field, operand: "CONTAINS", value: slug },
];

let twentyConnector: any;
let TwentyMcpError: any;

beforeEach(async () => {
  vi.resetModules();
  execMock.mockReset();
  twentyConnector = (await import("../twenty-connector")).twentyConnector;
  TwentyMcpError = (await import("../twenty-mcp-call")).TwentyMcpError;
});

const calls = (tool: string) => execMock.mock.calls.filter((c) => c[0] === tool).map((c) => c[1]);

describe("twentyConnector — contacts", () => {
  it("searchContacts maps Twenty Person rows to CrmContact shape", async () => {
    setupExecResult({
      find_people: found([
        {
          id: "p-1",
          name: { firstName: "Ada", lastName: "Lovelace" },
          emails: { primaryEmail: "ada@example.com" },
          jobTitle: "Mathematician",
          linkedinLink: { primaryLinkUrl: "https://linkedin.com/in/ada" },
          companyId: "c-1",
          inLists: ["leaders"],
          cinatraObjectId: "obj-1",
        },
      ]),
    });

    const out = await twentyConnector.searchContacts({ query: "ada", limit: 10 });

    // The filters sit at the TOP level beside limit (never under `filter`).
    expect(execMock).toHaveBeenCalledWith("find_people", {
      or: [
        { name: { firstName: { ilike: "%ada%" } } },
        { name: { lastName: { ilike: "%ada%" } } },
        { emails: { primaryEmail: { ilike: "%ada%" } } },
      ],
      limit: 10,
    });
    expect(out).toEqual([
      {
        id: "p-1",
        cinatraObjectId: "obj-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        title: "Mathematician",
        accountId: "c-1",
        inLists: ["leaders"],
        apolloPersonId: null,
        enrichmentStatus: null,
        linkedinUrl: "https://linkedin.com/in/ada",
        twitterHandle: null,
      },
    ]);
  });

  it("getContact returns null when Twenty returns no person", async () => {
    setupExecResult({ find_one_person: found([]) });
    const out = await twentyConnector.getContact({ id: "missing" });
    expect(out).toBeNull();
  });

  it("getContact maps a single Twenty Person", async () => {
    setupExecResult({
      find_one_person: found([{ id: "p-2", name: { firstName: "Grace" }, emails: { primaryEmail: "grace@example.com" } }]),
    });
    const out = await twentyConnector.getContact({ id: "p-2" });
    expect(execMock).toHaveBeenCalledWith("find_one_person", { id: "p-2" });
    expect(out).toMatchObject({ id: "p-2", name: "Grace", email: "grace@example.com" });
  });

  it("createContact calls create_person with TOP-LEVEL args (no `input` wrapper)", async () => {
    setupExecResult({
      create_person: written("p-3"),
      find_one_person: found([
        { id: "p-3", name: { firstName: "Alan", lastName: "Turing" }, emails: { primaryEmail: "alan@example.com" } },
      ]),
    });
    const out = await twentyConnector.createContact({ name: "Alan Turing", email: "alan@example.com" });
    expect(execMock).toHaveBeenCalledWith(
      "create_person",
      expect.objectContaining({
        name: { firstName: "Alan", lastName: "Turing" },
        emails: { primaryEmail: "alan@example.com" },
      }),
    );
    const [, args] = execMock.mock.calls[0];
    expect(args).not.toHaveProperty("input");
    expect(out.id).toBe("p-3");
    expect(out.name).toBe("Alan Turing");
  });

  it("updateContact passes id + only patched fields at top level", async () => {
    setupExecResult({
      update_person: written("p-4"),
      find_one_person: found([{ id: "p-4", name: { firstName: "Edsger" } }]),
    });
    await twentyConnector.updateContact({ id: "p-4", patch: { enrichmentStatus: "enriched", apolloPersonId: "ap-9" } });
    expect(execMock).toHaveBeenCalledWith("update_person", { id: "p-4", enrichmentStatus: "enriched", apolloPersonId: "ap-9" });
    const [, args] = execMock.mock.calls[0];
    expect(args).not.toHaveProperty("input");
  });

  it("findContactByEmail filters on emails.primaryEmail + limit 1", async () => {
    setupExecResult({ find_people: found([]) });
    const out = await twentyConnector.findContactByEmail({ email: "no-match@example.com" });
    // The EMAILS filter is nested at the top level, never a dotted key under `filter`.
    expect(execMock).toHaveBeenCalledWith("find_people", {
      emails: { primaryEmail: { eq: "no-match@example.com" } },
      limit: 1,
    });
    expect(out).toBeNull();
  });

  it("findContactByEmail returns the first hit", async () => {
    setupExecResult({
      find_people: found([{ id: "p-5", name: { firstName: "John" }, emails: { primaryEmail: "j@example.com" } }]),
    });
    const out = await twentyConnector.findContactByEmail({ email: "j@example.com" });
    expect(out?.id).toBe("p-5");
  });
});

describe("twentyConnector — accounts", () => {
  it("searchAccounts maps Twenty Company rows to CrmAccount", async () => {
    setupExecResult({
      find_companies: found([
        { id: "c-1", name: "Acme", domainName: { primaryLinkUrl: "https://acme.com" }, inLists: ["customers"] },
      ]),
    });
    const out = await twentyConnector.searchAccounts({ query: "acme" });
    expect(execMock).toHaveBeenCalledWith("find_companies", { name: { ilike: "%acme%" }, limit: 25 });
    expect(out[0]).toMatchObject({ id: "c-1", name: "Acme", domainName: "https://acme.com", inLists: ["customers"] });
  });

  it("getAccount returns null when missing", async () => {
    setupExecResult({ find_one_company: found([]) });
    const out = await twentyConnector.getAccount({ id: "missing" });
    expect(out).toBeNull();
  });

  it("createAccount maps name + domainName at TOP LEVEL", async () => {
    setupExecResult({
      create_company: written("c-2"),
      find_one_company: found([{ id: "c-2", name: "Initech", domainName: { primaryLinkUrl: "https://initech.com" } }]),
    });
    const out = await twentyConnector.createAccount({ name: "Initech", domainName: "https://initech.com" });
    expect(execMock).toHaveBeenCalledWith(
      "create_company",
      expect.objectContaining({ name: "Initech", domainName: { primaryLinkUrl: "https://initech.com" } }),
    );
    const [, args] = execMock.mock.calls[0];
    expect(args).not.toHaveProperty("input");
    expect(out.id).toBe("c-2");
  });

  it("updateAccount passes id + patched fields at top level", async () => {
    setupExecResult({ update_company: written("c-3"), find_one_company: found([{ id: "c-3", name: "Renamed" }]) });
    await twentyConnector.updateAccount({ id: "c-3", patch: { name: "Renamed", apolloOrganizationId: "ao-2" } });
    expect(execMock).toHaveBeenCalledWith(
      "update_company",
      expect.objectContaining({ id: "c-3", name: "Renamed", apolloOrganizationId: "ao-2" }),
    );
  });
});

describe("twentyConnector — lists / Views", () => {
  it("searchLists calls get_views (not find_views) + post-filters by name substring", async () => {
    setupExecResult({
      get_object_metadata: OBJECTS,
      get_field_metadata: FIELDS,
      get_views: {
        seq: [
          [
            { id: "v-1", name: "Leaders", objectMetadataId: "obj-person" },
            { id: "v-2", name: "Customers", objectMetadataId: "obj-person" },
            { id: "v-3", name: "Internal Leaders Group", objectMetadataId: "obj-person" },
          ],
          [],
        ],
      },
      get_view_filters: { seq: [listFilter("v-1", "leaders"), listFilter("v-3", "internal-leaders")] },
    });
    const out = await twentyConnector.searchLists({ query: "leaders" });
    expect(calls("get_views")[0]).toEqual({ objectNameSingular: "person", limit: 100 });
    expect(out.map((l: any) => l.id)).toEqual(["v-1", "v-3"]);
  });

  it("getList calls get_views and selects by id (no find_one_view in catalog)", async () => {
    setupExecResult({
      get_views: {
        seq: [
          [
            { id: "v-1", name: "Leaders", objectMetadataId: "obj-person" },
            { id: "v-2", name: "Customers", objectMetadataId: "obj-person" },
          ],
        ],
      },
      get_object_metadata: OBJECTS,
      get_field_metadata: PERSON_FIELDS,
      get_view_filters: listFilter("v-2", "customers"),
    });
    const out = await twentyConnector.getList({ id: "v-2" });
    expect(calls("get_views")[0]).toEqual({ objectNameSingular: "person", limit: 100 });
    expect(out?.name).toBe("Customers");
  });

  it("getList returns null when no view matches", async () => {
    setupExecResult({ get_views: { seq: [[{ id: "v-1", name: "Other", objectMetadataId: "obj-person" }], []] } });
    const out = await twentyConnector.getList({ id: "v-missing" });
    expect(out).toBeNull();
  });

  it("createList calls create_view then create_view_filter (not update_view_filter)", async () => {
    setupExecResult({
      get_object_metadata: OBJECTS,
      get_field_metadata: PERSON_FIELDS,
      get_views: [],
      create_view: { id: "v-new", name: "New List", objectNameSingular: "person", type: "TABLE" },
      create_view_filter: { id: "f-new", viewId: "v-new", fieldMetadataId: "fld-person-inlists", operand: "CONTAINS", value: "new-list" },
    });

    const out = await twentyConnector.createList({ slug: "new-list", name: "New List", objectType: "contact" });

    const tools = execMock.mock.calls.map((c) => c[0]);
    expect(tools.indexOf("create_view")).toBeLessThan(tools.indexOf("create_view_filter"));
    expect(tools).not.toContain("update_view_filter");
    expect(execMock).toHaveBeenCalledWith(
      "create_view",
      expect.objectContaining({ name: "New List", objectNameSingular: "person", type: "TABLE" }),
    );
    expect(execMock).toHaveBeenCalledWith("create_view_filter", {
      viewId: "v-new",
      fieldMetadataId: "fld-person-inlists",
      operand: "CONTAINS",
      value: "new-list",
    });
    expect(out.id).toBe("v-new");
    expect(out.slug).toBe("new-list");
  });

  it("addListMember reads current inLists + appends + writes back via update_person at top level", async () => {
    setupExecResult({
      get_views: [{ id: "v-1", name: "Leaders", objectMetadataId: "obj-person" }],
      get_object_metadata: OBJECTS,
      get_field_metadata: PERSON_FIELDS,
      get_view_filters: listFilter("v-1", "leaders"),
      find_one_person: found([{ id: "p-1", inLists: ["existing"] }]),
      update_person: written("p-1"),
    });

    await twentyConnector.addListMember({ listId: "v-1", objectId: "p-1", objectType: "contact" });

    expect(calls("update_person")).toEqual([{ id: "p-1", inLists: ["existing", "leaders"] }]);
    expect(execMock).toHaveBeenLastCalledWith("update_person", expect.objectContaining({ id: "p-1", inLists: ["existing", "leaders"] }));
    expect(calls("update_person")[0]).not.toHaveProperty("input");
  });

  it("addListMember is a no-op when the slug is already in inLists", async () => {
    setupExecResult({
      get_views: [{ id: "v-1", name: "Leaders", objectMetadataId: "obj-person" }],
      get_object_metadata: OBJECTS,
      get_field_metadata: PERSON_FIELDS,
      get_view_filters: listFilter("v-1", "leaders"),
      find_one_person: found([{ id: "p-1", inLists: ["leaders"] }]),
    });

    await twentyConnector.addListMember({ listId: "v-1", objectId: "p-1", objectType: "contact" });
    // Exactly the reads that resolve the list and the record, and no write: get_views, get_object_metadata,
    // get_field_metadata, get_view_filters, find_one_person.
    expect(execMock.mock.calls.map((c) => c[0])).toEqual([
      "get_views",
      "get_object_metadata",
      "get_field_metadata",
      "get_view_filters",
      "find_one_person",
    ]);
  });

  it("removeListMember drops the slug when present", async () => {
    setupExecResult({
      get_views: [{ id: "v-1", name: "Leaders", objectMetadataId: "obj-person" }],
      get_object_metadata: OBJECTS,
      get_field_metadata: PERSON_FIELDS,
      get_view_filters: listFilter("v-1", "leaders"),
      find_one_person: found([{ id: "p-2", inLists: ["leaders", "vip"] }]),
      update_person: written("p-2"),
    });

    await twentyConnector.removeListMember({ listId: "v-1", objectId: "p-2", objectType: "contact" });
    expect(execMock).toHaveBeenLastCalledWith("update_person", expect.objectContaining({ id: "p-2", inLists: ["vip"] }));
  });

  it("addListMember throws when the list doesn't exist", async () => {
    setupExecResult({ get_views: [] });
    await expect(
      twentyConnector.addListMember({ listId: "v-missing", objectId: "p-1", objectType: "contact" }),
    ).rejects.toBeInstanceOf(TwentyMcpError);
  });

  it("createList for objectType=account preserves the caller's objectType in the return + queries get_object_metadata first", async () => {
    setupExecResult({
      get_object_metadata: OBJECTS,
      get_field_metadata: [{ id: "fld-company-inlists", name: "inLists", type: "ARRAY" }],
      get_views: [],
      create_view: { id: "v-acc", name: "Customers", objectNameSingular: "company", type: "TABLE" },
      create_view_filter: { id: "f-acc", viewId: "v-acc", fieldMetadataId: "fld-company-inlists", operand: "CONTAINS", value: "customers" },
    });

    const out = await twentyConnector.createList({ slug: "customers", name: "Customers", objectType: "account" });

    expect(out.objectType).toBe("account");
    expect(out.id).toBe("v-acc");
    const tools = execMock.mock.calls.map((c) => c[0]);
    expect(tools[0]).toBe("get_object_metadata");
    expect(tools.indexOf("get_object_metadata")).toBeLessThan(tools.indexOf("create_view"));
    // The view is created for the company object (by name), and its list filter on the company's inLists field.
    expect(execMock).toHaveBeenCalledWith(
      "create_view",
      expect.objectContaining({ name: "Customers", objectNameSingular: "company", type: "TABLE" }),
    );
    expect(calls("create_view_filter")[0]).toMatchObject({ fieldMetadataId: "fld-company-inlists", value: "customers" });
  });

  it("searchLists fails closed when objectType filter is requested but metadata cannot be loaded", async () => {
    // get_object_metadata names no person/company object
    setupExecResult({ get_object_metadata: [] });

    await expect(twentyConnector.searchLists({ query: "foo", objectType: "account" })).rejects.toThrow(
      /object metadata names no person and company objects/,
    );
    expect(calls("get_views")).toEqual([]);
  });

  it("searchLists with no objectType filter fails closed when metadata cannot be loaded", async () => {
    // get_object_metadata names no person/company object: the list field cannot be resolved for either type
    setupExecResult({ get_object_metadata: [] });

    await expect(twentyConnector.searchLists({ query: "" })).rejects.toThrow(
      /object metadata names no person and company objects/,
    );
    expect(calls("get_views")).toEqual([]);
  });

  it("searchLists with no objectType filter reads both objects' views (metadata names the list field)", async () => {
    setupExecResult({
      get_object_metadata: OBJECTS,
      get_field_metadata: FIELDS,
      get_views: {
        seq: [
          [{ id: "v-1", name: "Leaders", objectMetadataId: "obj-person" }],
          [{ id: "v-2", name: "Customers", objectMetadataId: "obj-company" }],
        ],
      },
      get_view_filters: { seq: [listFilter("v-1", "leaders"), listFilter("v-2", "customers", "fld-company-inlists")] },
    });
    const out = await twentyConnector.searchLists({ query: "" });
    expect(calls("get_views")).toEqual([
      { objectNameSingular: "person", limit: 100 },
      { objectNameSingular: "company", limit: 100 },
    ]);
    expect(out.length).toBe(2);
    expect(out.map((l: any) => l.objectType)).toEqual(["contact", "account"]);
  });
});
