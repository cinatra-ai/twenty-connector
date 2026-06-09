# Testing Patterns

**Analysis Date:** 2026-06-09

## Test Framework

**Runner:**
- Vitest 4.x
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`) — no additional assertion library.

**Run Commands:**
```bash
pnpm test              # Run all tests (vitest run — non-watch)
```

No dedicated watch or coverage commands defined in `package.json`. Run `pnpm vitest --watch` or `pnpm vitest --coverage` manually if needed.

## Test File Organization

**Location:**
- All test files live in `src/__tests__/` — separate from source, not co-located.

**Naming:**
- Pattern: `<subject-description>.test.ts`
- Examples: `twenty-connector-impl.test.ts`, `raw-mcp-exposure.test.ts`

**Structure:**
```
src/
└── __tests__/
    ├── twenty-connector-impl.test.ts   # Active — runs in CI
    └── raw-mcp-exposure.test.ts        # Excluded from vitest.config.ts (requires DB)
```

## Test Structure

**Suite Organization:**
```typescript
describe("twentyConnector — contacts", () => {
  it("searchContacts maps Twenty Person rows to CrmContact shape", async () => {
    setupExecResult({ people: [...] });
    const out = await twentyConnector.searchContacts({ query: "ada", limit: 10 });
    expect(execMock).toHaveBeenCalledWith("find_people", { filter: { searchName: "ada" }, limit: 10 });
    expect(out).toEqual([{ id: "p-1", name: "Ada Lovelace", ... }]);
  });
});
```

**Patterns:**
- Top-level `beforeEach` resets all mocks and pre-populates the object-metadata cache via `_setObjectMetadataIds`.
- Each `it` block sets up mock return values, invokes the connector method, then asserts both the MCP call arguments and the mapped output shape.
- Tests that exercise the lazy-metadata-load path reset the cache with `_setObjectMetadataIds(null)` before the call and restore it after.
- `setupExecResult(parsedJson)` is a local helper that queues one `executeTwentyMcpTool` sentinel + one `readJsonContent` return value — keeps test bodies focused on intent.

## Mocking

**Framework:** Vitest's built-in `vi.mock` / `vi.fn` / `vi.mocked`.

**Patterns:**
```typescript
// Module-level mock at top of test file (hoisted automatically by Vitest)
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

// Typed mock references
const execMock = vi.mocked(executeTwentyMcpTool);
const readMock = vi.mocked(readJsonContent);

// Per-test setup helper
function setupExecResult(parsedJson: unknown) {
  const sentinel = { content: [{ type: "text" as const, text: "(mocked)" }] };
  execMock.mockResolvedValueOnce(sentinel);
  readMock.mockReturnValueOnce(parsedJson);
}

// Reset in beforeEach
beforeEach(() => {
  execMock.mockReset();
  readMock.mockReset();
  _setObjectMetadataIds({ contact: "obj-person", account: "obj-company" });
});
```

**What to Mock:**
- The MCP-call layer (`src/twenty-mcp-call.ts`): `executeTwentyMcpTool` and `readJsonContent` — isolates connector logic from network and the external MCP registry.
- The object-metadata cache via `_setObjectMetadataIds` (exported test escape hatch) — controls lazy-load path without issuing real calls.

**What NOT to Mock:**
- The connector implementation itself (`src/twenty-connector.ts`) — it is the system under test.
- Mapper functions (`mapPersonToContact`, `mapCompanyToAccount`) — tested implicitly through output shape assertions.

## Fixtures and Factories

**Test Data:**
```typescript
// Inline fixture objects built directly in each test:
setupExecResult({
  people: [{
    id: "p-1",
    name: { firstName: "Ada", lastName: "Lovelace" },
    emails: { primaryEmail: "ada@example.com" },
    jobTitle: "Mathematician",
    linkedinLink: { primaryLinkUrl: "https://linkedin.com/in/ada" },
    companyId: "c-1",
    inLists: ["leaders"],
    cinatraObjectId: "obj-1",
  }],
});
```

**Location:**
- No shared fixture files. All fixtures are inline per test. No factory helpers or seed files exist in this package.

## Coverage

**Requirements:** None enforced — no `coverage` threshold configuration in `vitest.config.ts`.

**View Coverage:**
```bash
pnpm vitest --coverage
```

## Test Types

**Unit Tests:**
- All tests in this package are unit tests against the connector's public interface (`twentyConnector.*` methods).
- Scope: mapping logic, MCP call argument shapes, null/missing-record handling, list membership operations, lazy metadata loading.

**Integration Tests:**
- Not present in this package. The `raw-mcp-exposure.test.ts` file is explicitly excluded from the vitest config because it requires live DB connectivity.

**E2E Tests:**
- Not used in this package.

## Common Patterns

**Async Testing:**
```typescript
it("searchContacts maps Twenty Person rows", async () => {
  setupExecResult({ people: [...] });
  const out = await twentyConnector.searchContacts({ query: "ada", limit: 10 });
  expect(out).toEqual([...]);
});
```

**Error Testing:**
```typescript
it("addListMember throws when the list doesn't exist", async () => {
  setupExecResult({ views: [] });
  await expect(
    twentyConnector.addListMember({ listId: "v-missing", objectId: "p-1", objectType: "contact" }),
  ).rejects.toBeInstanceOf(TwentyMcpError);
});

it("searchLists fails closed when metadata cannot be loaded", async () => {
  setupExecResult({ objectMetadata: [] });
  await expect(
    twentyConnector.searchLists({ query: "foo", objectType: "account" }),
  ).rejects.toThrow(/object metadata not available/);
});
```

**Negative Assertions (no `input` wrapper):**
```typescript
// Verifies top-level arg contract — NOT wrapped in an `input` field
const [, args] = execMock.mock.calls[0];
expect(args).not.toHaveProperty("input");
```

**Call Order Assertions:**
```typescript
expect(execMock).toHaveBeenNthCalledWith(1, "create_view", expect.objectContaining({...}));
expect(execMock).toHaveBeenNthCalledWith(2, "create_view_filter", expect.objectContaining({...}));
expect(execMock).toHaveBeenCalledTimes(3);
```

## Excluded Tests

`src/__tests__/raw-mcp-exposure.test.ts` is excluded via `vitest.config.ts`:
```typescript
exclude: [
  "**/node_modules/**",
  "src/__tests__/raw-mcp-exposure.test.ts",
],
```
Reason: imports `@/lib/external-mcp/twenty-execute-tool-proxy` which requires host DB setup not available in this standalone package. The file exists and should be wired once a DB-capable test harness is available.

## Vitest Config Notes

- `environment: "node"` — no jsdom, no browser environment.
- `include: ["src/**/*.test.ts"]` — picks up test files anywhere under `src/`.
- `server-only` module is aliased to a stub (`tests/__stubs__/server-only.ts`) resolved from the repo root three levels up (`../../..`) — this package assumes it runs inside a monorepo at a known depth.

---

*Testing analysis: 2026-06-09*
