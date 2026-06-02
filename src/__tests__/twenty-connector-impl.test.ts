import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP-call layer so the connector tests run without a live Twenty
// stack. Each test sets up the expected execute_tool result for the call(s)
// the method is going to make.
vi.mock("../twenty-mcp-call", () => ({
  executeTwentyMcpTool: vi.fn(),
  readJsonContent: vi.fn(),
  TwentyMcpError: class TwentyMcpError extends Error {
    code: number;
    constructor(code: number, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { twentyConnector, _setObjectMetadataIds } from "../twenty-connector";
import {
  executeTwentyMcpTool,
  readJsonContent,
  TwentyMcpError,
} from "../twenty-mcp-call";

const execMock = vi.mocked(executeTwentyMcpTool);
const readMock = vi.mocked(readJsonContent);

function setupExecResult(parsedJson: unknown) {
  const sentinel = { content: [{ type: "text" as const, text: "(mocked)" }] };
  execMock.mockResolvedValueOnce(sentinel);
  readMock.mockReturnValueOnce(parsedJson);
}

// Most tests don't exercise the lazy metadata-load path — pre-populate the
// cache so they exercise the post-load branches directly. Tests that need
// to assert the lazy-load path reset the cache before exercising it.
beforeEach(() => {
  execMock.mockReset();
  readMock.mockReset();
  _setObjectMetadataIds({ contact: "obj-person", account: "obj-company" });
});

describe("twentyConnector — contacts", () => {
  it("searchContacts maps Twenty Person rows to CrmContact shape", async () => {
    setupExecResult({
      people: [
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
      ],
    });

    const out = await twentyConnector.searchContacts({ query: "ada", limit: 10 });

    expect(execMock).toHaveBeenCalledWith("find_people", {
      filter: { searchName: "ada" },
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
    setupExecResult({ person: null });
    const out = await twentyConnector.getContact({ id: "missing" });
    expect(out).toBeNull();
  });

  it("getContact maps a single Twenty Person", async () => {
    setupExecResult({
      person: {
        id: "p-2",
        name: { firstName: "Grace" },
        emails: { primaryEmail: "grace@example.com" },
      },
    });
    const out = await twentyConnector.getContact({ id: "p-2" });
    expect(out).toMatchObject({ id: "p-2", name: "Grace", email: "grace@example.com" });
  });

  it("createContact calls create_person with TOP-LEVEL args (no `input` wrapper)", async () => {
    setupExecResult({
      person: {
        id: "p-3",
        name: { firstName: "Alan", lastName: "Turing" },
        emails: { primaryEmail: "alan@example.com" },
      },
    });
    const out = await twentyConnector.createContact({
      name: "Alan Turing",
      email: "alan@example.com",
    });
    // Catalog tools take top-level args (matching the validated bootstrap-proof contract).
    expect(execMock).toHaveBeenCalledWith(
      "create_person",
      expect.objectContaining({
        name: { firstName: "Alan", lastName: "Turing" },
        emails: { primaryEmail: "alan@example.com" },
      }),
    );
    // Negative: NOT wrapped in input
    const [, args] = execMock.mock.calls[0];
    expect(args).not.toHaveProperty("input");
    expect(out.id).toBe("p-3");
    expect(out.name).toBe("Alan Turing");
  });

  it("updateContact passes id + only patched fields at top level", async () => {
    setupExecResult({
      person: { id: "p-4", name: { firstName: "Edsger" } },
    });
    await twentyConnector.updateContact({
      id: "p-4",
      patch: { enrichmentStatus: "enriched", apolloPersonId: "ap-9" },
    });
    expect(execMock).toHaveBeenCalledWith(
      "update_person",
      expect.objectContaining({
        id: "p-4",
        enrichmentStatus: "enriched",
        apolloPersonId: "ap-9",
      }),
    );
    const [, args] = execMock.mock.calls[0];
    expect(args).not.toHaveProperty("input");
  });

  it("findContactByEmail filters on emails.primaryEmail + limit 1", async () => {
    setupExecResult({ people: [] });
    const out = await twentyConnector.findContactByEmail({ email: "no-match@example.com" });
    expect(execMock).toHaveBeenCalledWith("find_people", {
      filter: { "emails.primaryEmail": "no-match@example.com" },
      limit: 1,
    });
    expect(out).toBeNull();
  });

  it("findContactByEmail returns the first hit", async () => {
    setupExecResult({
      people: [{ id: "p-5", name: { firstName: "John" }, emails: { primaryEmail: "j@example.com" } }],
    });
    const out = await twentyConnector.findContactByEmail({ email: "j@example.com" });
    expect(out?.id).toBe("p-5");
  });
});

describe("twentyConnector — accounts", () => {
  it("searchAccounts maps Twenty Company rows to CrmAccount", async () => {
    setupExecResult({
      companies: [
        {
          id: "c-1",
          name: "Acme",
          domainName: { primaryLinkUrl: "https://acme.com" },
          inLists: ["customers"],
        },
      ],
    });
    const out = await twentyConnector.searchAccounts({ query: "acme" });
    expect(execMock).toHaveBeenCalledWith("find_companies", {
      filter: { searchName: "acme" },
      limit: 25,
    });
    expect(out[0]).toMatchObject({
      id: "c-1",
      name: "Acme",
      domainName: "https://acme.com",
      inLists: ["customers"],
    });
  });

  it("getAccount returns null when missing", async () => {
    setupExecResult({ company: null });
    const out = await twentyConnector.getAccount({ id: "missing" });
    expect(out).toBeNull();
  });

  it("createAccount maps name + domainName at TOP LEVEL", async () => {
    setupExecResult({
      company: {
        id: "c-2",
        name: "Initech",
        domainName: { primaryLinkUrl: "https://initech.com" },
      },
    });
    const out = await twentyConnector.createAccount({
      name: "Initech",
      domainName: "https://initech.com",
    });
    expect(execMock).toHaveBeenCalledWith(
      "create_company",
      expect.objectContaining({
        name: "Initech",
        domainName: { primaryLinkUrl: "https://initech.com" },
      }),
    );
    const [, args] = execMock.mock.calls[0];
    expect(args).not.toHaveProperty("input");
    expect(out.id).toBe("c-2");
  });

  it("updateAccount passes id + patched fields at top level", async () => {
    setupExecResult({ company: { id: "c-3", name: "Renamed" } });
    await twentyConnector.updateAccount({
      id: "c-3",
      patch: { name: "Renamed", apolloOrganizationId: "ao-2" },
    });
    expect(execMock).toHaveBeenCalledWith(
      "update_company",
      expect.objectContaining({
        id: "c-3",
        name: "Renamed",
        apolloOrganizationId: "ao-2",
      }),
    );
  });
});

describe("twentyConnector — lists / Views", () => {
  it("searchLists calls get_views (not find_views) + post-filters by name substring", async () => {
    setupExecResult({
      views: [
        { id: "v-1", name: "Leaders" },
        { id: "v-2", name: "Customers" },
        { id: "v-3", name: "Internal Leaders Group" },
      ],
    });
    const out = await twentyConnector.searchLists({ query: "leaders" });
    expect(execMock).toHaveBeenCalledWith("get_views", {});
    expect(out.map((l) => l.id)).toEqual(["v-1", "v-3"]);
  });

  it("getList calls get_views and selects by id (no find_one_view in catalog)", async () => {
    setupExecResult({
      views: [
        { id: "v-1", name: "Leaders" },
        { id: "v-2", name: "Customers" },
      ],
    });
    const out = await twentyConnector.getList({ id: "v-2" });
    expect(execMock).toHaveBeenCalledWith("get_views", {});
    expect(out?.name).toBe("Customers");
  });

  it("getList returns null when no view matches", async () => {
    setupExecResult({ views: [{ id: "v-1", name: "Other" }] });
    const out = await twentyConnector.getList({ id: "v-missing" });
    expect(out).toBeNull();
  });

  it("createList calls create_view then create_view_filter (not update_view_filter)", async () => {
    // 1. create_view -> { view: { id: "v-new" } }
    setupExecResult({ view: { id: "v-new", name: "New List" } });
    // 2. create_view_filter -> success (return value irrelevant; .catch(noop))
    setupExecResult({});

    const out = await twentyConnector.createList({
      slug: "new-list",
      name: "New List",
      objectType: "contact",
    });

    expect(execMock).toHaveBeenNthCalledWith(
      1,
      "create_view",
      expect.objectContaining({
        name: "New List",
        type: "table",
      }),
    );
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      "create_view_filter",
      expect.objectContaining({
        viewId: "v-new",
        fieldName: "inLists",
        operand: "contains",
        value: "new-list",
      }),
    );
    expect(out.id).toBe("v-new");
    expect(out.slug).toBe("new-list");
  });

  it("addListMember reads current inLists + appends + writes back via update_person at top level", async () => {
    // 1. getList -> getViews returns the matching view
    setupExecResult({ views: [{ id: "v-1", name: "Leaders" }] });
    // 2. find_one_person -> { person: { inLists: ["existing"] } }
    setupExecResult({ person: { id: "p-1", inLists: ["existing"] } });
    // 3. update_person -> success
    setupExecResult({ person: { id: "p-1", inLists: ["existing", "leaders"] } });

    await twentyConnector.addListMember({
      listId: "v-1",
      objectId: "p-1",
      objectType: "contact",
    });

    expect(execMock).toHaveBeenCalledTimes(3);
    expect(execMock).toHaveBeenLastCalledWith(
      "update_person",
      expect.objectContaining({ id: "p-1", inLists: ["existing", "leaders"] }),
    );
    const [, args] = execMock.mock.calls[2];
    expect(args).not.toHaveProperty("input");
  });

  it("addListMember is a no-op when the slug is already in inLists", async () => {
    setupExecResult({ views: [{ id: "v-1", name: "Leaders" }] });
    setupExecResult({ person: { id: "p-1", inLists: ["leaders"] } });

    await twentyConnector.addListMember({
      listId: "v-1",
      objectId: "p-1",
      objectType: "contact",
    });
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("removeListMember drops the slug when present", async () => {
    setupExecResult({ views: [{ id: "v-1", name: "Leaders" }] });
    setupExecResult({ person: { id: "p-2", inLists: ["leaders", "vip"] } });
    setupExecResult({ person: { id: "p-2" } });

    await twentyConnector.removeListMember({
      listId: "v-1",
      objectId: "p-2",
      objectType: "contact",
    });
    expect(execMock).toHaveBeenLastCalledWith(
      "update_person",
      expect.objectContaining({ id: "p-2", inLists: ["vip"] }),
    );
  });

  it("addListMember throws when the list doesn't exist", async () => {
    setupExecResult({ views: [] });
    await expect(
      twentyConnector.addListMember({
        listId: "v-missing",
        objectId: "p-1",
        objectType: "contact",
      }),
    ).rejects.toBeInstanceOf(TwentyMcpError);
  });

  it("createList for objectType=account preserves the caller's objectType in the return + queries get_object_metadata first", async () => {
    // Reset metadata cache before this test
    const { _setObjectMetadataIds } = await import("../twenty-connector");
    _setObjectMetadataIds(null);

    // 1. get_object_metadata returns Person + Company rows
    setupExecResult({
      objectMetadata: [
        { id: "obj-person", nameSingular: "person" },
        { id: "obj-company", nameSingular: "company" },
      ],
    });
    // 2. create_view succeeds
    setupExecResult({ view: { id: "v-acc", name: "Customers", objectMetadataId: "obj-company" } });
    // 3. create_view_filter
    setupExecResult({});

    const out = await twentyConnector.createList({
      slug: "customers",
      name: "Customers",
      objectType: "account",
    });

    expect(out.objectType).toBe("account");
    expect(out.id).toBe("v-acc");
    // create_view should carry the resolved metadataId
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      "create_view",
      expect.objectContaining({
        name: "Customers",
        objectMetadataId: "obj-company",
        type: "table",
      }),
    );

    _setObjectMetadataIds(null);
  });

  it("searchLists fails closed when objectType filter is requested but metadata cannot be loaded", async () => {
    const { _setObjectMetadataIds } = await import("../twenty-connector");
    _setObjectMetadataIds(null);

    // get_object_metadata returns malformed payload (no person/company)
    setupExecResult({ objectMetadata: [] });

    await expect(
      twentyConnector.searchLists({ query: "foo", objectType: "account" }),
    ).rejects.toThrow(/object metadata not available/);
    _setObjectMetadataIds(null);
  });

  it("searchLists with no objectType filter does not require metadata", async () => {
    const { _setObjectMetadataIds } = await import("../twenty-connector");
    _setObjectMetadataIds(null);

    setupExecResult({
      views: [
        { id: "v-1", name: "Leaders" },
        { id: "v-2", name: "Customers" },
      ],
    });
    const out = await twentyConnector.searchLists({ query: "" });
    expect(execMock).toHaveBeenCalledWith("get_views", {});
    expect(out.length).toBe(2);
  });
});
