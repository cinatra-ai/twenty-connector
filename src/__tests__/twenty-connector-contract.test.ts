// The connector against Twenty's tool contract (twenty-connector#83).
//
// Only the transport (`executeTwentyMcpTool`) is replaced: by a small
// in-memory Twenty that answers in the shapes the committed fixtures record
// (scripts/twenty-bootstrap/fixtures/twenty-tool-answers.json) — record tools
// `{ success, message, result }`, view and metadata tools bare, writes
// `result: { id }`, failures `{ success: false }` as ordinary content. The
// connector reads every answer through the REAL readers of
// src/twenty-mcp-call.ts. Each case loads the connector afresh, so the
// module's caches never leak between cases.

import { beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.hoisted(() => vi.fn());

vi.mock("../twenty-mcp-call", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, executeTwentyMcpTool: exec };
});

// The committed fixtures, loaded through the test runner (a JSON module; the specifier stays a plain string).
const FIXTURE_SPEC = "../../scripts/twenty-bootstrap/fixtures/twenty-tool-answers.json";
const FIXTURES: any = (await import(/* @vite-ignore */ FIXTURE_SPEC)).default;

const OBJ: any = { person: "obj-person", company: "obj-company" };
const FIELD: any = { person: "fld-person-inlists", company: "fld-company-inlists" };
const FIND: any = { find_people: "person", find_companies: "company", find_one_person: "person", find_one_company: "company" };
const WRITE: any = { create_person: "person", create_company: "company", update_person: "person", update_company: "company" };

// A live Twenty 2.7.3 sends a find page's count as a STRING and every record answer with recordReferences
// (the live proof's steps 08 and 08r): this fake answers in those live shapes.
function found(objectName: string, records: any[], count: number) {
  return {
    success: true,
    message: `Found ${records.length} ${objectName} records`,
    result: { records, count: String(count) },
    recordReferences: records.map((r) => ({ objectNameSingular: objectName, recordId: r?.id, displayName: "x" })),
  };
}
function written(objectName: string, id: string, verb = "created") {
  return {
    success: true,
    message: `Record ${verb} successfully in ${objectName}`,
    result: { id },
    recordReferences: [{ objectNameSingular: objectName, recordId: id, displayName: "x" }],
  };
}
function failed(tool: string, error: string) {
  return { success: false, message: `Failed to execute ${tool}`, error };
}

/** An in-memory Twenty answering execute_tool calls in the recorded shapes. */
function fakeTwenty() {
  let n = 0;
  const nextId = (p: string) => `${p}-${String((n += 1)).padStart(4, "0")}`;
  const state: any = { person: [], company: [], views: [], filters: [], fail: {} as Record<string, string>, failReRead: false, oddRecord: undefined, oddEntry: {} as Record<string, unknown>, oddAnswer: {} as Record<string, unknown> };

  function matches(rec: any, filter: any): boolean {
    for (const [key, cond] of Object.entries<any>(filter)) {
      if (key === "or") {
        if (!cond.some((f: any) => matches(rec, f))) return false;
      } else if (key === "inLists") {
        const want = String(cond.containsIlike ?? "").toLowerCase();
        if (!("containsIlike" in cond)) throw new Error(`Operator "${Object.keys(cond)[0]}" is not supported`);
        if (!(rec.inLists ?? []).some((e: string) => e.toLowerCase() === want)) return false;
      } else if (key === "id") {
        if (rec.id !== cond.eq) return false;
      } else if (key === "emails") {
        if (rec.emails?.primaryEmail !== cond.primaryEmail?.eq) return false;
      } else if (key === "name") {
        const like = (v: any, c: any) => String(v ?? "").toLowerCase().includes(String(c.ilike).replace(/%/g, "").toLowerCase());
        if (cond.ilike !== undefined && !like(rec.name, cond)) return false;
        if (cond.firstName && !like(rec.name?.firstName, cond.firstName)) return false;
        if (cond.lastName && !like(rec.name?.lastName, cond.lastName)) return false;
      } else {
        throw new Error(`Field "${key}" not found`);
      }
    }
    return true;
  }

  // A bare-array answer with one malformed entry put first (state.oddEntry[tool]), as a broken Twenty would send it.
  function answer(tool: string, args: any): any {
    // A whole answer replaced (state.oddAnswer[tool]), as a broken Twenty would send it.
    if (tool in state.oddAnswer) return state.oddAnswer[tool];
    const out = answerOf(tool, args);
    return tool in state.oddEntry && Array.isArray(out) ? [state.oddEntry[tool], ...out] : out;
  }

  function answerOf(tool: string, args: any): any {
    if (state.fail[tool]) return failed(tool, state.fail[tool]);
    if (tool === "get_object_metadata") {
      return [
        { id: "obj-opportunity", nameSingular: "opportunity" },
        { id: OBJ.person, nameSingular: "person" },
        { id: OBJ.company, nameSingular: "company" },
      ];
    }
    if (tool === "get_field_metadata") {
      const obj = args.objectMetadataId === OBJ.person ? "person" : "company";
      return [{ id: `fld-${obj}-name`, name: "name", type: "FULL_NAME" }, { id: FIELD[obj], name: "inLists", type: "ARRAY" }];
    }
    if (tool === "get_views") {
      const objId = args.objectNameSingular ? OBJ[args.objectNameSingular] : null;
      return state.views
        .filter((v: any) => !objId || v.objectMetadataId === objId)
        .slice(0, args.limit ?? 50)
        .map((v: any) => ({ id: v.id, name: v.name, objectMetadataId: v.objectMetadataId, type: "TABLE" }));
    }
    if (tool === "get_view_filters") return state.filters.filter((f: any) => f.viewId === args.viewId);
    if (tool === "create_view") {
      if (!OBJ[args.objectNameSingular]) {
        return failed(tool, `Object "${args.objectNameSingular}" not found. Use get_object_metadata to list available objects.`);
      }
      const view = { id: nextId("view"), name: args.name, objectMetadataId: OBJ[args.objectNameSingular] };
      state.views.push(view);
      return { id: view.id, name: view.name, objectNameSingular: args.objectNameSingular, type: args.type, icon: "IconList", visibility: "WORKSPACE" };
    }
    if (tool === "create_view_filter") {
      if (!args.fieldMetadataId) return failed(tool, "fieldMetadataId is required");
      const f = { id: nextId("filter"), viewId: args.viewId, fieldMetadataId: args.fieldMetadataId, operand: args.operand, value: args.value };
      state.filters.push(f);
      return f;
    }
    if (FIND[tool]) {
      const obj = FIND[tool];
      if (tool.startsWith("find_one") && state.failReRead) return failed(tool, "connection reset");
      if (tool.startsWith("find_one") && state.oddRecord !== undefined) return found(obj, [state.oddRecord], 1);
      const { limit, offset, orderBy, ...filter } = tool.startsWith("find_one") ? { limit: 1, id: { eq: args.id } } as any : args;
      void orderBy;
      let rows: any[];
      try {
        rows = state[obj].filter((r: any) => matches(r, filter));
      } catch (err: any) {
        return failed(tool, err.message);
      }
      const first = Math.min(limit ?? 200, 200);
      const page = rows.slice(offset ?? 0, (offset ?? 0) + first);
      return found(obj, page, rows.length);
    }
    if (WRITE[tool]) {
      const obj = WRITE[tool];
      if (tool.startsWith("create_")) {
        const rec = { ...args, id: nextId(obj) };
        state[obj].push(rec);
        return written(obj, rec.id);
      }
      const { id, ...fields } = args;
      const rec = state[obj].find((r: any) => r.id === id);
      if (!rec) return failed(tool, `Record ${id} not found`);
      if (Object.keys(fields).length === 0) return { success: true, message: "No fields to update" };
      Object.assign(rec, fields);
      return written(obj, id, "updated");
    }
    return failed(tool, `Tool "${tool}" not found`);
  }

  exec.mockImplementation(async (tool: string, args: any) => ({
    content: [{ type: "text", text: JSON.stringify(answer(tool, args)) }],
    isError: false,
  }));

  return {
    state,
    addPerson(inLists: string[] | null, extra: any = {}) {
      const rec = { id: nextId("person"), name: { firstName: "Pat", lastName: `Doe${n}` }, inLists, ...extra };
      state.person.push(rec);
      return rec.id;
    },
    addCompany(inLists: string[] | null, extra: any = {}) {
      const rec = { id: nextId("company"), name: `Example Co ${n}`, inLists, ...extra };
      state.company.push(rec);
      return rec.id;
    },
    addView(obj: "person" | "company", name: string, slug?: string) {
      const view = { id: nextId("view"), name, objectMetadataId: OBJ[obj] };
      state.views.push(view);
      if (slug) state.filters.push({ id: nextId("filter"), viewId: view.id, fieldMetadataId: FIELD[obj], operand: "CONTAINS", value: slug });
      return view.id;
    },
    calls(tool: string) {
      return exec.mock.calls.filter((c: any[]) => c[0] === tool).map((c: any[]) => c[1]);
    },
  };
}

async function load(): Promise<any> {
  return (await import("../twenty-connector")).twentyConnector;
}

beforeEach(() => {
  vi.resetModules();
  exec.mockReset();
});

describe("the fake Twenty answers in the recorded shapes", () => {
  it("record answers, writes and failures carry the fixtures' top-level keys", () => {
    const fx = (id: string) => FIXTURES.calls.find((c: any) => c.id === id).answer;
    const keys = (o: any) => Object.keys(o).sort();
    expect(keys(found("person", [], 0))).toEqual(keys(fx("find_people.members")));
    expect(keys(found("person", [], 0).result)).toEqual(keys(fx("find_people.members").result));
    expect(keys(written("person", "x"))).toEqual(keys(fx("create_person")));
    expect(keys(written("person", "x").result)).toEqual(keys(fx("create_person").result));
    expect(keys(written("person", "x", "updated"))).toEqual(keys(fx("update_person")));
    expect(typeof found("person", [], 3).result.count).toBe("string");
    expect(keys(failed("create_view", "e"))).toEqual(keys(fx("create_view.failure")));
    expect(Array.isArray(fx("get_views"))).toBe(true);
    expect(Array.isArray(fx("get_object_metadata"))).toBe(true);
  });
});

describe("getListMembers", () => {
  it("a contact list: exactly the tagged people, through a top-level inLists filter", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    const a = t.addPerson(["leaders"]);
    const b = t.addPerson(["other", "leaders"]);
    const c = t.addPerson(["leaders"]);
    t.addPerson(["other"]);
    t.addPerson(null);
    const out = await (await load()).getListMembers({ listId });
    expect(out.accountIds).toEqual([]);
    expect([...out.contactIds].sort()).toEqual([a, b, c].sort());
    for (const args of t.calls("find_people")) {
      expect(args).not.toHaveProperty("filter");
      expect(args.inLists).toEqual({ containsIlike: "leaders" });
      expect(args.limit).toBeLessThanOrEqual(100);
    }
  });

  it("an account list: the tagged companies", async () => {
    const t = fakeTwenty();
    const listId = t.addView("company", "Targets", "targets");
    const a = t.addCompany(["targets"]);
    t.addCompany(["elsewhere"]);
    const out = await (await load()).getListMembers({ listId });
    expect(out).toEqual({ contactIds: [], accountIds: [a] });
  });

  it("an empty list answers no members", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Nobody yet", "nobody-yet");
    t.addPerson(["other"]);
    expect(await (await load()).getListMembers({ listId })).toEqual({ contactIds: [], accountIds: [] });
  });

  it("a list larger than one call pages by offset, 100 at a time", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Big", "big");
    const ids = Array.from({ length: 230 }, () => t.addPerson(["big"]));
    const out = await (await load()).getListMembers({ listId });
    expect(out.contactIds).toHaveLength(230);
    expect(new Set(out.contactIds)).toEqual(new Set(ids));
    expect(t.calls("find_people").map((a: any) => [a.limit, a.offset ?? 0])).toEqual([[100, 0], [100, 100], [100, 200]]);
  });

  it("a requested limit above one call is met by paging", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Big", "big");
    for (let i = 0; i < 230; i++) t.addPerson(["big"]);
    const out = await (await load()).getListMembers({ listId, limit: 150 });
    expect(out.contactIds).toHaveLength(150);
  });

  it("a { success: false } answer throws instead of reading as an empty list", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    t.addPerson(["leaders"]);
    t.state.fail.find_people = "the database is unavailable";
    await expect((await load()).getListMembers({ listId })).rejects.toThrow(/find_people failed: the database is unavailable/);
  });
});

describe("lists are views carrying an inLists filter", () => {
  it("searchLists reads get_views' bare array and the slug from each view's filter, never from its name", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Renamed Leaders", "leaders");
    t.addView("person", "All People");
    const out = await (await load()).searchLists({ query: "", objectType: "contact" });
    expect(out).toEqual([{ id: listId, slug: "leaders", name: "Renamed Leaders", objectType: "contact" }]);
    expect(t.calls("get_views")[0]).toEqual({ objectNameSingular: "person", limit: 100 });
  });

  it("given views of both kinds and a templated name, the list search returns only the list views", async () => {
    // A development workspace answers get_views with `All {objectLabelPlural}` (no inLists filter) and
    // `Person Record Page Fields` (a record-page field view; here with a filter on another field whose value reads
    // like a slug); only a view filtered on inLists is a list, and its name is the name the list was created with.
    const t = fakeTwenty();
    t.addView("person", "All {objectLabelPlural}");
    const pageView = t.addView("person", "Person Record Page Fields");
    t.state.filters.push({ id: "filter-page", viewId: pageView, fieldMetadataId: "fld-person-name", operand: "CONTAINS", value: "leaders" });
    const listId = t.addView("person", "Q4 Leaders", "q4-leaders");
    const out = await (await load()).searchLists({ query: "", objectType: "contact" });
    expect(out).toEqual([{ id: listId, slug: "q4-leaders", name: "Q4 Leaders", objectType: "contact" }]);
    expect(out.some((l: any) => /[{}]/.test(l.name) || l.name === "Person Record Page Fields")).toBe(false);
  });

  it("getList finds a list past the first 50 views", async () => {
    const t = fakeTwenty();
    for (let i = 0; i < 60; i++) t.addView("person", `View ${i}`);
    const listId = t.addView("person", "Late list", "late-list");
    const list = await (await load()).getList({ id: listId });
    expect(list).toEqual({ id: listId, slug: "late-list", name: "Late list", objectType: "contact" });
  });

  it("createList sends create_view by object name and TABLE, then create_view_filter by field id and CONTAINS", async () => {
    const t = fakeTwenty();
    const list = await (await load()).createList({ name: "Q4 Leaders", slug: "", objectType: "contact" });
    expect(t.calls("create_view")).toEqual([{ name: "Q4 Leaders", objectNameSingular: "person", type: "TABLE" }]);
    expect(t.calls("create_view_filter")).toEqual([
      { viewId: list.id, fieldMetadataId: FIELD.person, operand: "CONTAINS", value: "q4-leaders" },
    ]);
    expect(list).toEqual({ id: list.id, slug: "q4-leaders", name: "Q4 Leaders", objectType: "contact" });
    expect(await (await load()).getList({ id: list.id })).toEqual(list);
  });

  it("getList fails closed when the list is not among a get_views answer of 100 views (the tool's ceiling)", async () => {
    const t = fakeTwenty();
    for (let i = 0; i < 99; i++) t.addView("person", `View ${i}`);
    const listId = t.addView("person", "Hundredth", "hundredth");
    const connector = await load();
    expect(await connector.getList({ id: listId })).toEqual({ id: listId, slug: "hundredth", name: "Hundredth", objectType: "contact" });
    await expect(connector.getList({ id: "view-not-there" })).rejects.toThrow(/100 person views, the ceiling of Twenty's get_views/);
  });

  it("getList with 99 views answers null for a list that is not there", async () => {
    const t = fakeTwenty();
    for (let i = 0; i < 99; i++) t.addView("person", `View ${i}`);
    expect(await (await load()).getList({ id: "view-not-there" })).toBeNull();
  });

  it("searchLists fails closed on a get_views answer of 100 views and reads 99 views as before", async () => {
    const t = fakeTwenty();
    for (let i = 0; i < 98; i++) t.addView("person", `View ${i}`);
    const listId = t.addView("person", "Leaders", "leaders");
    const connector = await load();
    expect(await connector.searchLists({ query: "", objectType: "contact" })).toEqual([
      { id: listId, slug: "leaders", name: "Leaders", objectType: "contact" },
    ]);
    t.addView("person", "View 99");
    await expect(connector.searchLists({ query: "", objectType: "contact" })).rejects.toThrow(
      /100 person views, the ceiling of Twenty's get_views/,
    );
  });

  it("createList refuses a slug another list already carries", async () => {
    const t = fakeTwenty();
    t.addView("person", "Leaders", "leaders");
    await expect((await load()).createList({ name: "Leaders", slug: "leaders", objectType: "contact" })).rejects.toThrow(/already exists/);
    expect(t.calls("create_view")).toEqual([]);
  });
});

describe("membership writes keep every other list", () => {
  it("addListMember appends the slug and keeps the person's other slugs", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    const p = t.addPerson(["other-a", "other-b"]);
    await (await load()).addListMember({ listId, objectId: p, objectType: "contact" });
    expect(t.calls("update_person")).toEqual([{ id: p, inLists: ["other-a", "other-b", "leaders"] }]);
  });

  it("addListMember is a no-op when the slug is already there", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    const p = t.addPerson(["leaders"]);
    await (await load()).addListMember({ listId, objectId: p, objectType: "contact" });
    expect(t.calls("update_person")).toEqual([]);
  });

  it("removeListMember drops only that slug", async () => {
    const t = fakeTwenty();
    const listId = t.addView("company", "Targets", "targets");
    const c = t.addCompany(["keep-me", "targets"]);
    await (await load()).removeListMember({ listId, objectId: c, objectType: "account" });
    expect(t.calls("update_company")).toEqual([{ id: c, inLists: ["keep-me"] }]);
  });
});

describe("membership writes never overwrite what they cannot read", () => {
  it("addListMember and removeListMember throw on an inLists field that is not an array of strings, and write nothing", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    const p = t.addPerson("existing" as any);
    const q = t.addPerson(["leaders", 7] as any);
    const connector = await load();
    await expect(connector.addListMember({ listId, objectId: p, objectType: "contact" })).rejects.toThrow(
      /find_one_person: unexpected answer shape \(inLists is a string/,
    );
    await expect(connector.removeListMember({ listId, objectId: q, objectType: "contact" })).rejects.toThrow(
      /find_one_person: unexpected answer shape \(inLists is an array/,
    );
    expect(t.calls("update_person")).toEqual([]);
  });

  it("a find_one record that is not an object (7, null, an array, a string) throws in add/removeListMember, and nothing is written", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    const p = t.addPerson(["other"]);
    const connector = await load();
    for (const odd of [7, null, ["other"], "other"]) {
      t.state.oddRecord = odd;
      await expect(connector.addListMember({ listId, objectId: p, objectType: "contact" })).rejects.toThrow(
        /find_one_person: unexpected answer shape \(result.records\[0\] is .*, not an object \[person\]\)/,
      );
      await expect(connector.removeListMember({ listId, objectId: p, objectType: "contact" })).rejects.toThrow(
        /find_one_person: unexpected answer shape \(result.records\[0\] is .*, not an object \[person\]\)/,
      );
    }
    expect(t.calls("update_person")).toEqual([]);
    expect(t.state.person[0].inLists).toEqual(["other"]);
  });

  it("removeListMember refuses a list of another record type, as addListMember does", async () => {
    const t = fakeTwenty();
    t.addView("person", "Targets", "targets");
    const companyList = t.addView("company", "Targets", "targets");
    const p = t.addPerson(["targets", "keep-me"]);
    const connector = await load();
    await expect(connector.removeListMember({ listId: companyList, objectId: p, objectType: "contact" })).rejects.toThrow(
      /holds account records, not contact records/,
    );
    await expect(connector.addListMember({ listId: companyList, objectId: p, objectType: "contact" })).rejects.toThrow(
      /holds account records, not contact records/,
    );
    expect(t.calls("update_person")).toEqual([]);
    expect(t.state.person[0].inLists).toEqual(["targets", "keep-me"]);
  });
});

describe("a malformed entry of a view or metadata answer throws; nothing reads as an absent list and nothing is written", () => {
  // 7, null, an array, a string, and an object without the fields the connector relies on.
  const ODD = [7, null, ["x"], "x", {}];

  it("get_views: getList, searchLists and addListMember throw a TwentyMcpError naming the entry, and nothing is written", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    const p = t.addPerson(["other"]);
    const connector = await load();
    const { TwentyMcpError } = await import("../twenty-mcp-call");
    for (const odd of ODD) {
      t.state.oddEntry = { get_views: odd };
      await expect(connector.getList({ id: listId })).rejects.toThrow(/get_views: unexpected answer shape \(.*answer\[0\].*\[view\]/);
      await expect(connector.getList({ id: listId })).rejects.toBeInstanceOf(TwentyMcpError);
      await expect(connector.searchLists({ query: "", objectType: "contact" })).rejects.toThrow(/get_views: unexpected answer shape/);
      await expect(connector.addListMember({ listId, objectId: p, objectType: "contact" })).rejects.toThrow(/get_views: unexpected/);
    }
    expect(t.calls("update_person")).toEqual([]);
    expect(t.state.person[0].inLists).toEqual(["other"]);
  });

  it("get_view_filters: getList, searchLists and getListMembers throw instead of reading an existing list as absent", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    t.addPerson(["leaders"]);
    const connector = await load();
    for (const odd of [...ODD, { id: "f-odd", fieldMetadataId: FIELD.person, operand: null, value: "leaders" }]) {
      t.state.oddEntry = { get_view_filters: odd };
      await expect(connector.getList({ id: listId })).rejects.toThrow(/get_view_filters: unexpected answer shape \(.*answer\[0\].*\[view filter\]/);
      await expect(connector.searchLists({ query: "", objectType: "contact" })).rejects.toThrow(/get_view_filters: unexpected/);
      await expect(connector.getListMembers({ listId })).rejects.toThrow(/get_view_filters: unexpected/);
    }
    expect(t.calls("find_people")).toEqual([]);
    t.state.oddEntry = {};
    expect(await connector.getList({ id: listId })).toEqual({ id: listId, slug: "leaders", name: "Leaders", objectType: "contact" });
  });

  it("get_field_metadata and get_object_metadata: searchLists and createList throw instead of reading no list field, and create nothing", async () => {
    const t = fakeTwenty();
    t.addView("person", "Leaders", "leaders");
    for (const tool of ["get_field_metadata", "get_object_metadata"]) {
      for (const odd of ODD) {
        t.state.oddEntry = { [tool]: odd };
        const connector = await load();
        await expect(connector.searchLists({ query: "", objectType: "contact" })).rejects.toThrow(
          new RegExp(`${tool}: unexpected answer shape \\(.*answer\\[0\\].*\\[(field|object)\\]`),
        );
        await expect(connector.createList({ name: "New List", slug: "", objectType: "contact" })).rejects.toThrow(
          new RegExp(`${tool}: unexpected`),
        );
        vi.resetModules();
      }
    }
    expect(t.calls("create_view")).toEqual([]);
    expect(t.calls("create_view_filter")).toEqual([]);
  });

  it("a find record without an id throws in getListMembers instead of answering an undefined member", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    t.addPerson(["leaders"]);
    t.state.person.push({ name: { firstName: "No" }, inLists: ["leaders"] });
    await expect((await load()).getListMembers({ listId })).rejects.toThrow(
      /find_people: unexpected answer shape \(id is absent, not a non-empty string, in result.records\[1\] \[person\]\)/,
    );
  });
});

describe("a malformed created or written answer throws; nothing unchecked is returned", () => {
  it("createList: a created view whose name is not a string (7, null, absent) or whose id is absent throws, and no list filter is created", async () => {
    const t = fakeTwenty();
    const { TwentyMcpError } = await import("../twenty-mcp-call");
    for (const odd of [{ id: "view-odd", name: 7 }, { id: "view-odd", name: null }, { id: "view-odd" }, { name: "Q4 Leaders" }]) {
      t.state.oddAnswer = { create_view: odd };
      const connector = await load();
      const err = await connector.createList({ name: "Q4 Leaders", slug: "", objectType: "contact" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TwentyMcpError);
      expect(String((err as Error).message)).toMatch(/create_view: unexpected answer shape \((name|id) is .*, in answer \[created view\]\)/);
      vi.resetModules();
    }
    expect(t.calls("create_view_filter")).toEqual([]);
  });

  it("createList: a created view filter without its id or with a field of another type throws, and no list is returned", async () => {
    const t = fakeTwenty();
    for (const odd of [{ fieldMetadataId: FIELD.person, operand: "CONTAINS" }, { id: "f-odd", fieldMetadataId: 7, operand: "CONTAINS" }, 7, null]) {
      t.state.oddAnswer = { create_view_filter: odd };
      const connector = await load();
      await expect(connector.createList({ name: "Q4 Leaders", slug: "", objectType: "contact" })).rejects.toThrow(
        /create_view_filter: unexpected answer shape \(.*\[created view filter\]\)/,
      );
      vi.resetModules();
    }
  });

  it("createList returns the created view's projected id and checked name only, never a key the answer adds", async () => {
    const t = fakeTwenty();
    t.state.oddAnswer = { create_view: { id: "view-9000", name: "Q4 Leaders", objectNameSingular: "person", extra: { leak: 1 } } };
    const list = await (await load()).createList({ name: "Q4 Leaders", slug: "", objectType: "contact" });
    expect(list).toEqual({ id: "view-9000", slug: "q4-leaders", name: "Q4 Leaders", objectType: "contact" });
    expect(Object.keys(list).sort()).toEqual(["id", "name", "objectType", "slug"]);
  });

  it("a written answer without a string id throws in addListMember, removeListMember and createContact, and no re-read answers for it", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    const p = t.addPerson(["other"]);
    const q = t.addPerson(["leaders"]);
    const connector = await load();
    for (const odd of [{ success: true, message: "Record updated", result: {} }, { success: true, result: { id: 7 } }, { success: true }]) {
      t.state.oddAnswer = { update_person: odd, create_person: odd };
      await expect(connector.addListMember({ listId, objectId: p, objectType: "contact" })).rejects.toThrow(
        /update_person: unexpected answer shape \(.*\[written( answer)?\]\)/,
      );
      await expect(connector.removeListMember({ listId, objectId: q, objectType: "contact" })).rejects.toThrow(
        /update_person: unexpected answer shape/,
      );
      await expect(connector.createContact({ name: "Ada Lovelace" })).rejects.toThrow(/create_person: unexpected answer shape/);
    }
    expect(t.calls("find_one_person").every((a: any) => a.id === p || a.id === q)).toBe(true);
  });
});

describe("record writes re-read the slim answer", () => {
  it("createContact: create_person answers { id }; the contact is re-read by id", async () => {
    const t = fakeTwenty();
    const out = await (await load()).createContact({ name: "Ada Lovelace", email: "ada@example.com", inLists: ["leaders"] });
    expect(t.calls("create_person")).toEqual([
      { name: { firstName: "Ada", lastName: "Lovelace" }, emails: { primaryEmail: "ada@example.com" }, inLists: ["leaders"] },
    ]);
    expect(t.calls("find_one_person")).toEqual([{ id: out.id }]);
    expect(out).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com", inLists: ["leaders"] });
  });

  it("a failed re-read after a successful write never reports the write as failed", async () => {
    const t = fakeTwenty();
    t.state.failReRead = true;
    const out = await (await load()).createAccount({ name: "Example Co", domainName: "example.com" });
    expect(t.state.company).toHaveLength(1);
    expect(out).toMatchObject({ id: t.state.company[0].id, name: "Example Co", domainName: "example.com" });
  });

  it("updateContact sends the id and the patched fields at the top level, then re-reads", async () => {
    const t = fakeTwenty();
    const p = t.addPerson([], { jobTitle: "Engineer" });
    const out = await (await load()).updateContact({ id: p, patch: { title: "Director" } });
    expect(t.calls("update_person")).toEqual([{ id: p, jobTitle: "Director" }]);
    expect(out.title).toBe("Director");
  });
});

describe("reads", () => {
  it("searchContacts sends a top-level name/email search; findContactByEmail a nested email filter", async () => {
    const t = fakeTwenty();
    const p = t.addPerson([], { emails: { primaryEmail: "ada@example.com" }, name: { firstName: "Ada", lastName: "Lovelace" } });
    const connector = await load();
    const found1 = await connector.searchContacts({ query: "ada", limit: 10 });
    expect(found1.map((c: any) => c.id)).toEqual([p]);
    expect(t.calls("find_people")[0]).not.toHaveProperty("filter");
    const byEmail = await connector.findContactByEmail({ email: "ada@example.com" });
    expect(byEmail?.id).toBe(p);
    expect(t.calls("find_people")[1]).toEqual({ emails: { primaryEmail: { eq: "ada@example.com" } }, limit: 1 });
  });

  it("a failed find_one answer throws even when its message says 'not found'", async () => {
    const t = fakeTwenty();
    const listId = t.addView("person", "Leaders", "leaders");
    const p = t.addPerson(["leaders"]);
    t.state.fail.find_one_person = 'Object "person" not found';
    const connector = await load();
    await expect(connector.getContact({ id: p })).rejects.toThrow(/find_one_person failed: Object "person" not found/);
    await expect(connector.removeListMember({ listId, objectId: p, objectType: "contact" })).rejects.toThrow(
      /find_one_person failed: Object "person" not found/,
    );
    expect(t.calls("update_person")).toEqual([]);
  });

  it("getContact / getAccount answer null when no record matched", async () => {
    fakeTwenty();
    const connector = await load();
    expect(await connector.getContact({ id: "person-9999" })).toBeNull();
    expect(await connector.getAccount({ id: "company-9999" })).toBeNull();
  });
});
