import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import * as contract from "../../../src/twenty-tool-contract.mjs";
import { diffRecords, projectAnswer, sanitize } from "../lib/twenty-contract-record.mjs";

// The committed tool-contract fixtures, replayed through the connector's own
// readers and builders (src/twenty-tool-contract.mjs). The bootstrap proof
// compares the same fixtures with the live Twenty's answers on every run.

const FIXTURES = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../fixtures/twenty-tool-answers.json"), "utf8"),
);
const NS = "bootstrap-ci-test01";
const SLUG = `cinatra-proof-list-${NS}`;

function fixture(id) {
  const c = FIXTURES.calls.find((x) => x.id === id);
  if (!c) throw new Error(`no fixture call ${id}`);
  return c;
}

/** The MCP call result that carries a recorded answer, as execute_tool sends it. */
function callResult(answer) {
  return { content: [{ type: "text", text: JSON.stringify(answer) }], isError: false };
}

describe("the fixtures", () => {
  it("name the pinned Twenty release and image, and every tool the connector calls", () => {
    expect(FIXTURES.twentyTag).toBe("2.7.3");
    expect(FIXTURES.image).toMatch(/^sha256:[0-9a-f]{64}$/);
    const tools = new Set(FIXTURES.calls.map((c) => c.tool));
    for (const t of [
      "find_people", "find_companies", "find_one_person", "find_one_company",
      "create_person", "create_company", "update_person", "update_company",
      "get_views", "get_view_filters", "get_object_metadata", "get_field_metadata",
      "create_view", "create_view_filter",
    ]) {
      expect(tools.has(t), t).toBe(true);
    }
  });

  it("carry no unsanitized id, time or key", () => {
    const text = JSON.stringify(FIXTURES);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
    expect(text).not.toMatch(/bootstrap-(ci|local)-/);
  });
});

describe("the readers read the recorded answers", () => {
  it("find_people: { success, result: { records, count } } — the list's three members", () => {
    const payload = contract.readToolOutput("find_people", callResult(fixture("find_people.members").answer));
    const page = contract.readFindPage("find_people", payload);
    expect(page.records).toHaveLength(3);
    expect(page.count).toBe(3);
    expect(page.records.every((r) => contract.slugsOf(r).includes("cinatra-proof-list-<ns>"))).toBe(true);
  });

  it("find_companies: the list's one member", () => {
    const page = contract.readFindPage("find_companies", fixture("find_companies.members").answer);
    expect(page.records).toHaveLength(1);
  });

  it("find_one_*: the first record, and null when none matched", () => {
    expect(contract.readFindOne("find_one_person", fixture("find_one_person").answer)?.id).toBe("<uuid>");
    expect(contract.readFindOne("find_one_company", fixture("find_one_company").answer)?.id).toBe("<uuid>");
    const none = { ...fixture("find_one_person").answer, result: { records: [], count: 0 } };
    expect(contract.readFindOne("find_one_person", none)).toBeNull();
  });

  it("create_* / update_*: the slim answer carries the id only", () => {
    for (const id of ["create_person", "create_company", "update_person", "update_company"]) {
      const answer = fixture(id).answer;
      expect(Object.keys(answer.result)).toEqual(["id"]);
      expect(contract.readWrittenId(id, answer)).toBe("<uuid>");
    }
  });

  it("get_views / get_view_filters / get_object_metadata / get_field_metadata: bare arrays", () => {
    for (const id of ["get_views", "get_view_filters", "get_object_metadata", "get_field_metadata.person", "get_field_metadata.company"]) {
      const c = fixture(id);
      expect(Array.isArray(contract.readArrayAnswer(c.tool, contract.readToolOutput(c.tool, callResult(c.answer))))).toBe(true);
    }
    expect(contract.objectIdsFrom(fixture("get_object_metadata").answer)).toEqual({ contact: "<uuid>", account: "<uuid>" });
    expect(contract.listFieldIdFrom(fixture("get_field_metadata.person").answer)).toBe("<uuid>");
    // The recorded slug carries the sanitized namespace; a live slug carries the run's own.
    const filters = JSON.parse(JSON.stringify(fixture("get_view_filters").answer).split("<ns>").join(NS));
    expect(contract.listSlugFromFilters(filters, "<uuid>")).toBe(SLUG);
    expect(contract.listSlugFromFilters(filters, "another-field")).toBeNull();
  });

  it("create_view / create_view_filter: the bare created object with its id", () => {
    expect(contract.readCreatedEntity("create_view", fixture("create_view").answer).id).toBe("<uuid>");
    const f = contract.readCreatedEntity("create_view_filter", fixture("create_view_filter").answer);
    expect(f.operand).toBe("CONTAINS");
  });

  it("a { success: false } answer throws, through the caller's error factory", () => {
    const answer = fixture("create_view.failure").answer;
    expect(answer.success).toBe(false);
    expect(() => contract.readToolOutput("create_view", callResult(answer))).toThrow(/create_view failed: Object/);
    class Mine extends Error {}
    expect(() => contract.readToolOutput("create_view", callResult(answer), (c, m) => new Mine(m))).toThrow(Mine);
  });

  it("the shapes the connector read before this change find nothing in the recorded answers", () => {
    // The connector read `payload.views`, `payload.people`, `payload.person`,
    // `payload.objectMetadata ?? payload.objects`: every one is absent.
    expect(fixture("get_views").answer.views).toBeUndefined();
    expect(fixture("find_people.members").answer.people).toBeUndefined();
    expect(fixture("find_one_person").answer.person).toBeUndefined();
    expect(fixture("create_person").answer.person).toBeUndefined();
    const meta = fixture("get_object_metadata").answer;
    expect(meta.objectMetadata ?? meta.objects).toBeUndefined();
  });

  it("a find answer without a numeric result.count throws instead of reading as count null", () => {
    expect(() => contract.readFindPage("find_people", { success: true, result: { records: [] } })).toThrow(/result.count is absent/);
    const stringCount = { ...fixture("find_people.members").answer, result: { records: [], count: "3" } };
    expect(() => contract.readFindPage("find_people", stringCount)).toThrow(/result.count is a string/);
    expect(() => contract.readFindOne("find_one_person", { success: true, result: { records: [] } })).toThrow(/result.count/);
  });

  it("a find answer whose records are not all objects throws (7, null, an array, a string), so nothing is read as an empty record", () => {
    for (const odd of [7, null, ["x"], "existing"]) {
      const answer = { success: true, result: { records: [odd], count: 1 } };
      expect(() => contract.readFindPage("find_people", answer)).toThrow(/result.records\[0\] is .*, not an object/);
      expect(() => contract.readFindOne("find_one_person", answer)).toThrow(/result.records\[0\] is .*, not an object/);
    }
  });

  it("readListSlugs: an absent or null inLists reads as none; another shape throws instead of reading as empty", () => {
    const record = contract.readFindOne("find_one_person", fixture("find_one_person").answer);
    expect(contract.readListSlugs("find_one_person", record)).toEqual(["cinatra-proof-list-<ns>"]);
    expect(contract.readListSlugs("find_one_person", { id: "x" })).toEqual([]);
    expect(contract.readListSlugs("find_one_person", { id: "x", inLists: null })).toEqual([]);
    expect(() => contract.readListSlugs("find_one_person", { id: "x", inLists: "existing" })).toThrow(/inLists is a string/);
    expect(() => contract.readListSlugs("find_one_person", { id: "x", inLists: ["a-1", 2] })).toThrow(/not an array of strings/);
    class Mine extends Error {}
    expect(() => contract.readListSlugs("find_one_person", { inLists: {} }, (c, m) => new Mine(m))).toThrow(Mine);
  });

  it("an answer in another shape throws instead of reading as empty", () => {
    expect(() => contract.readFindPage("find_people", { people: [] })).toThrow(/unexpected answer shape/);
    expect(() => contract.readArrayAnswer("get_views", { views: [] })).toThrow(/expected an array/);
    expect(() => contract.readWrittenId("create_person", { success: true, result: {} })).toThrow(/result.id/);
    expect(() => contract.readToolOutput("find_people", { content: [] })).toThrow(/no text content/);
    expect(() => contract.readToolOutput("find_people", { content: [{ type: "text", text: "boom" }], isError: true })).toThrow(/Twenty tool error/);
  });
});

describe("the builders send the recorded arguments", () => {
  const san = (v) => sanitize(v, { ns: NS });

  it("getListMembers: the membership filter at the TOP level beside limit", () => {
    const args = contract.findArgs(contract.membershipFilter(SLUG), { limit: 100, offset: 0 });
    expect(san(args)).toEqual(fixture("find_people.members").args);
    expect(san(args)).toEqual(fixture("find_companies.members").args);
    expect(args).not.toHaveProperty("filter");
  });

  it("createList: create_view by object name and upper-case type; create_view_filter by field id and upper-case operand", () => {
    expect(san(contract.createViewArgs({ name: SLUG, objectType: "contact" }))).toEqual(fixture("create_view").args);
    const id = "11111111-2222-4333-8444-555555555555";
    expect(san(contract.createListFilterArgs({ viewId: id, fieldMetadataId: id, slug: SLUG }))).toEqual(fixture("create_view_filter").args);
  });

  it("the view and metadata reads", () => {
    expect(contract.getViewsArgs("contact")).toEqual(fixture("get_views").args);
    expect(contract.getObjectMetadataArgs()).toEqual(fixture("get_object_metadata").args);
    expect(san(contract.getFieldMetadataArgs("11111111-2222-4333-8444-555555555555"))).toEqual(fixture("get_field_metadata.person").args);
    expect(san(contract.getViewFiltersArgs("11111111-2222-4333-8444-555555555555"))).toEqual(fixture("get_view_filters").args);
  });

  it("record writes: createContact / createAccount and the membership update send the recorded arguments", () => {
    const person = contract.createRecordArgs("contact", {
      name: `proof-in p-0-${NS}`, cinatraObjectId: `proof-list-${NS}-0`, inLists: [SLUG],
    });
    expect(san(person)).toEqual(fixture("create_person").args);
    const company = contract.createRecordArgs("account", {
      name: `cinatra-proof-co-${NS}`, cinatraObjectId: `proof-list-co-${NS}`, inLists: [SLUG],
    });
    expect(san(company)).toEqual(fixture("create_company").args);
    const id = "11111111-2222-4333-8444-555555555555";
    const both = [SLUG, `cinatra-proof-other-${NS}`];
    expect(san(contract.membershipUpdateArgs(id, both))).toEqual(fixture("update_person").args);
    expect(san(contract.membershipUpdateArgs(id, both))).toEqual(fixture("update_company").args);
    expect(() => contract.membershipUpdateArgs(id, "x")).toThrow(/array of strings/);
    expect(contract.updateRecordArgs("contact", id, { title: "Director" })).toEqual({ id, jobTitle: "Director" });
    expect(contract.updateRecordArgs("account", id, {})).toBeNull();
    expect(contract.createRecordArgs("contact", { email: "a@example.com" })).toEqual({ emails: { primaryEmail: "a@example.com" }, name: {} });
  });

  it("get_views' ceiling: an answer of 100 views is at the ceiling, 99 are not", () => {
    const views = (n) => Array.from({ length: n }, (_, i) => ({ id: `v${i}` }));
    expect(contract.VIEWS_LIMIT).toBe(100);
    expect(contract.viewsAtCeiling(views(99))).toBe(false);
    expect(contract.viewsAtCeiling(views(100))).toBe(true);
    expect(contract.viewsAtCeiling(fixture("get_views").answer)).toBe(false);
  });

  it("addListMember keeps every other slug", () => {
    expect(contract.slugsWith(["a-1", "b-2"], "c-3")).toEqual(["a-1", "b-2", "c-3"]);
    expect(contract.slugsWith(["a-1"], "a-1")).toBeNull();
    expect(contract.slugsWithout(["a-1", "b-2", "c-3"], "b-2")).toEqual(["a-1", "c-3"]);
    expect(contract.slugsWithout(["a-1"], "z-9")).toBeNull();
    expect(san(fixture("update_person").args.inLists)).toEqual(["cinatra-proof-list-<ns>", "cinatra-proof-other-<ns>"]);
  });

  it("search and email filters are top-level and nested, never `filter` or a dotted key", () => {
    expect(contract.emailFilter("a@example.com")).toEqual({ emails: { primaryEmail: { eq: "a@example.com" } } });
    expect(contract.companySearchFilter("Ac_me%")).toEqual({ name: { ilike: "%Ac\\_me\\%%" } });
    expect(contract.personSearchFilter("")).toEqual({});
    expect(contract.personSearchFilter("ada").or).toHaveLength(3);
    expect(() => contract.membershipFilter("Not A Slug")).toThrow(/not a list slug/);
  });

  it("paging reads past 100 records by offset and stops at the count", async () => {
    const total = 230;
    const seen = [];
    const rows = await contract.readAllPages(async ({ limit, offset }) => {
      seen.push([limit, offset]);
      const n = Math.max(0, Math.min(limit, total - offset));
      return { records: Array.from({ length: n }, (_, i) => ({ id: `r${offset + i}` })), count: total };
    });
    expect(rows).toHaveLength(230);
    expect(seen).toEqual([[100, 0], [100, 100], [100, 200]]);
    const capped = await contract.readAllPages(async ({ limit, offset }) => ({
      records: Array.from({ length: limit }, (_, i) => ({ id: `r${offset + i}` })),
      count: null,
    }), { want: 150 });
    expect(capped).toHaveLength(150);
  });
});

describe("the drift check", () => {
  it("reads the committed fixtures as matching themselves", () => {
    expect(diffRecords(FIXTURES, FIXTURES)).toBeNull();
  });

  it("reports a changed answer shape and a changed argument, never a changed value", () => {
    const changedValue = structuredClone(FIXTURES);
    changedValue.calls.find((c) => c.id === "find_people.members").answer.result.count = 99;
    expect(diffRecords(FIXTURES, changedValue)).toBeNull();

    const wrapped = structuredClone(FIXTURES);
    const views = wrapped.calls.find((c) => c.id === "get_views");
    views.answer = { views: views.answer };
    expect(diffRecords(FIXTURES, wrapped)).toMatch(/^get_views: /);

    const oldArgs = structuredClone(FIXTURES);
    oldArgs.calls.find((c) => c.id === "find_people.members").args = { filter: { inLists: { contains: "x" } }, limit: 1000 };
    expect(diffRecords(FIXTURES, oldArgs)).toMatch(/^find_people.members: /);

    const otherImage = { ...FIXTURES, image: `sha256:${"0".repeat(64)}` };
    expect(diffRecords(FIXTURES, otherImage)).toMatch(/^image: /);
  });

  it("projects a failure by its failure keys", () => {
    expect(projectAnswer("create_view", fixture("create_view.failure").answer).paths).toEqual({
      success: "boolean",
      message: "string",
      error: "string",
    });
  });

  it("sanitizes ids, times, the namespace, the key name and JWTs", () => {
    const out = sanitize(
      { a: "4f0c6a2e-1b2c-4d3e-8f90-a1b2c3d4e5f6", t: "2026-10-14T12:00:00.000Z", n: `x-${NS}`, k: "proof-key-1", j: "eyJa.eyJb.c" },
      { ns: NS, keyName: "proof-key-1" },
    );
    expect(out).toEqual({ a: "<uuid>", j: "<jwt>", k: "<key-name>", n: "x-<ns>", t: "<time>" });
  });
});
