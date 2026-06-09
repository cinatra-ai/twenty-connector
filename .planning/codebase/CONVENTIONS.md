# Coding Conventions

**Analysis Date:** 2026-06-09

## Naming Patterns

**Files:**
- `kebab-case` for all source files: `twenty-connector.ts`, `twenty-mcp-call.ts`, `api-key-store.ts`, `setup-page.tsx`
- Test files in `src/__tests__/` with suffix `.test.ts`: `twenty-connector-impl.test.ts`, `raw-mcp-exposure.test.ts`
- React components in `src/components/ui/` use `kebab-case.tsx`: `card.tsx`

**Functions:**
- camelCase for all functions: `executeTwentyMcpTool`, `readJsonContent`, `mapPersonToContact`, `slugify`, `combineName`, `splitName`
- Private/internal helpers use descriptive verb-noun pattern: `ensureObjectMetadataLoaded`, `readMembershipInLists`, `patchMembershipInLists`
- Handler functions end with `Handler`: `twentyStatusHandler`, `twentyInstancesListHandler`

**Variables:**
- camelCase throughout: `cachedObjectMetadataIds`, `metadataLoadInflight`, `wantedMetadataId`
- Mock variables in tests end in `Mock`: `execMock`, `readMock`

**Types:**
- PascalCase for all types and interfaces: `TwentyPerson`, `TwentyCompany`, `TwentyView`, `TwentyName`, `TwentyMcpError`, `TwentyConnectorDeps`
- Internal Twenty shapes prefixed with `Twenty`: `TwentyPerson`, `TwentyCompany`, `TwentyView`
- Error classes extend `Error` with explicit `name` property set in constructor

**Exports:**
- Internal-only test helpers exported with underscore prefix: `_setObjectMetadataIds` in `src/twenty-connector.ts`

## Code Style

**Formatting:**
- No Prettier or ESLint config detected in the repo root. TypeScript compiler enforces structure.
- Consistent 2-space indentation throughout all source files.
- Single quotes for string literals in most places; double quotes used in some JSX/TSX context.

**Linting:**
- `tsconfig.json` enforces `strict: true` with `noImplicitAny: false` as a deliberate override.
- `isolatedModules: true` and `verbatimModuleSyntax: true` — type-only imports must use `import type`.
- `forceConsistentCasingInFileNames: true`.

## Import Organization

**Order (observed in `src/twenty-connector.ts` and `src/twenty-mcp-call.ts`):**
1. Side-effect imports: `import "server-only";`
2. Node built-ins: `import { randomUUID } from "node:crypto";`
3. External packages with `import type` for type-only: `import type { CrmConnector, ... } from "@cinatra-ai/sdk-extensions";`
4. Internal relative imports: `import { executeTwentyMcpTool, ... } from "./twenty-mcp-call";`

**Path Aliases:**
- `@/` alias referencing the host app's `src/` directory — used in `src/twenty-mcp-call.ts` for `@/lib/external-mcp-registry`. This alias is provided by the consuming host, not defined in this package's `tsconfig.json`.

**`import type` usage:**
- Required by `verbatimModuleSyntax: true`. Type-only imports must use `import type`. Observed in `src/twenty-connector.ts` and `src/index.ts`.

## Error Handling

**Patterns:**
- Custom error classes: `TwentyMcpError` (numeric JSON-RPC `code` + optional `data`) and `TwentyConfigError` in `src/twenty-mcp-call.ts`. Both extend `Error` and set `this.name`.
- Catch-and-rethrow: upstream errors are caught, inspected, and re-thrown as `TwentyMcpError` with structured codes.
- Null-return pattern for "not found": methods like `getContact`, `getAccount`, `getList` return `null` rather than throwing when a record is absent (detected by `TwentyMcpError` message matching `/not.?found/i`).
- Fail-closed for required metadata: when `objectType` filtering requires metadata but none is loaded, throws immediately rather than silently degrading (`src/twenty-connector.ts` lines 266–273).
- Swallowed errors for best-effort side effects: `create_view_filter` failure is caught and discarded via `.catch(() => {})` with an explanatory comment (`src/twenty-connector.ts` line 326).
- All error codes use JSON-RPC standard codes: `-32603` (internal error), `-32602` (invalid params), `-32600` (invalid request), `-32000` (tool-level error).

## Logging

**Framework:** None — no logging library is used in this package.

**Patterns:**
- No `console.log` or structured logging observed. Error context is carried in thrown `TwentyMcpError` messages and `data` fields.

## Comments

**When to Comment:**
- File-level block comments describe module purpose, architectural boundaries, and key design decisions (present in every source file).
- Inline comments explain non-obvious behavior: why a specific API shape is used (top-level args vs `input` wrapper), caveats about Twenty's catalog tool contract.
- Stub/skeleton implementations marked explicitly with `/** Skeleton — not yet wired... */` comments (see `src/mcp/handlers.ts`).

**JSDoc/TSDoc:**
- JSDoc-style `/** ... */` used for exported functions: `executeTwentyMcpTool`, `readJsonContent`, `_setObjectMetadataIds`, `ensureObjectMetadataLoaded`.
- Parameters and return types documented inline for public API functions.

## Function Design

**Size:** Functions are small and single-purpose. Mapper functions (`mapPersonToContact`, `mapCompanyToAccount`, `contactToTopLevelArgs`) are pure transforms under ~30 lines each.

**Parameters:** Object destructuring used for named parameters in connector method signatures: `async searchContacts({ query, limit })`.

**Return Values:**
- Async methods return explicit typed Promises.
- Mapper functions return shaped objects directly — no intermediate variables for simple transforms.
- `null` used for optional/missing values (not `undefined`) in return shapes; internal fields use `?? null` or `?? []` coalescing.

## Module Design

**Exports:**
- `src/index.ts` is the sole public barrel. Named exports only — no default exports observed anywhere.
- Implementation files export only what is needed by `index.ts` or by tests.

**Barrel Files:**
- One barrel: `src/index.ts`. Sub-directories (`src/mcp/`, `src/components/`, `src/lib/`) do not have their own barrel files.

**`server-only` guard:**
- `import "server-only";` appears at the top of every server-side module (`src/twenty-connector.ts`, `src/twenty-mcp-call.ts`, `src/mcp/handlers.ts`, `src/deps.ts`) to prevent accidental client-side bundling.

---

*Convention analysis: 2026-06-09*
