import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import * as contract from "../../../src/twenty-tool-contract.mjs";
import {
  canonicalJson, diffRecords, isShape, projectAnswer, recordAndRead, recordedAnswer, sanitize,
} from "../lib/twenty-contract-record.mjs";
// A namespace import: a name the module does not export reads as undefined in a case, never as a load failure.
import * as snapshotLib from "../lib/twenty-snapshot.mjs";
import * as recordLib from "../lib/twenty-contract-record.mjs";

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

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

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
      "create_view", "create_view_filter", "create_field_metadata",
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

  it("hold no value under a key the contract does not check: every other key is its shape only, and each answer is its own record", () => {
    // Walk each answer by its tool's type over ENTRY_FIELDS: a key the table does not name holds "<array>",
    // "<string>", ... and never a value; a failed tool's answer carries the failure reader's texts only.
    const walk = (value, type, where) => {
      const m = /^@(.+?)(\[\])?(\?)?$/.exec(type);
      if (!m) return;
      if (m[2]) return void (value ?? []).forEach((v, i) => walk(v, `@${m[1]}`, `${where}[${i}]`));
      if (value === null || value === undefined) return;
      const fields = contract.ENTRY_FIELDS[m[1]];
      for (const [k, v] of Object.entries(value)) {
        if (!(k in fields)) expect(isShape(v), `${where}.${k} holds a value`).toBe(true);
        else if (fields[k].startsWith("@")) walk(v, fields[k], `${where}.${k}`);
      }
    };
    for (const c of FIXTURES.calls) {
      if (c.answer.success === false) {
        for (const [k, v] of Object.entries(c.answer)) {
          if (!["success", "message", "error"].includes(k)) expect(isShape(v), `${c.id}.${k} holds a value`).toBe(true);
        }
      } else {
        walk(c.answer, contract.TOOL_ANSWERS[c.tool], c.id);
      }
      expect(recordedAnswer(c.tool, c.answer, { own: { has: () => true } }), c.id).toEqual(c.answer);
    }
  });

  it("carry recordReferences, as its shape, on every answer of a record tool, as Twenty's record services send it", () => {
    // create-record.service.ts:79, update-record.service.ts:108 and find-records.service.ts:85 of Twenty 2.7.3; the
    // live proof (step 08r) found it on create_person and create_company where the fixtures lacked it.
    const RECORD_TOOLS = ["find_people", "find_companies", "find_one_person", "find_one_company",
      "create_person", "create_company", "update_person", "update_company"];
    const answers = FIXTURES.calls.filter((c) => RECORD_TOOLS.includes(c.tool) && c.answer.success === true);
    expect(new Set(answers.map((c) => c.tool)).size).toBe(RECORD_TOOLS.length);
    for (const c of answers) expect(c.answer.recordReferences, c.id).toBe("<array>");
  });

  it("hold only the run's own synthetic records: no email, link or other record", () => {
    const text = JSON.stringify(FIXTURES);
    expect(text).not.toMatch(/@|https?:|www\./);
    for (const c of FIXTURES.calls.filter((x) => /^@(person|company) answer$/.test(contract.TOOL_ANSWERS[x.tool]))) {
      expect(c.answer.result.records.length, c.id).toBeGreaterThan(0);
      for (const r of c.answer.result.records) {
        expect(r.id, c.id).toBe("<uuid>");
        expect(r.cinatraObjectId, c.id).toMatch(/^proof-list-(co-)?<ns>(-\d)?$/);
        const name = typeof r.name === "string" ? r.name : `${r.name.firstName} ${r.name.lastName}`;
        expect(name, c.id).toMatch(/^(cinatra-proof-co-<ns>|proof-in p-\d-<ns>)$/);
        // A live record holds the four identity fields plus every other checked field Twenty answers for a record the
        // proof created (empty: null, "" or a composite of empties) and every unchecked key as its shape - no value of its own.
        expect(Object.keys(r), c.id).toEqual(expect.arrayContaining(["cinatraObjectId", "id", "inLists", "name"]));
        const empty = (v) => v === null || v === "" || isShape(v) || (isPlain(v) && Object.values(v).every(empty));
        for (const [k, v] of Object.entries(r)) {
          if (!["cinatraObjectId", "id", "inLists", "name"].includes(k)) expect(empty(v), `${c.id}.${k} holds a value`).toBe(true);
        }
        for (const s of r.inLists) expect(s, c.id).toMatch(/^cinatra-proof-(list|other)-<ns>$/);
      }
    }
  });
});

describe("the readers read the recorded answers", () => {
  it("find_people: { success, result: { records, count } } — the list's three members", () => {
    const payload = contract.readToolOutput("find_people", callResult(fixture("find_people.members").answer));
    const page = contract.readFindPage("find_people", payload);
    expect(page.records).toHaveLength(3);
    expect(page.count).toBe(3);
    expect(page.records.every((r) => contract.readListSlugs("find_people", r).includes("cinatra-proof-list-<ns>"))).toBe(true);
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
    expect(contract.readObjectIds(fixture("get_object_metadata").answer)).toEqual({ contact: "<uuid>", account: "<uuid>" });
    expect(contract.readListFieldId(fixture("get_field_metadata.person").answer)).toBe("<uuid>");
    // The recorded slug carries the sanitized namespace; a live slug carries the run's own.
    const filters = JSON.parse(JSON.stringify(fixture("get_view_filters").answer).split("<ns>").join(NS));
    expect(contract.readListSlug(filters, "<uuid>")).toBe(SLUG);
    expect(contract.readListSlug(filters, "another-field")).toBeNull();
  });

  it("create_view / create_view_filter / create_field_metadata: the bare created object with its id", () => {
    expect(contract.readCreatedEntity("create_view", fixture("create_view").answer).id).toBe("<uuid>");
    expect(contract.readCreatedEntity("create_field_metadata", fixture("create_field_metadata").answer)).toEqual({
      id: "<uuid>", name: "cinatraObjectId", type: "TEXT",
    });
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

  it("a find answer without result.count throws instead of reading as count null", () => {
    expect(() => contract.readFindPage("find_people", { success: true, result: { records: [] } })).toThrow(
      /count is absent, not a non-negative integer or its decimal digits, in result \[person page\]/,
    );
    expect(() => contract.readFindOne("find_one_person", { success: true, result: { records: [] } })).toThrow(/count is absent/);
  });

  it("a find page's count is read as a number from a non-negative integer or its decimal digits, the string live Twenty sends", () => {
    // A live Twenty 2.7.3 answers result.count as a string (the live proof's step 08: "count is a string").
    const page = (count) => ({ ...fixture("find_people.members").answer, result: { records: [], count } });
    for (const [sent, read] of [["0", 0], ["3", 3], ["230", 230], ["999999999999999", 999999999999999], [0, 0], [3, 3]]) {
      expect(contract.readFindPage("find_people", page(sent)).count, JSON.stringify(sent)).toBe(read);
    }
    const one = { ...fixture("find_one_person").answer, result: { ...fixture("find_one_person").answer.result, count: "1" } };
    expect(contract.readFindOne("find_one_person", one)).toEqual(contract.readFindOne("find_one_person", fixture("find_one_person").answer));
    for (const bad of ["", "x", "3x", "x3", " 3", "3 ", "03", "00", "-1", "+1", "1.5", "1e3", "0x10", "\u0663", "1".repeat(16),
      -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, true, null, [], {}]) {
      expect(() => contract.readFindPage("find_people", page(bad)), String(bad)).toThrow(
        /find_people: unexpected answer shape \(count is .*, not a non-negative integer or its decimal digits, in result \[person page\]\)$/,
      );
    }
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
    expect(() => contract.readArrayAnswer("get_views", { views: [] })).toThrow(/answer is an object .*, not an array \[view\]/);
    expect(() => contract.readWrittenId("create_person", { success: true, result: {} })).toThrow(/id is absent, .* in result \[written\]/);
    expect(() => contract.readToolOutput("find_people", { content: [] })).toThrow(/no text content/);
    expect(() => contract.readToolOutput("find_people", { content: [{ type: "text", text: "boom" }], isError: true })).toThrow(/Twenty tool error/);
  });
});

describe("the reader census: every exported reader checks what it reads against ENTRY_FIELDS and returns only checked fields", () => {
  class Mine extends Error {}
  const mk = (code, message) => new Mine(message);
  const BAD = [7, null, [], "x"];
  const BAD_ARRAY = [7, null, {}, "x"];
  const FIXTURE_TOOLS = [...new Set(FIXTURES.calls.map((c) => c.tool))].sort();
  // One valid entry of EVERY kind, every relied-on field present, so that each field can be taken away and
  // mistyped in turn (two fields never share one object, so a change names exactly one place).
  const links = { primaryLinkUrl: "https://example.com/a" };
  const person = {
    id: "p-1", name: { firstName: "Pat", lastName: "Doe" }, emails: { primaryEmail: "pat@example.com" }, jobTitle: "Lead",
    linkedinLink: { ...links }, xLink: { ...links }, companyId: "c-1", cinatraObjectId: "co-1", apolloPersonId: "ap-1",
    enrichmentStatus: "enriched", inLists: ["a-1"],
  };
  const company = { id: "c-1", name: "Example Co", domainName: links, cinatraObjectId: "co-2", apolloOrganizationId: "ao-1", inLists: ["a-1"] };
  const VALID = {
    "tool result": { content: [{ type: "resource", text: "unused" }, { type: "text", text: "{}" }], isError: false },
    "content item": { type: "text", text: "{}" },
    "person answer": { success: true, result: { records: [person, person], count: 2 } },
    "company answer": { success: true, result: { records: [company], count: 1 } },
    "person page": { records: [person, person], count: 2 },
    "company page": { records: [company], count: 1 },
    person,
    company,
    "full name": person.name,
    emails: person.emails,
    links,
    "written answer": { success: true, result: { id: "w-1" } },
    written: { id: "w-1" },
    view: { id: "v-1", name: "Leaders", type: "TABLE", objectMetadataId: "o-1" },
    "view filter": {
      id: "f-1", viewId: "v-1", fieldMetadataId: "fm-1", operand: "CONTAINS", value: "a-1", subFieldName: "primaryEmail",
      positionInViewFilterGroup: 0,
    },
    "view query": { objectNameSingular: "person", filter: { jobTitle: { eq: "Lead" } }, viewType: "TABLE" },
    object: { id: "o-1", nameSingular: "person", labelSingular: "Person", labelPlural: "People" },
    field: { id: "fd-1", name: "inLists", type: "ARRAY", isActive: true },
    "created view": { id: "v-1", name: "Leaders" },
    "created view filter": { id: "f-1", fieldMetadataId: "fm-1", operand: "CONTAINS" },
    "created field": { id: "fd-2", name: "inLists", type: "ARRAY" },
  };
  const clone = (v) => structuredClone(v);
  const sample = (type) => {
    const m = /^@(.+?)(\[\])?$/.exec(type);
    return m[2] ? [clone(VALID[m[1]])] : clone(VALID[m[1]]);
  };
  const answerOf = (tool) => sample(contract.TOOL_ANSWERS[tool]);
  const toolsOf = (pred) => Object.keys(contract.TOOL_ANSWERS ?? {}).filter((t) => pred(contract.TOOL_ANSWERS[t])).sort();
  const FIND_TOOLS = toolsOf((t) => /^@(person|company) answer$/.test(t));
  const callResultOf = (answer) => ({ content: [{ type: "resource", text: "unused" }, { type: "text", text: JSON.stringify(answer) }] });

  // HOW EACH EXPORTED READER IS HANDED WHAT IT READS: `type` is the type of its input over ENTRY_FIELDS (the
  // census walks it), `ret` the type of what it returns, `call` hands it one input. A reader added to the
  // module without a row here turns the first case red.
  const ROWS = {
    readToolOutput: [
      ...Object.keys(contract.TOOL_ANSWERS ?? {}).sort().map((tool) => ({
        tool, type: contract.TOOL_ANSWERS[tool], where: "answer", ret: contract.TOOL_ANSWERS[tool],
        call: (v) => contract.readToolOutput(tool, callResultOf(v), mk),
      })),
      { tool: "find_people", type: "@tool result", where: "result", input: callResultOf(VALID["person answer"]),
        ret: "@person answer", call: (v) => contract.readToolOutput("find_people", v, mk) },
    ],
    readAnswer: Object.keys(contract.TOOL_ANSWERS ?? {}).sort().map((tool) => ({
      tool, type: contract.TOOL_ANSWERS[tool], where: "answer", ret: contract.TOOL_ANSWERS[tool],
      call: (v) => contract.readAnswer(tool, v, mk),
    })),
    readFindPage: FIND_TOOLS.map((tool) => ({
      tool, type: contract.TOOL_ANSWERS[tool], where: "answer", ret: contract.TOOL_ANSWERS[tool].replace("answer", "page"),
      call: (v) => contract.readFindPage(tool, v, mk),
    })),
    readFindOne: FIND_TOOLS.map((tool) => ({
      tool, type: contract.TOOL_ANSWERS[tool], where: "answer", ret: contract.TOOL_ANSWERS[tool].replace(" answer", ""),
      call: (v) => contract.readFindOne(tool, v, mk),
    })),
    readAllPages: FIND_TOOLS.map((tool) => ({
      tool, type: contract.TOOL_ANSWERS[tool].replace("answer", "page"), where: "result",
      ret: `${contract.TOOL_ANSWERS[tool].replace(" answer", "")}[]`,
      call: (v) => contract.readAllPages(async () => v, { toolName: tool, makeError: mk }),
    })),
    readWrittenId: toolsOf((t) => t === "@written answer").map((tool) => ({
      tool, type: "@written answer", where: "answer", ret: "id", call: (v) => contract.readWrittenId(tool, v, mk),
    })),
    readArrayAnswer: toolsOf((t) => t.endsWith("[]")).map((tool) => ({
      tool, type: contract.TOOL_ANSWERS[tool], where: "answer", ret: contract.TOOL_ANSWERS[tool],
      call: (v) => contract.readArrayAnswer(tool, v, mk),
    })),
    readCreatedEntity: toolsOf((t) => t.startsWith("@created ")).map((tool) => ({
      tool, type: contract.TOOL_ANSWERS[tool], where: "answer", ret: contract.TOOL_ANSWERS[tool],
      call: (v) => contract.readCreatedEntity(tool, v, mk),
    })),
    readEntries: Object.keys(contract.ENTRY_FIELDS ?? {}).sort().map((kind) => ({
      tool: "some_tool", label: kind, type: `@${kind}[]`, where: "entries", ret: `@${kind}[]`,
      call: (v) => contract.readEntries("some_tool", v, kind, mk),
    })),
    readListSlug: [{ tool: "get_view_filters", type: "@view filter[]", where: "answer", ret: "string",
      call: (v) => contract.readListSlug(v, "fm-1", mk) }],
    readListFieldId: [{ tool: "get_field_metadata", type: "@field[]", where: "answer", ret: "id",
      call: (v) => contract.readListFieldId(v, mk) }],
    readObjectIds: [{ tool: "get_object_metadata", type: "@object[]", where: "answer", ret: "@object ids",
      input: [clone(VALID.object), { id: "o-2", nameSingular: "company", labelSingular: "Company", labelPlural: "Companies" }],
      call: (v) => contract.readObjectIds(v, mk) }],
    // cinatra#3562 S5: one metadata entry read by its id (getObjectMetadataByIdArgs / getFieldMetadataByIdArgs).
    readOneById: [
      { tool: "get_object_metadata", type: "@object[]", where: "answer", ret: "@object",
        call: (v) => contract.readOneById("get_object_metadata", v, "o-1", mk) },
      { tool: "get_field_metadata", type: "@field[]", where: "answer", ret: "@field",
        call: (v) => contract.readOneById("get_field_metadata", v, "fd-1", mk) },
    ],
    // cinatra#3562 S5: the filters of one view, every entry of the requested view.
    readViewFilters: [{ tool: "get_view_filters", type: "@view filter[]", where: "answer", ret: "@view filter[]",
      call: (v) => contract.readViewFilters(v, "v-1", mk) }],
    // cinatra#3562 S4: the view's own query.
    readViewQuery: [{ tool: "get_view_query_parameters", type: "@view query", where: "answer", ret: "@view query",
      call: (v) => contract.readViewQuery(v, mk) }],
    // cinatra#3562 S10: a view's member ids, two full reads of find pages (ids distinct, or the read refuses).
    readMemberIds: FIND_TOOLS.map((tool) => ({
      tool, type: contract.TOOL_ANSWERS[tool].replace("answer", "page"), where: "result", ret: "strings",
      input: contract.TOOL_ANSWERS[tool] === "@person answer" ? { records: [clone(person), { ...clone(person), id: "p-2" }], count: 2 } : undefined,
      call: (v) => contract.readMemberIds(async () => v, { toolName: tool, makeError: mk }),
    })),
    readListSlugs: FIND_TOOLS.filter((t) => t.startsWith("find_one_")).map((tool) => ({
      tool, type: contract.TOOL_ANSWERS[tool].replace(" answer", ""), where: "record", ret: "strings",
      call: (v) => contract.readListSlugs(tool, v, mk),
    })),
  };
  // What a reader that returns a value DERIVED from checked fields returns: readObjectIds the two object ids.
  const DERIVED = { "object ids": { contact: "id", account: "id" } };

  /** Every place of a value of `type`: [path, where, kind, field, fieldType]; arrays are entered at [0]. */
  function places(type, value, path, where, out, kinds) {
    const m = /^@(.+?)(\[\])?(\?)?$/.exec(type);
    const kind = m[1];
    kinds.add(kind);
    out.push({ entry: true, path, where, kind, array: Boolean(m[2]), optional: Boolean(m[3]) });
    const entryPath = m[2] ? [...path, 0] : path;
    const entryWhere = m[2] ? `${where}[0]` : where;
    const entry = m[2] ? value?.[0] : value;
    if (m[2]) out.push({ entry: true, path: entryPath, where: entryWhere, kind, array: false });
    for (const [field, ft] of Object.entries(contract.ENTRY_FIELDS[kind])) {
      out.push({ path: [...entryPath, field], where: entryWhere, kind, field, ft });
      if (ft.startsWith("@") && entry?.[field] !== undefined && entry?.[field] !== null) {
        places(ft, entry[field], [...entryPath, field], entryWhere === "answer" ? field : `${entryWhere}.${field}`, out, kinds);
      }
    }
    return out;
  }
  function setAt(root, path, value, remove) {
    if (path.length === 0) return value;
    const copy = clone(root);
    let o = copy;
    for (const p of path.slice(0, -1)) o = o[p];
    if (remove) delete o[path[path.length - 1]];
    else o[path[path.length - 1]] = value;
    return copy;
  }
  const WRONG = { id: [7, ""], string: [7], "string?": [7], number: ["3"], count: ["x", "03", -1, 1.5], true: ["yes", 1], "boolean?": ["yes"],
    "strings?": ["a-1", [1]], "string|any": [], json: [null], "number?": ["3"], object: [7, "x", []] };
  async function outcome(call, input) {
    try {
      return { value: await call(input) };
    } catch (e) {
      return { error: e };
    }
  }
  function conforms(value, type) {
    // A returned value: an object holds ONLY the checked fields of its kind (each conforming in turn).
    if (type === "id" || type === "string") return typeof value === "string" && (type !== "id" || value.length > 0);
    if (type === "strings") return Array.isArray(value) && value.every((s) => typeof s === "string");
    const m = /^@(.+?)(\[\])?$/.exec(type);
    if (m[2]) return Array.isArray(value) && value.every((v) => conforms(v, `@${m[1]}`));
    const fields = contract.ENTRY_FIELDS[m[1]] ?? DERIVED[m[1]];
    if (!fields || value === null || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.keys(value).every((k) => {
      const ft = fields[k];
      if (!ft) return false;
      const v = value[k];
      if (ft.startsWith("@")) {
        if (v === null && ft.endsWith("?")) return true;
        return conforms(v, ft.replace(/\?$/, ""));
      }
      // A "json" or "object" field is the answer's whole value, returned as a deep copy (cinatra#3562 S3).
      if (ft === "object") return isPlain(v);
      if (ft === "json") return v !== undefined && v !== null;
      return v === null || ["string", "number", "boolean"].includes(typeof v) || conforms(v, "strings");
    });
  }
  function objectsOf(value, set = new Set()) {
    if (value && typeof value === "object") {
      set.add(value);
      for (const v of Object.values(value)) objectsOf(v, set);
    }
    return set;
  }
  function withExtras(value, type) {
    // The same input with an unchecked key beside every checked one, at every depth. The value of a "json" or
    // "object" field is the answer's whole value (cinatra#3562 S3): it is kept as it is, never given a key.
    if (type === "json" || type === "object") return clone(value);
    const m = /^@(.+?)(\[\])?(\?)?$/.exec(type ?? "");
    const fields = m && !m[2] ? contract.ENTRY_FIELDS[m[1]] : undefined;
    if (Array.isArray(value)) return value.map((v) => withExtras(v, m && m[2] ? `@${m[1]}` : undefined));
    if (value && typeof value === "object") {
      const out = { unchecked: { leak: "unchecked-value" } };
      for (const [k, v] of Object.entries(value)) out[k] = withExtras(v, fields?.[k]);
      return out;
    }
    return value;
  }
  const inputOf = (row) => row.input ?? sample(row.type);
  const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** THE FULL ERROR IDENTITY of a field error: the tool, the place with its index and the kind; for a nested
   *  field, the nested place and the nested kind. */
  function expectFieldError(error, row, p, what) {
    expect(error, what).toBeInstanceOf(Mine);
    if (p.ft.startsWith("@")) {
      const nested = p.ft.slice(1).replace(/\?$/, "").replace(/\[\]$/, "");
      const place = p.where === "answer" ? p.field : `${p.where}.${p.field}`;
      expect(error.message, what).toContain(`${row.tool}: unexpected answer shape (${place} is `);
      expect(error.message, what).toMatch(new RegExp(`, not an (object|array) \\[${escapeRe(nested)}\\]\\)$`));
    } else {
      expect(error.message, what).toContain(`${row.tool}: unexpected answer shape (${p.field} is `);
      expect(error.message, what).toMatch(new RegExp(`, in ${escapeRe(p.where)} \\[${escapeRe(p.kind)}\\]\\)$`));
    }
  }

  it("the census names every exported reader of the module (enumerated from the module, not listed by hand), every kind and every tool", () => {
    const exported = Object.keys(contract).filter((n) => typeof contract[n] === "function" && /^read[A-Z]/.test(n)).sort();
    expect(exported.length).toBeGreaterThanOrEqual(13);
    expect(exported).toEqual(Object.keys(ROWS).sort());
    expect(Object.keys(VALID).sort()).toEqual(Object.keys(contract.ENTRY_FIELDS ?? {}).sort());
    expect(Object.keys(contract.TOOL_ANSWERS ?? {}).sort()).toEqual(FIXTURE_TOOLS);
    // Every kind of the table is reached through a reader of an answer (readEntries aside), so no kind is
    // dead and every kind's fields are taken away and mistyped below.
    const kinds = new Set();
    for (const [reader, rows] of Object.entries(ROWS)) {
      if (reader === "readEntries") continue;
      for (const row of rows) places(row.type, inputOf(row), [], row.where, [], kinds);
    }
    expect([...kinds].sort()).toEqual(Object.keys(contract.ENTRY_FIELDS).sort());
  });

  for (const [reader, rows] of Object.entries(ROWS)) {
    for (const row of rows) {
      const label = row.label ?? row.tool;
      it(`${reader} (${label}): (a) throws on the entries 7, null, [] and "x" and on each required field taken away or mistyped, through the caller's error factory naming the tool, the place with its index and the kind`, async () => {
        const input = inputOf(row);
        expect((await outcome(row.call, input)).error, `${reader} on its valid input`).toBeUndefined();
        let checked = 0;
        for (const p of places(row.type, input, [], row.where, [], new Set())) {
          if (p.entry) {
            // A null stands for an optional entry left empty, which is no shape error.
            for (const bad of (p.array ? BAD_ARRAY : BAD).filter((b) => !(p.optional && b === null))) {
              const { error } = await outcome(row.call, setAt(input, p.path, bad));
              expect(error, `${reader} with ${JSON.stringify(bad)} at ${p.where}`).toBeInstanceOf(Mine);
              expect(error.message).toContain(`${row.tool}: unexpected answer shape (${p.where} is `);
              expect(error.message).toContain(`[${p.kind}]`);
              checked += 1;
            }
            continue;
          }
          const required = !p.ft.endsWith("?") && p.ft !== "string|any";
          const gone = await outcome(row.call, setAt(input, p.path, undefined, true));
          if (required) {
            expectFieldError(gone.error, row, p, `${reader} without ${p.where}.${p.field}`);
            checked += 1;
          } else if (gone.error) {
            // An optional field taken away is no shape error (a reader may still need it for its own result).
            expect(gone.error.message).not.toContain(`${p.field} is absent`);
          }
          const wrongs = p.ft.startsWith("@") ? [7, "x"] : WRONG[p.ft];
          for (const wrong of wrongs) {
            const { error } = await outcome(row.call, setAt(input, p.path, wrong));
            expectFieldError(error, row, p, `${reader} with ${p.where}.${p.field} = ${JSON.stringify(wrong)}`);
            checked += 1;
          }
        }
        expect(checked).toBeGreaterThan(0);
      });

      it(`${reader} (${label}): (b) returns only checked fields of its kind, never an object of the answer`, async () => {
        const input = withExtras(inputOf(row), row.type);
        const { value, error } = await outcome(row.call, input);
        expect(error, `${reader} on its valid input with unchecked keys`).toBeUndefined();
        expect(conforms(value, row.ret), `${reader} returned ${JSON.stringify(value)}`).toBe(true);
        expect(JSON.stringify(value) ?? "").not.toContain("unchecked");
        const theirs = objectsOf(input);
        for (const o of objectsOf(value)) expect(theirs.has(o), `${reader} handed back an object of the answer`).toBe(false);
      });
    }
  }

  it("readers refuse a tool whose answer they do not know, outside the caller's error factory", () => {
    expect(() => contract.readArrayAnswer("get_people", [])).toThrow(/no bare-array answer is known/);
    expect(() => contract.readFindPage("get_views", [])).toThrow(/no record answer is known/);
    expect(() => contract.readWrittenId("find_people", {})).toThrow(/no write answer is known/);
    expect(() => contract.readCreatedEntity("get_views", [])).toThrow(/no created-object answer is known/);
    expect(() => contract.readAnswer("some_tool", {})).toThrow(/no answer is known/);
    expect(() => contract.readToolOutput("some_tool", callResultOf({}))).toThrow(/no answer is known/);
    expect(() => contract.readEntries("some_tool", [], "no such kind")).toThrow(/unknown entry kind/);
    return expect(contract.readAllPages(async () => ({ records: [], count: 0 }), {})).rejects.toThrow(/no record answer is known/);
  });

  it("a created view whose name is absent, null or not a string throws; its projection holds its id and name only", () => {
    for (const odd of [{ id: "v" }, { id: "v", name: null }, { id: "v", name: 7 }]) {
      expect(() => contract.readCreatedEntity("create_view", odd, mk)).toThrow(/create_view: unexpected answer shape \(name is .*, not a string, in answer \[created view\]\)/);
    }
    expect(contract.readCreatedEntity("create_view", fixture("create_view").answer)).toEqual({ id: "<uuid>", name: "cinatra-proof-list-<ns>" });
    expect(contract.readCreatedEntity("create_view_filter", fixture("create_view_filter").answer)).toEqual({
      id: "<uuid>", fieldMetadataId: "<uuid>", operand: "CONTAINS",
    });
  });

  it("a view filter's value is any JSON value: a string is kept, any other value is returned as a copy and is no list", () => {
    const f = (value) => [{ id: "f-1", viewId: "v-1", fieldMetadataId: "fm-1", operand: "CONTAINS", value }];
    expect(contract.readArrayAnswer("get_view_filters", f({ a: 1 }))[0].value).toEqual({ a: 1 });
    expect(contract.readListSlug(f(["a-1"]), "fm-1")).toBeNull();
    expect(contract.readListSlug(f(7), "fm-1")).toBeNull();
    expect(contract.readListSlug(f("a-1"), "fm-1")).toBe("a-1");
  });

  it("the slug helpers never read a slug list they cannot read as empty", () => {
    for (const bad of [7, null, "x", [null]]) {
      expect(() => contract.slugsWith(bad, "a-1")).toThrow(/must be an array of strings/);
      expect(() => contract.slugsWithout(bad, "a-1")).toThrow(/must be an array of strings/);
    }
    expect(() => contract.slugsWith(["a-1", 2], "b-2")).toThrow(/must be an array of strings/);
  });

  it("a malformed entry of a bare answer is never read as no list: get_views, get_view_filters and get_field_metadata", () => {
    const filters = JSON.parse(JSON.stringify(fixture("get_view_filters").answer).split("<ns>").join(NS));
    expect(() => contract.readListSlug([7, ...filters], "<uuid>")).toThrow(/get_view_filters: .*answer\[0\] is a number, not an object \[view filter\]/);
    expect(() => contract.readListSlug([...filters, { ...filters[0], operand: null }], "<uuid>")).toThrow(/operand is null/);
    expect(() => contract.readListFieldId([null, ...fixture("get_field_metadata.person").answer])).toThrow(/answer\[0\] is null/);
    expect(() => contract.readObjectIds([...fixture("get_object_metadata").answer, "person"])).toThrow(/answer\[2\] is a string/);
    expect(() => contract.readArrayAnswer("get_views", [...fixture("get_views").answer, { name: "no id" }])).toThrow(
      /get_views: unexpected answer shape \(id is absent, not a non-empty string, in answer\[1\] \[view\]\)/,
    );
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
    expect(san(contract.createFieldMetadataArgs({
      objectMetadataId: "11111111-2222-4333-8444-555555555555", name: "cinatraObjectId", type: "TEXT",
    }))).toEqual(fixture("create_field_metadata").args);
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
    }, { toolName: "find_people" });
    expect(rows).toHaveLength(230);
    expect(seen).toEqual([[100, 0], [100, 100], [100, 200]]);
    const capped = await contract.readAllPages(async ({ limit, offset }) => ({
      records: Array.from({ length: limit }, (_, i) => ({ id: `r${offset + i}` })),
      count: 1000,
    }), { want: 150, toolName: "find_people" });
    expect(capped).toHaveLength(150);
  });

  it("paging reads the string count live Twenty sends: 230 records as 100 + 100 + 30, stopping at the count", async () => {
    const seen = [];
    const rows = await contract.readAllPages(async ({ limit, offset }) => {
      seen.push([limit, offset]);
      const n = Math.max(0, Math.min(limit, 230 - offset));
      return { records: Array.from({ length: n }, (_, i) => ({ id: `r${offset + i}` })), count: "230" };
    }, { toolName: "find_people" });
    expect(rows).toHaveLength(230);
    expect(seen).toEqual([[100, 0], [100, 100], [100, 200]]);
    const exact = [];
    const two = await contract.readAllPages(async ({ limit, offset }) => {
      exact.push([limit, offset]);
      return { records: offset === 0 ? [{ id: "a" }, { id: "b" }] : [], count: "2" };
    }, { pageSize: 2, toolName: "find_people" });
    expect(two).toHaveLength(2);
    expect(exact).toEqual([[2, 0]]);
  });

  it("slugify trims its hyphens by index: trimHyphens is linear on a 100 000-character run (under 250 ms in all)", () => {
    const run = "-".repeat(100000);
    const t0 = performance.now();
    expect(contract.trimHyphens(run)).toBe("");
    expect(contract.trimHyphens(`${run}a`)).toBe("a");
    expect(contract.trimHyphens(`a${run}`)).toBe("a");
    expect(contract.trimHyphens(`${run}a${run}b${run}`)).toBe(`a${run}b`);
    expect(contract.trimHyphens(`${run}${"x".repeat(100000)}`)).toBe("x".repeat(100000));
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it("slugify keeps its slugs on 100 000 characters of separators and mixed separators (under 250 ms in all)", () => {
    expect(contract.slugify("Q4 Leaders")).toBe("q4-leaders");
    expect(contract.slugify("  --Q4 -- Leaders!! ")).toBe("q4-leaders");
    expect(contract.slugify("Ünïcode Name")).toBe("n-code-name");
    expect(contract.slugify("---")).toBe("");
    expect(contract.slugify(null)).toBe("");
    const t0 = performance.now();
    expect(contract.slugify("-".repeat(100000))).toBe("");
    expect(contract.slugify(`${"-_ .".repeat(25000)}Leaders${" .-_".repeat(25000)}`)).toBe("leaders");
    expect(contract.slugify(`a${"-".repeat(100000)}b`)).toBe("a-b");
    expect(contract.slugify(`${"-".repeat(100000)}x`)).toBe("x");
    expect(performance.now() - t0).toBeLessThan(250);
    for (const s of ["q4-leaders", "n-code-name", "leaders", "a-b", "x"]) expect(contract.isSlug(s), s).toBe(true);
  });
});

describe("the proof's recorder (recordAndRead): only the reader's projection is recorded, a failure before any projection", () => {
  const san = { ns: NS, keyName: "proof-key-1" };
  const own = new Set(["p-own"]);
  const NAME = "Jordan Sample";
  const EMAIL = "jordan.sample@example.com";

  for (const tool of ["find_people", "find_one_person"]) {
    it(`a failed ${tool} is recorded, then the tool's own failure is thrown (code -32000), never a TypeError`, () => {
      const calls = [];
      const failed = { success: false, message: `Failed to execute ${tool}`, error: "Invalid filter on inLists", detail: { name: NAME } };
      let thrown;
      try {
        recordAndRead(calls, { id: `${tool}.members`, tool, args: { limit: 100 }, result: callResult(failed), own, san });
      } catch (err) {
        thrown = err;
      }
      expect(calls).toEqual([{
        id: `${tool}.members`, tool, args: { limit: 100 },
        answer: { success: false, message: `Failed to execute ${tool}`, error: "Invalid filter on inLists", detail: "<object>" },
      }]);
      expect(thrown).toBeInstanceOf(contract.TwentyToolContractError);
      expect(thrown).not.toBeInstanceOf(TypeError);
      expect(thrown.code).toBe(-32000);
      expect(thrown.message).toBe(`${tool} failed: Invalid filter on inLists`);
      expect(JSON.stringify(calls)).not.toContain(NAME);
    });
  }

  it("a find answer with an extra result key carrying a name and an email records that key as its shape only; neither value reaches the record, the printed record or a drift line", () => {
    const calls = [];
    const answer = {
      success: true,
      message: `Found 1 person records for ${NAME}`,
      result: {
        records: [
          { id: "p-own", name: { firstName: "proof-in", lastName: "p-0" }, inLists: ["a-1"], email: EMAIL, position: 3 },
          { id: "p-other", name: { firstName: "Jordan", lastName: "Sample" }, emails: { primaryEmail: EMAIL }, inLists: [] },
        ],
        count: 2,
        people: [{ name: NAME, email: EMAIL }],
      },
      recordReferences: [{ recordId: "p-other", displayName: NAME }],
    };
    const read = recordAndRead(calls, { id: "find_people.members", tool: "find_people", args: { limit: 100 }, result: callResult(answer), own, san });
    expect(read.result.records.map((r) => r.id)).toEqual(["p-own", "p-other"]);
    expect(calls[0].answer).toEqual({
      success: true,
      message: "<string>",
      recordReferences: "<array>",
      result: {
        count: 2,
        people: "<array>",
        records: [{ id: "p-own", name: { firstName: "proof-in", lastName: "p-0" }, inLists: ["a-1"], email: "<string>", position: "<number>" }],
      },
    });
    const printed = canonicalJson({ calls, image: FIXTURES.image, source: "recorded", twentyTag: "2.7.3" });
    const drift = diffRecords(FIXTURES, { calls, image: FIXTURES.image, twentyTag: "2.7.3" }) ?? "";
    for (const text of [JSON.stringify(calls), printed, drift]) {
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain("Jordan");
      expect(text).not.toContain("p-other");
    }
  });

  it("every recorded value is a checked field: an unchecked key inside an entry or a created object is its shape only, and `keep` reads projections", () => {
    const calls = [];
    const views = [{ id: "v-1", name: "list-a", type: "TABLE", objectMetadataId: "o-1", note: NAME },
      { id: "v-2", name: "list-b", type: "TABLE", objectMetadataId: "o-1", note: EMAIL }];
    recordAndRead(calls, { id: "get_views", tool: "get_views", args: {}, result: callResult(views), own, san,
      keep: (a) => a.filter((v) => v.id === "v-1") });
    expect(calls[0].answer).toEqual([{ id: "v-1", name: "list-a", type: "TABLE", objectMetadataId: "o-1", note: "<string>" }]);
    recordAndRead(calls, { id: "create_view", tool: "create_view", args: {}, result: callResult({ id: "v-3", name: "list-c", owner: { email: EMAIL } }), own, san });
    expect(calls[1].answer).toEqual({ id: "v-3", name: "list-c", owner: "<object>" });
    expect(JSON.stringify(calls)).not.toMatch(/Jordan|example\.com|list-b/);
  });

  it("an answer the reader does not read, and an unparsable one, are recorded as their shape only, and the reader throws", () => {
    const calls = [];
    expect(() => recordAndRead(calls, { id: "find_people.members", tool: "find_people", args: {}, result: callResult({ people: [{ name: NAME }] }), own, san }))
      .toThrow(/find_people: unexpected answer shape/);
    expect(() => recordAndRead(calls, { id: "get_views", tool: "get_views", args: {}, result: { content: [{ type: "text", text: "not json" }] }, own, san }))
      .toThrow(/failed to parse/);
    expect(calls.map((c) => c.answer)).toEqual([{ shapeOnly: "object", keys: { people: "array" } }, { shapeOnly: "unparsable" }]);
    expect(JSON.stringify(calls)).not.toContain(NAME);
  });

  it("a call the proof does not name is read, never recorded", () => {
    const calls = [];
    expect(recordAndRead(calls, { id: null, tool: "create_person", args: {}, result: callResult({ success: true, result: { id: "w-1" } }) }))
      .toEqual({ success: true, result: { id: "w-1" } });
    expect(calls).toEqual([]);
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

  it("a record holds the fixtures' create_field_metadata call only from a fresh workspace: no create, or another field's, is never written", () => {
    expect(recordLib.freshFieldCreateRecorded(FIXTURES)).toBe(true);
    const none = { ...FIXTURES, calls: FIXTURES.calls.filter((c) => c.id !== "create_field_metadata") };
    expect(recordLib.freshFieldCreateRecorded(none)).toBe(false);
    expect(diffRecords(FIXTURES, none)).toMatch(/^create_field_metadata: committed, not recorded live/);
    const other = structuredClone(FIXTURES);
    other.calls.find((c) => c.id === "create_field_metadata").args = contract.createFieldMetadataArgs({
      objectMetadataId: "<uuid>", name: "apolloPersonId", type: "TEXT",
    });
    expect(recordLib.freshFieldCreateRecorded(other)).toBe(false);
    expect(diffRecords(FIXTURES, other)).toMatch(/^create_field_metadata: /);
    expect(recordLib.freshFieldCreateRecorded({ calls: [] })).toBe(false);
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

describe("the snapshot check (step 04c) leaves out only the environment-bound capturedFrom", () => {
  const SNAPSHOT = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../twenty-mcp-tools.json"), "utf8"));
  const copy = () => JSON.parse(JSON.stringify(SNAPSHOT));

  it("a snapshot that differs only in serverInfo.capturedFrom passes, and the written snapshot keeps that field", () => {
    const lane = copy();
    lane.serverInfo.capturedFrom = "http://localhost:24410";
    expect(snapshotLib.diffSnapshots(SNAPSHOT, lane)).toBeNull();
    expect(snapshotLib.ENVIRONMENT_BOUND_FIELDS).toEqual(["serverInfo.capturedFrom"]);
    const gone = copy();
    delete gone.serverInfo.capturedFrom;
    expect(snapshotLib.diffSnapshots(SNAPSHOT, gone)).toBeNull();
    expect(snapshotLib.canonicalizeSnapshot(lane)).toContain('"capturedFrom": "http://localhost:24410"');
  });

  it("a snapshot that differs in a tool byte, or in another serverInfo key, fails", () => {
    const tool = copy();
    tool.nativeTools[0].description = `${tool.nativeTools[0].description}.`;
    expect(snapshotLib.diffSnapshots(SNAPSHOT, tool)).toMatch(/^snapshots differ at byte \d+/);
    const both = copy();
    both.serverInfo.capturedFrom = "http://localhost:24410";
    both.nativeTools[0].name = `${both.nativeTools[0].name}x`;
    expect(snapshotLib.diffSnapshots(SNAPSHOT, both)).toMatch(/^snapshots differ at byte \d+/);
    const source = copy();
    source.serverInfo.source = "another-proof";
    expect(snapshotLib.diffSnapshots(SNAPSHOT, source)).toMatch(/^snapshots differ at byte \d+/);
    const extra = copy();
    extra.serverInfo.capturedAt = "x";
    expect(snapshotLib.diffSnapshots(SNAPSHOT, extra)).toMatch(/^snapshots differ at byte \d+/);
    const catalog = copy();
    catalog.workspaceCatalog = null;
    expect(snapshotLib.diffSnapshots(SNAPSHOT, catalog)).toMatch(/^snapshots differ at byte \d+/);
  });
});
