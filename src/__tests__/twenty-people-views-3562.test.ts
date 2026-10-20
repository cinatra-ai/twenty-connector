// cinatra#3562: people lists are the person views Twenty's view picker shows,
// read completely (past get_views' ceiling of 100, from the REST metadata
// API), named as Twenty renders them, with members read through the view's
// own filter; every list call runs for the person running it.
//
// Hermetic: the host deps are fakes registered through ./deps, and `fetch` is
// stubbed with an in-memory Twenty that answers the MCP `execute_tool` POSTs
// and the REST GET. No network, no Twenty. The contract module is read as a
// namespace, so a name it does not export reads as undefined (a failed case,
// never a load failure).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as contract from "../twenty-tool-contract.mjs";

const C: any = contract;

const ROW = {
  id: "twenty-workspace",
  label: "Twenty",
  serverUrl: "https://crm.example.com/mcp",
  scope: "workspace",
  orgId: null,
  userId: null,
  enabled: true,
  allowedTools: null,
  allowedCatalogTools: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const PERSON_OBJ = "obj-person";
const COMPANY_OBJ = "obj-company";
const PERSON_INLISTS = "fld-person-inlists";
const COMPANY_INLISTS = "fld-company-inlists";
const FLD_JOB = "fld-person-jobtitle";
const FLD_CREATED = "fld-person-createdat";
const FLD_COMPANY_REL = "fld-person-company";

const pad = (n: number) => String(n).padStart(4, "0");

// ---------------------------------------------------------------------------
// The in-memory Twenty
// ---------------------------------------------------------------------------

type View = { id: string; name: string; type: string; objectMetadataId: string };
type Filter = { id: string; viewId: string; fieldMetadataId: string; operand: string; value: unknown };

function fakeTwenty() {
  const state = {
    personViews: [] as View[],
    companyViews: [] as View[],
    filters: [] as Filter[],
    query: {} as Record<string, { objectNameSingular?: string; filter: any; viewType?: string }>,
    people: [] as any[],
    companies: [] as any[],
    personFieldCount: 0,
    rest: { status: 200, body: undefined as unknown, fail: false, extra: [] as View[], drop: [] as string[] },
    onFilterRead: null as null | ((viewId: string, n: number) => void),
    filterReads: {} as Record<string, number>,
  };
  const requests: { method: string; url: string; tool?: string; args?: any }[] = [];

  function cond(rec: any, field: string, c: any): boolean {
    const v = rec[field];
    if ("containsIlike" in c) {
      const want = String(c.containsIlike).replace(/%/g, "").toLowerCase();
      return Array.isArray(v) && v.some((e: string) => e.toLowerCase().includes(want));
    }
    if ("ilike" in c) return String(v ?? "").toLowerCase().includes(String(c.ilike).replace(/%/g, "").toLowerCase());
    if ("eq" in c) return v === c.eq;
    throw new Error(`unsupported condition on ${field}`);
  }
  function matches(rec: any, filter: any): boolean {
    for (const [key, c] of Object.entries<any>(filter)) {
      if (key === "and") {
        if (!c.every((f: any) => matches(rec, f))) return false;
      } else if (key === "or") {
        if (!c.some((f: any) => matches(rec, f))) return false;
      } else if (!cond(rec, key, c)) return false;
    }
    return true;
  }
  function found(name: string, records: any[], count: number) {
    return { success: true, message: `Found ${records.length} ${name} records`, result: { records, count: String(count) } };
  }

  function answer(tool: string, args: any): any {
    if (tool === "get_views") {
      const list = args.objectNameSingular === "person" ? state.personViews : state.companyViews;
      return list.slice(0, Math.min(args.limit ?? 50, 100));
    }
    if (tool === "get_object_metadata") {
      const all = [
        { id: PERSON_OBJ, nameSingular: "person", labelSingular: "Person", labelPlural: "People" },
        { id: COMPANY_OBJ, nameSingular: "company", labelSingular: "Company", labelPlural: "Companies" },
      ];
      return args.id ? all.filter((o) => o.id === args.id) : all;
    }
    if (tool === "get_field_metadata") {
      if (args.id) {
        const types: Record<string, string> = { [FLD_JOB]: "TEXT", [FLD_CREATED]: "DATE_TIME", [FLD_COMPANY_REL]: "RELATION" };
        return types[args.id] ? [{ id: args.id, name: args.id, type: types[args.id] }] : [];
      }
      if (args.objectMetadataId === PERSON_OBJ) {
        const extra = Array.from({ length: state.personFieldCount }, (_, i) => ({ id: `fld-x-${i}`, name: `x${i}`, type: "TEXT" }));
        return [{ id: PERSON_INLISTS, name: "inLists", type: "ARRAY" }, ...extra];
      }
      return [{ id: COMPANY_INLISTS, name: "inLists", type: "ARRAY" }];
    }
    if (tool === "get_view_filters") {
      const n = (state.filterReads[args.viewId] = (state.filterReads[args.viewId] ?? 0) + 1);
      state.onFilterRead?.(args.viewId, n);
      return state.filters.filter((f) => f.viewId === args.viewId);
    }
    if (tool === "get_view_query_parameters") {
      const q = state.query[args.viewId];
      if (!q) return { success: false, message: "Failed", error: `View ${args.viewId} not found` };
      const view = state.personViews.find((v) => v.id === args.viewId);
      return { objectNameSingular: q.objectNameSingular ?? "person", filter: q.filter, orderBy: [], viewName: view?.name ?? "", viewType: q.viewType ?? view?.type ?? "TABLE" };
    }
    if (tool === "find_people" || tool === "find_companies") {
      const rows = tool === "find_people" ? state.people : state.companies;
      const { limit, offset, orderBy, ...filter } = args;
      void orderBy;
      const hit = rows.filter((r) => matches(r, filter)).sort((a, b) => (a.id < b.id ? -1 : 1));
      return found(tool === "find_people" ? "person" : "company", hit.slice(offset ?? 0, (offset ?? 0) + limit), hit.length);
    }
    if (tool === "find_one_person" || tool === "find_one_company") {
      const rows = tool === "find_one_person" ? state.people : state.companies;
      const rec = rows.find((r) => r.id === args.id);
      return found(tool === "find_one_person" ? "person" : "company", rec ? [rec] : [], rec ? 1 : 0);
    }
    if (tool === "update_person") {
      const rec = state.people.find((r) => r.id === args.id);
      Object.assign(rec, args);
      return { success: true, message: "Record updated", result: { id: args.id } };
    }
    return { success: false, message: "Failed", error: `Tool "${tool}" not found` };
  }

  const fetchMock = vi.fn(async (url: string, init: any) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      requests.push({ method, url });
      if (state.rest.fail) throw new Error("connect ECONNREFUSED");
      if (state.rest.status !== 200) return new Response("boom", { status: state.rest.status });
      const body =
        state.rest.body !== undefined
          ? state.rest.body
          : [...state.personViews, ...state.rest.extra].filter((v) => !state.rest.drop.includes(v.id));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    const rpc = JSON.parse(init.body);
    const tool = rpc.params.arguments.toolName;
    const args = rpc.params.arguments.arguments;
    requests.push({ method, url, tool, args });
    const result = { content: [{ type: "text", text: JSON.stringify(answer(tool, args)) }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  let n = 0;
  return {
    state,
    requests,
    fetchMock,
    personView(name: string, opts: { type?: string; slug?: string; filter?: any; objectMetadataId?: string } = {}) {
      const id = `pv-${pad((n += 1))}`;
      state.personViews.push({ id, name, type: opts.type ?? "TABLE", objectMetadataId: opts.objectMetadataId ?? PERSON_OBJ });
      if (opts.slug) {
        state.filters.push({ id: `f-${id}`, viewId: id, fieldMetadataId: PERSON_INLISTS, operand: "CONTAINS", value: opts.slug });
      }
      state.query[id] = { filter: opts.filter ?? (opts.slug ? { inLists: { containsIlike: `%${opts.slug}%` } } : {}) };
      return id;
    },
    companyView(name: string, slug?: string) {
      const id = `cv-${pad((n += 1))}`;
      state.companyViews.push({ id, name, type: "TABLE", objectMetadataId: COMPANY_OBJ });
      if (slug) state.filters.push({ id: `f-${id}`, viewId: id, fieldMetadataId: COMPANY_INLISTS, operand: "CONTAINS", value: slug });
      return id;
    },
    person(extra: any = {}) {
      const id = `p-${pad((n += 1))}`;
      state.people.push({ id, name: { firstName: "Pat", lastName: `Doe${n}` }, inLists: [], ...extra });
      return id;
    },
    company(inLists: string[]) {
      const id = `c-${pad((n += 1))}`;
      state.companies.push({ id, name: `Co ${n}`, inLists });
      return id;
    },
    tools(tool: string) {
      return requests.filter((r) => r.tool === tool).map((r) => r.args);
    },
    gets() {
      return requests.filter((r) => r.method === "GET");
    },
  };
}

let t: ReturnType<typeof fakeTwenty>;
let resolveBearer: ReturnType<typeof vi.fn>;

async function load(row: any = ROW): Promise<any> {
  vi.resetModules();
  const deps: any = await import("../deps");
  resolveBearer = vi.fn(async () => "bearer-1");
  deps.registerTwentyConnector({
    getServerById: (id: string) => (id === row.id ? row : null),
    listServers: () => [row],
    resolveBearer,
    saveTwentyConnectionAction: async () => undefined,
    disconnectTwentyConnectionAction: async () => undefined,
    resolveViewerContext: async () => ({ isAdmin: false, userId: null }),
    isConnectionServiceReady: () => true,
    isPrivateUrl: () => false,
  });
  return (await import("../twenty-connector")).twentyConnector;
}

beforeEach(() => {
  t = fakeTwenty();
  vi.stubGlobal("fetch", t.fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const errOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected a refusal");
};

// ---------------------------------------------------------------------------
// T1-T6: the contract module
// ---------------------------------------------------------------------------

describe("T1 projections and builders", () => {
  it("a view carries its type and objectMetadataId; a missing one throws", () => {
    const out = C.readArrayAnswer("get_views", [{ id: "v1", name: "All", type: "TABLE", objectMetadataId: "o1", extra: 1 }]);
    expect(out).toEqual([{ id: "v1", name: "All", type: "TABLE", objectMetadataId: "o1" }]);
    expect(() => C.readArrayAnswer("get_views", [{ id: "v1", name: "All", objectMetadataId: "o1" }])).toThrow(/type is absent/);
    expect(() => C.readArrayAnswer("get_views", [{ id: "v1", name: "All", type: "TABLE" }])).toThrow(/objectMetadataId/);
  });

  it("an object carries its labels; a view filter its view, a JSON value (a copy) and its optional fields", () => {
    expect(C.readArrayAnswer("get_object_metadata", [{ id: "o", nameSingular: "person", labelSingular: "Person", labelPlural: "People" }])).toEqual([
      { id: "o", nameSingular: "person", labelSingular: "Person", labelPlural: "People" },
    ]);
    expect(() => C.readArrayAnswer("get_object_metadata", [{ id: "o", nameSingular: "person", labelSingular: "Person" }])).toThrow(/labelPlural/);
    const value = { isCurrentWorkspaceMemberSelected: false, selectedRecordIds: ["a"] };
    const [f] = C.readArrayAnswer("get_view_filters", [
      { id: "f", viewId: "v", fieldMetadataId: "fm", operand: "IS", value, subFieldName: null, positionInViewFilterGroup: 2 },
    ]);
    expect(f).toEqual({ id: "f", viewId: "v", fieldMetadataId: "fm", operand: "IS", value, subFieldName: null, positionInViewFilterGroup: 2 });
    expect(f.value).not.toBe(value);
    expect(() => C.readArrayAnswer("get_view_filters", [{ id: "f", fieldMetadataId: "fm", operand: "IS", value: "x" }])).toThrow(/viewId/);
    expect(() => C.readArrayAnswer("get_view_filters", [{ id: "f", viewId: "v", fieldMetadataId: "fm", operand: "IS", value: null }])).toThrow(/value/);
    expect(() =>
      C.readArrayAnswer("get_view_filters", [{ id: "f", viewId: "v", fieldMetadataId: "fm", operand: "IS", value: "x", positionInViewFilterGroup: "1" }]),
    ).toThrow(/positionInViewFilterGroup/);
  });

  it("readViewQuery projects objectNameSingular, filter and viewType; a filter that is not an object throws", () => {
    expect(C.readViewQuery({ objectNameSingular: "person", filter: { a: 1 }, orderBy: [], viewName: "x", viewType: "TABLE" })).toEqual({
      objectNameSingular: "person",
      filter: { a: 1 },
      viewType: "TABLE",
    });
    expect(() => C.readViewQuery({ objectNameSingular: "person", filter: [], viewType: "TABLE" })).toThrow(/filter/);
    expect(() => C.readViewQuery({ objectNameSingular: "person", filter: {} })).toThrow(/viewType/);
  });

  it("the new builders give exactly their arguments", () => {
    expect(C.getViewQueryParametersArgs("v")).toEqual({ viewId: "v" });
    expect(C.getObjectMetadataByIdArgs("o")).toEqual({ id: "o", limit: 1 });
    expect(C.getFieldMetadataByIdArgs("f")).toEqual({ id: "f", limit: 1 });
  });

  it("readOneById wants exactly the one requested entry; readViewFilters refuses another view's filter", () => {
    const o = { id: "o", nameSingular: "person", labelSingular: "P", labelPlural: "Ps" };
    expect(C.readOneById("get_object_metadata", [o], "o")).toEqual(o);
    expect(() => C.readOneById("get_object_metadata", [], "o")).toThrow(/exactly the one entry/);
    expect(() => C.readOneById("get_object_metadata", [{ ...o, id: "p" }], "o")).toThrow(/exactly the one entry/);
    expect(() => C.readOneById("get_object_metadata", [o, { ...o, id: "p" }], "o")).toThrow(/exactly the one entry/);
    const f = { id: "f", viewId: "v", fieldMetadataId: "fm", operand: "IS", value: "x" };
    expect(C.readViewFilters([f], "v")).toEqual([f]);
    expect(() => C.readViewFilters([f], "w")).toThrow(/belongs to view/);
  });
});

describe("T2 isListedViewType", () => {
  it("lists TABLE, KANBAN and CALENDAR only, case-sensitively", () => {
    expect(["TABLE", "KANBAN", "CALENDAR", "FIELDS_WIDGET", "TABLE_WIDGET", "table", 7, null].map((v) => C.isListedViewType(v))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("T3 renderViewName", () => {
  const labels = { labelSingular: "Person", labelPlural: "People" };
  it("renders the placeholders as Twenty's front end does and leaves blank names out", () => {
    expect(C.renderViewName("All {objectLabelPlural}", labels)).toBe("All People");
    expect(C.renderViewName("  ", labels)).toBeNull();
    expect(C.renderViewName("VIP {2026}", labels)).toBe("VIP {2026}");
    expect(C.renderViewName("{objectLabelSingular} / {objectLabelPlural}", labels)).toBe("Person / People");
    expect(C.renderViewName("{objectLabelPlural} {objectLabelPlural}", labels)).toBe("People {objectLabelPlural}");
    expect(C.renderViewName("All {objectLabelPlural}", { labelSingular: "Person", labelPlural: " " })).toBeNull();
    expect(C.renderViewName("Mine", null)).toBe("Mine");
  });
});

describe("T4 memberFindFilter", () => {
  it("{} stays {}, an object is wrapped in a copy, a non-object throws", () => {
    expect(C.memberFindFilter({})).toEqual({});
    const f = { jobTitle: { ilike: "%x%" } };
    const out = C.memberFindFilter(f);
    expect(out).toEqual({ and: [f] });
    expect(out.and[0]).not.toBe(f);
    for (const odd of [null, [], "x", 7]) expect(() => C.memberFindFilter(odd)).toThrow();
  });
});

describe("T5 viewerDependence", () => {
  const f = (operand: string, value: unknown, fieldMetadataId = FLD_JOB) => ({ id: `f-${operand}`, viewId: "v", fieldMetadataId, operand, value });
  const types: Record<string, string> = { [FLD_JOB]: "TEXT", [FLD_CREATED]: "DATE_TIME", [FLD_COMPANY_REL]: "RELATION" };
  const keyOf = async (filters: any[]) => {
    const fieldTypeOf = vi.fn(async (id: string) => types[id]);
    const out = await C.viewerDependence(filters, fieldTypeOf);
    return { key: out?.key ?? null, fieldTypeOf };
  };

  it("V1: the current workspace member, as an object and as a JSON string", async () => {
    expect((await keyOf([f("IS", { isCurrentWorkspaceMemberSelected: true, selectedRecordIds: [] }, FLD_COMPANY_REL)])).key).toBe(
      "view-filter-viewer-dependent",
    );
    expect((await keyOf([f("IS", JSON.stringify({ isCurrentWorkspaceMemberSelected: true }), FLD_COMPANY_REL)])).key).toBe(
      "view-filter-viewer-dependent",
    );
  });

  it("V3: a value that is not text where the operand expects one; none for IS_EMPTY", async () => {
    expect((await keyOf([f("IS", 7)])).key).toBe("view-filter-value-not-text");
    expect((await keyOf([f("IS_EMPTY", 7)])).key).toBeNull();
  });

  it("V2 (a)-(d), each with its negative", async () => {
    expect((await keyOf([f("IS_TODAY", "")])).key).toBe("view-filter-time-zone");
    expect((await keyOf([f("CONTAINS", "today")])).key).toBeNull();
    expect((await keyOf([f("IS_RELATIVE", "PAST_1_DAY")])).key).toBe("view-filter-time-zone");
    expect((await keyOf([f("IS_RELATIVE", "PAST_1_DAY;;Europe/Paris;;")])).key).toBeNull();
    // The zone is the part right after the first ";;" (Twenty's parse); a first day of the week alone names none.
    expect((await keyOf([f("IS_RELATIVE", "PAST_1_DAY;;;;MONDAY;;")])).key).toBe("view-filter-time-zone");
    expect((await keyOf([f("IS_RELATIVE", "NEXT_2_WEEK;;Europe/Paris;;MONDAY;;")])).key).toBeNull();
    expect((await keyOf([f("IS", "2026-01-01", FLD_CREATED)])).key).toBe("view-filter-time-zone");
    expect((await keyOf([f("IS", "x", FLD_JOB)])).key).toBeNull();
    expect((await keyOf([f("IS", "x", FLD_COMPANY_REL)])).key).toBe("view-filter-time-zone");
    expect((await keyOf([f("IS", JSON.stringify({ selectedRecordIds: ["c1"] }), FLD_COMPANY_REL)])).key).toBeNull();
  });

  it("fieldTypeOf is called only for operand IS", async () => {
    const { fieldTypeOf } = await keyOf([f("CONTAINS", "a"), f("IS_EMPTY", ""), f("IS", "x"), f("NOT_CONTAINS", "b")]);
    expect(fieldTypeOf.mock.calls).toEqual([[FLD_JOB]]);
  });
});

describe("T6 readMemberIds", () => {
  const rec = (i: number) => ({ id: `m-${pad(i)}` });
  const pageOf = (ids: number[], count: number | string) => ({ records: ids.map(rec), count: String(count) });
  const reader = (pages: (p: { limit: number; offset: number }, call: number) => any) => {
    let call = 0;
    const fn = vi.fn(async (p: { limit: number; offset: number }) => pages(p, (call += 1)));
    return fn;
  };
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  const total = (n: number) => reader(({ limit, offset }) => pageOf(range(offset, Math.min(n, offset + limit)), n));

  it("want 0 answers [] with no call", async () => {
    const fn = total(5);
    expect(await C.readMemberIds(fn, { want: 0, toolName: "find_people" })).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("one page, read twice", async () => {
    const fn = total(3);
    expect(await C.readMemberIds(fn, { toolName: "find_people" })).toEqual(["m-0000", "m-0001", "m-0002"]);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([{ limit: 100, offset: 0 }, { limit: 100, offset: 0 }]);
  });

  it("an exact call count: 2 x ceil(target / pageSize), and limits that shrink to the target", async () => {
    const fn = total(5);
    expect(await C.readMemberIds(fn, { pageSize: 2, toolName: "find_people" })).toHaveLength(5);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([
      { limit: 2, offset: 0 },
      { limit: 2, offset: 2 },
      { limit: 1, offset: 4 },
      { limit: 2, offset: 0 },
      { limit: 2, offset: 2 },
      { limit: 1, offset: 4 },
    ]);
    const capped = total(10);
    expect(await C.readMemberIds(capped, { want: 3, pageSize: 2, toolName: "find_people" })).toEqual(["m-0000", "m-0001", "m-0002"]);
    expect(capped).toHaveBeenCalledTimes(4);
  });

  it("a page of 30 records under a count of 29 refuses", async () => {
    const fn = reader(() => pageOf(range(0, 30), 29));
    await expect(C.readMemberIds(fn, { toolName: "find_people" })).rejects.toThrow(/view-members-changed/);
  });

  it("a repeated id refuses", async () => {
    const fn = reader(({ offset }) => pageOf(offset === 0 ? [0, 1] : [1, 2], 4));
    await expect(C.readMemberIds(fn, { pageSize: 2, toolName: "find_people" })).rejects.toThrow(/view-members-changed: record m-0001/);
  });

  it("more than VIEW_MEMBERS_MAX members refuses after the first page", async () => {
    expect(C.VIEW_MEMBERS_MAX).toBe(100000);
    const fn = reader(() => pageOf(range(0, 100), 100001));
    await expect(C.readMemberIds(fn, { toolName: "find_people" })).rejects.toThrow(/view-members-over-max/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a second pass that differs refuses; no partial list", async () => {
    const fn = reader(({ limit, offset }, call) => (call === 1 ? pageOf([0, 1], 2) : pageOf([0, 2], 2)));
    await expect(C.readMemberIds(fn, { toolName: "find_people" })).rejects.toThrow(/view-members-changed: two full reads/);
    const moved = reader((_, call) => (call === 1 ? pageOf([0, 1], 2) : pageOf([0, 1, 2], 3)));
    await expect(C.readMemberIds(moved, { toolName: "find_people" })).rejects.toThrow(/view-members-changed/);
  });

  it("canonicalJson sorts keys at every depth", () => {
    expect(C.canonicalJson({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
    expect(C.canonicalJson({ a: 1, b: 2 })).toBe(C.canonicalJson({ b: 2, a: 1 }));
  });
});

// ---------------------------------------------------------------------------
// T7-T12: the connector, end to end through the transport
// ---------------------------------------------------------------------------

describe("T7 searchLists lists every people view Twenty's picker shows", () => {
  it("a UI-made view without an inLists filter is listed; FIELDS_WIDGET is left out; the template renders", async () => {
    const all = t.personView("All {objectLabelPlural}");
    const ui = t.personView("Engineers");
    t.personView("Person Record Page Fields", { type: "FIELDS_WIDGET" });
    const tagged = t.personView("Q4 Leaders", { slug: "q4-leaders" });
    const kanban = t.personView("Pipeline", { type: "KANBAN" });
    const out = await (await load()).searchLists({ query: "", objectType: "contact" });
    expect(out).toEqual([
      { id: all, slug: "", name: "All People", objectType: "contact" },
      { id: ui, slug: "", name: "Engineers", objectType: "contact" },
      { id: tagged, slug: "q4-leaders", name: "Q4 Leaders", objectType: "contact" },
      { id: kanban, slug: "", name: "Pipeline", objectType: "contact" },
    ]);
    expect(await (await load()).searchLists({ query: "PEOPLE", objectType: "contact" })).toEqual([out[0]]);
  });

  it("the query is applied before the slug read: only the views kept have their filters read", async () => {
    const leaders = t.personView("Q4 Leaders", { slug: "q4-leaders" });
    t.personView("Engineers", { slug: "engineers" });
    const out = await (await load()).searchLists({ query: " lead ", objectType: "contact" });
    expect(out).toEqual([{ id: leaders, slug: "q4-leaders", name: "Q4 Leaders", objectType: "contact" }]);
    expect(t.tools("get_view_filters")).toEqual([{ viewId: leaders }]);
    expect(t.tools("get_field_metadata")).toHaveLength(1);
  });

  it("two objectMetadataIds refuse as view-object-mismatch", async () => {
    t.personView("A");
    t.personView("B", { objectMetadataId: COMPANY_OBJ });
    await expect((await load()).searchLists({ query: "", objectType: "contact" })).rejects.toThrow(/twenty-connector: view-object-mismatch/);
  });

  it("a get_field_metadata answer of 100 fields refuses as list-field-at-ceiling", async () => {
    t.personView("A");
    t.state.personFieldCount = 99;
    await expect((await load()).searchLists({ query: "", objectType: "contact" })).rejects.toThrow(/twenty-connector: list-field-at-ceiling/);
  });

  it("past the ceiling: get_views answers 100, the REST read 101, and all 101 are listed", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => t.personView(`View ${i}`));
    const late = `pv-late`;
    t.state.rest.extra = [{ id: late, name: "Late People", type: "TABLE", objectMetadataId: PERSON_OBJ }];
    const out = await (await load()).searchLists({ query: "", objectType: "contact" });
    expect(out).toHaveLength(101);
    expect(out.map((l: any) => l.id)).toEqual([...ids, late]);
    expect(out[100]).toEqual({ id: late, slug: "", name: "Late People", objectType: "contact" });
    const gets = t.gets();
    expect(gets.map((g) => g.url)).toEqual([`https://crm.example.com/rest/metadata/views?objectMetadataId=${PERSON_OBJ}`]);
    const getInit = (t.fetchMock.mock.calls.find((c: any[]) => (c[1]?.method ?? "GET") === "GET") as any[])[1];
    expect(getInit.headers.accept).toBe("application/json");
    expect(getInit.headers.authorization).toBe("Bearer bearer-1");
    const restIndex = t.fetchMock.mock.calls.findIndex((c: any[]) => (c[1]?.method ?? "GET") === "GET");
    expect(resolveBearer.mock.calls[restIndex]).toEqual([ROW, { forPerson: true }]);
  });

  it("99 views: no REST request is made", async () => {
    for (let i = 0; i < 99; i++) t.personView(`View ${i}`);
    expect(await (await load()).searchLists({ query: "", objectType: "contact" })).toHaveLength(99);
    expect(t.gets()).toEqual([]);
  });

  it("every failed REST read refuses by name and never answers a shorter list", async () => {
    for (let i = 0; i < 100; i++) t.personView(`View ${i}`);
    const run = async () => (await load()).searchLists({ query: "", objectType: "contact" });
    t.state.rest.status = 500;
    await expect(run()).rejects.toThrow(/twenty-connector: views-rest-failed: upstream HTTP 500/);
    t.state.rest.status = 200;
    t.state.rest.body = {};
    await expect(run()).rejects.toThrow(/twenty-connector: views-rest-failed: the REST views answer \(HTTP 200\) is not a JSON array/);
    t.state.rest.body = undefined;
    t.state.rest.fail = true;
    await expect(run()).rejects.toThrow(/twenty-connector: views-rest-failed/);
    t.state.rest.fail = false;
    t.state.rest.extra = [{ id: "pv-other", name: "Other", type: "TABLE", objectMetadataId: COMPANY_OBJ }];
    await expect(run()).rejects.toThrow(/twenty-connector: view-object-mismatch/);
    t.state.rest.extra = [];
    t.state.rest.drop = [t.state.personViews[42].id];
    await expect(run()).rejects.toThrow(/twenty-connector: view-changed-during-read/);
    t.state.rest.drop = [];
    await expect((await load({ ...ROW, serverUrl: "https://crm.example.com/api" })).searchLists({ query: "", objectType: "contact" })).rejects.toThrow(
      /twenty-connector: views-rest-base-unknown/,
    );
  });
});

describe("T8 getList", () => {
  it("a person UI view resolves; a view the picker does not show answers null", async () => {
    const ui = t.personView("Engineers");
    const widget = t.personView("Fields", { type: "FIELDS_WIDGET" });
    const connector = await load();
    expect(await connector.getList({ id: ui })).toEqual({ id: ui, slug: "", name: "Engineers", objectType: "contact" });
    expect(await connector.getList({ id: widget })).toBeNull();
  });

  it("a company id is read on the company road (raw name, slug)", async () => {
    t.personView("Engineers");
    const cv = t.companyView("Targets", "targets");
    expect(await (await load()).getList({ id: cv })).toEqual({ id: cv, slug: "targets", name: "Targets", objectType: "account" });
    expect(t.tools("get_views").map((a) => a.objectNameSingular)).toEqual(["person", "company"]);
  });

  it("the 101st person view resolves", async () => {
    for (let i = 0; i < 100; i++) t.personView(`View ${i}`);
    t.state.rest.extra = [{ id: "pv-late", name: "Late", type: "TABLE", objectMetadataId: PERSON_OBJ }];
    expect(await (await load()).getList({ id: "pv-late" })).toEqual({ id: "pv-late", slug: "", name: "Late", objectType: "contact" });
  });
});

describe("T9 getListMembers reads the view's own filter", () => {
  it("a slug view narrowed with a second filter answers only the records matching both", async () => {
    t.state.filters.push({ id: "f-title", viewId: "pv-0001", fieldMetadataId: FLD_JOB, operand: "CONTAINS", value: "cto" });
    const view = t.personView("Leaders", {
      slug: "leaders",
      filter: { and: [{ inLists: { containsIlike: "%leaders%" } }, { jobTitle: { ilike: "%cto%" } }] },
    });
    expect(view).toBe("pv-0001");
    const a = t.person({ inLists: ["leaders"], jobTitle: "CTO" });
    t.person({ inLists: ["leaders"], jobTitle: "Engineer" });
    t.person({ inLists: [], jobTitle: "CTO" });
    const out = await (await load()).getListMembers({ listId: view });
    expect(out).toEqual({ contactIds: [a], accountIds: [] });
    for (const args of t.tools("find_people")) expect(args.and).toEqual([{ and: [{ inLists: { containsIlike: "%leaders%" } }, { jobTitle: { ilike: "%cto%" } }] }]);
    expect(t.tools("find_people")).toHaveLength(2);
  });

  it("a UI view with no filter answers every person, read twice", async () => {
    const view = t.personView("All {objectLabelPlural}");
    const ids = Array.from({ length: 3 }, () => t.person());
    expect((await (await load()).getListMembers({ listId: view })).contactIds).toEqual(ids);
    expect(t.tools("find_people")).toEqual([{ limit: 100 }, { limit: 100 }]);
  });

  it("a view the picker does not show refuses as view-not-listed", async () => {
    const widget = t.personView("Fields", { type: "FIELDS_WIDGET" });
    await expect((await load()).getListMembers({ listId: widget })).rejects.toThrow(/twenty-connector: view-not-listed/);
    expect(t.tools("find_people")).toEqual([]);
  });

  it("each viewer-dependent filter refuses by its key, and no find_people call is made", async () => {
    const cases: [string, unknown, string, string][] = [
      ["IS", { isCurrentWorkspaceMemberSelected: true, selectedRecordIds: [] }, FLD_COMPANY_REL, "view-filter-viewer-dependent"],
      ["IS", 7, FLD_JOB, "view-filter-value-not-text"],
      ["IS_TODAY", "", FLD_CREATED, "view-filter-time-zone"],
      ["IS", "2026-01-01", FLD_CREATED, "view-filter-time-zone"],
    ];
    for (const [operand, value, field, key] of cases) {
      t = fakeTwenty();
      vi.stubGlobal("fetch", t.fetchMock);
      const view = t.personView("Mine");
      t.state.filters.push({ id: "f-1", viewId: view, fieldMetadataId: field, operand, value });
      const err = await errOf((await load()).getListMembers({ listId: view }));
      expect(err.message).toMatch(new RegExp(`^twenty-connector: ${key}: view ${view}`));
      expect(t.tools("find_people")).toEqual([]);
      expect(t.tools("get_view_query_parameters")).toEqual([]);
    }
  });

  it("a query of another object refuses as view-object-mismatch", async () => {
    const view = t.personView("Mine");
    t.state.query[view].objectNameSingular = "company";
    await expect((await load()).getListMembers({ listId: view })).rejects.toThrow(/twenty-connector: view-object-mismatch/);
    expect(t.tools("find_people")).toEqual([]);
  });

  it("filters that change between the two reads refuse as view-changed-during-read", async () => {
    const view = t.personView("Leaders", { slug: "leaders" });
    t.person({ inLists: ["leaders"] });
    t.state.onFilterRead = (viewId, n) => {
      if (viewId === view && n === 2) t.state.filters.find((f) => f.viewId === view)!.value = "others";
    };
    await expect((await load()).getListMembers({ listId: view })).rejects.toThrow(/twenty-connector: view-changed-during-read/);
    expect(t.tools("find_people")).toEqual([]);
  });

  it("the members of the 101st person view are read", async () => {
    for (let i = 0; i < 100; i++) t.personView(`View ${i}`);
    t.state.rest.extra = [{ id: "pv-late", name: "Late", type: "TABLE", objectMetadataId: PERSON_OBJ }];
    t.state.query["pv-late"] = { filter: { jobTitle: { ilike: "%cto%" } } };
    const cto = t.person({ jobTitle: "CTO" });
    t.person({ jobTitle: "Engineer" });
    expect(await (await load()).getListMembers({ listId: "pv-late" })).toEqual({ contactIds: [cto], accountIds: [] });
  });

  it("the company road is unchanged: the slug membership", async () => {
    const cv = t.companyView("Targets", "targets");
    const a = t.company(["targets"]);
    t.company(["other"]);
    expect(await (await load()).getListMembers({ listId: cv })).toEqual({ contactIds: [], accountIds: [a] });
    expect(t.tools("find_companies")[0].inLists).toEqual({ containsIlike: "targets" });
  });
});

describe("T10 writes on a people view without a slug", () => {
  it("addListMember and removeListMember refuse as list-without-slug and write nothing", async () => {
    const view = t.personView("Engineers");
    const p = t.person();
    const connector = await load();
    for (const call of [connector.addListMember.bind(connector), connector.removeListMember.bind(connector)]) {
      const err: any = await errOf(call({ listId: view, objectId: p, objectType: "contact" }));
      expect(err.message).toMatch(/^twenty-connector: list-without-slug/);
      expect(err.code).toBe(-32602);
    }
    expect(t.tools("update_person")).toEqual([]);
  });

  it("a tagged people view still takes a member", async () => {
    const view = t.personView("Leaders", { slug: "leaders" });
    const p = t.person({ inLists: ["other"] });
    await (await load()).addListMember({ listId: view, objectId: p, objectType: "contact" });
    expect(t.tools("update_person")).toEqual([{ id: p, inLists: ["other", "leaders"] }]);
  });
});

describe("T11 the list methods run for the person; every other call keeps the worker gate", () => {
  it("every call of the six list methods reaches resolveBearer as (row, { forPerson: true })", async () => {
    const view = t.personView("Leaders", { slug: "leaders" });
    const cv = t.companyView("Targets", "targets");
    const p = t.person({ inLists: ["leaders"] });
    t.company(["targets"]);
    const connector = await load();
    await connector.searchLists({ query: "" });
    await connector.getList({ id: view });
    await connector.getList({ id: cv });
    await connector.getListMembers({ listId: view });
    await connector.getListMembers({ listId: cv });
    await connector.addListMember({ listId: view, objectId: p, objectType: "contact" });
    await connector.removeListMember({ listId: view, objectId: p, objectType: "contact" });
    await connector.createList({ name: "New Leaders", slug: "", objectType: "contact" }).catch(() => undefined);
    expect(resolveBearer.mock.calls.length).toBeGreaterThan(10);
    expect(resolveBearer.mock.calls.length).toBe(t.fetchMock.mock.calls.length);
    for (const c of resolveBearer.mock.calls) expect(c).toEqual([ROW, { forPerson: true }]);
  });

  it("the past-ceiling REST read is a person call too", async () => {
    for (let i = 0; i < 100; i++) t.personView(`View ${i}`);
    await (await load()).searchLists({ query: "", objectType: "contact" });
    expect(t.gets()).toHaveLength(1);
    for (const c of resolveBearer.mock.calls) expect(c).toEqual([ROW, { forPerson: true }]);
  });

  it("contacts and accounts keep the worker call: exactly [row]", async () => {
    const p = t.person({ emails: { primaryEmail: "a@example.com" } });
    const c = t.company([]);
    const connector = await load();
    await connector.getContact({ id: p });
    await connector.getAccount({ id: c });
    await connector.searchContacts({ query: "Pat" }).catch(() => undefined);
    await connector.searchAccounts({ query: "Co" }).catch(() => undefined);
    await connector.updateContact({ id: p, patch: { title: "CTO" } }).catch(() => undefined);
    expect(resolveBearer.mock.calls.length).toBeGreaterThanOrEqual(4);
    for (const call of resolveBearer.mock.calls) expect(call).toEqual([ROW]);
  });
});

describe("T12 the host's refusals reach the caller unchanged, before any request", () => {
  it.each([
    "twenty-connection-no-person: Cinatra could not tell who is running this step, so its Twenty CRM connection was not used. Sign in again and reopen the step.",
    "twenty-connection-not-shared: Cinatra's Twenty CRM connection is not shared with you. The person who connected it can share it on its Sharing tab.",
    "twenty-connection-unusable: Cinatra's Twenty CRM connection cannot be used right now (no connection, no key, or it changed during the call). The person who connected it can reconnect it.",
  ])("%s", async (message) => {
    t.personView("Engineers");
    const connector = await load();
    const refusal = Object.assign(new Error(message), { status: 403 });
    resolveBearer.mockRejectedValue(refusal);
    const err = await errOf(connector.searchLists({ query: "", objectType: "contact" }));
    expect(err).toBe(refusal);
    expect(err.message).toBe(message);
    expect(t.fetchMock).not.toHaveBeenCalled();
  });
});
