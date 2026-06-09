<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                  Public API  (src/index.ts)                          │
│  registerTwentyProvider()  twentyConnector  registerTwentyConnector  │
│                            Primitives()     TwentyApiKeyConfig        │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────────┐
            ▼               ▼                   ▼
┌──────────────────┐ ┌────────────────┐ ┌─────────────────────┐
│  CrmConnector    │ │  MCP Module    │ │  Setup UI           │
│  Façade          │ │  (provider     │ │  src/setup-page.tsx │
│  src/twenty-     │ │  primitives)   │ │  src/twenty-setup-  │
│  connector.ts    │ │  src/mcp/      │ │  impl.tsx           │
└────────┬─────────┘ │  module.ts     │ └─────────────────────┘
         │           │  handlers.ts   │
         │           └────────────────┘
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   MCP Transport Layer                                │
│               src/twenty-mcp-call.ts                                 │
│  executeTwentyMcpTool()  readJsonContent()  TwentyMcpError           │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  JSON-RPC 2.0 / tools/call
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                Twenty MCP Server  (external)                         │
│       /mcp endpoint   →   execute_tool dispatcher                    │
│  catalog tools: find_people, create_person, update_person, ...       │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Public entry point | Exports connector, registers with CRM façade, re-exports config types | `src/index.ts` |
| CrmConnector impl | Maps cinatra-shape verbs (contacts, accounts, lists) to Twenty catalog tool calls | `src/twenty-connector.ts` |
| MCP transport | Resolves live Twenty row from external MCP registry, issues JSON-RPC `tools/call execute_tool`, parses SSE/JSON responses | `src/twenty-mcp-call.ts` |
| MCP module (provider primitives) | Registers `twenty_status` and `twenty_instances_list` tools on the host `ExtensionMcpToolServer` | `src/mcp/module.ts` |
| MCP handlers | Implements `twenty_status` and `twenty_instances_list` logic (skeleton stubs currently) | `src/mcp/handlers.ts` |
| API-key store | Types and stub functions for encrypted bearer persistence/retrieval | `src/api-key-store.ts` |
| Deps surface | `TwentyConnectorDeps` type — declares host facilities the connector consumes | `src/deps.ts` |
| Setup page | Server component shell mounting `TwentyConnectorSetupImpl` | `src/setup-page.tsx` |
| Setup impl | Full setup-page UI component | `src/twenty-setup-impl.tsx` |
| UI utilities | Shared `cn()` helper using `clsx` + `tailwind-merge` | `src/lib/utils.ts` |
| UI components | `Card` / `CardContent` etc. for setup UI | `src/components/ui/card.tsx` |

## Pattern Overview

**Overall:** Provider-Connector Pattern (Cinatra connector-instance surface)

**Key Characteristics:**
- The connector is a thin adapter: it implements the provider-agnostic `CrmConnector` interface from `@cinatra-ai/sdk-extensions` and maps its verbs to Twenty-specific MCP catalog tool names.
- All upstream I/O goes through a single transport function `executeTwentyMcpTool` in `src/twenty-mcp-call.ts`. No direct HTTP calls appear anywhere else.
- Field mapping is explicit: cinatra-shape types (`CrmContact`, `CrmAccount`, `CrmList`) are translated to/from Twenty's raw shapes (`TwentyPerson`, `TwentyCompany`, `TwentyView`) via pure mapper functions (`mapPersonToContact`, `contactToTopLevelArgs`, etc.).
- All files that touch the server runtime import `"server-only"` at the top, ensuring no leakage into client bundles.
- Module-level mutable state is used only for the lazy object-metadata cache in `src/twenty-connector.ts` (`cachedObjectMetadataIds`). A test escape hatch `_setObjectMetadataIds()` allows resetting the cache.

## Layers

**Public API Layer:**
- Purpose: Package entry point; re-exports stable symbols and registers with the cinatra CRM provider registry
- Location: `src/index.ts`
- Contains: `registerTwentyProvider()`, re-exports of `twentyConnector`, `registerTwentyConnectorPrimitives`, `TwentyApiKeyConfig`
- Depends on: `src/twenty-connector.ts`, `src/mcp/module.ts`, `src/api-key-store.ts`, `@cinatra-ai/sdk-extensions`
- Used by: Host application at boot

**CrmConnector Implementation Layer:**
- Purpose: Implements every verb in the `CrmConnector` interface against Twenty
- Location: `src/twenty-connector.ts`
- Contains: `twentyConnector` object, mapper functions, list/membership helpers, lazy metadata cache
- Depends on: `src/twenty-mcp-call.ts`
- Used by: `src/index.ts`, host via `CrmConnector` interface

**MCP Transport Layer:**
- Purpose: Single place that knows how to speak JSON-RPC to Twenty's `/mcp` endpoint; resolves the live Twenty row + bearer from the external MCP registry
- Location: `src/twenty-mcp-call.ts`
- Contains: `executeTwentyMcpTool()`, `readJsonContent()`, `TwentyMcpError`, `TwentyConfigError`, SSE parsing
- Depends on: `@/lib/external-mcp-registry` (host-provided), `node:crypto`
- Used by: `src/twenty-connector.ts`

**Provider Primitives Layer (MCP module):**
- Purpose: Registers connector-health tools (`twenty_status`, `twenty_instances_list`) on the host MCP tool server, parallel to wordpress/drupal patterns
- Location: `src/mcp/module.ts`, `src/mcp/handlers.ts`
- Contains: Tool registration, skeleton handler implementations
- Depends on: `@cinatra-ai/sdk-extensions`, `zod`
- Used by: Host at boot via `registerTwentyConnectorPrimitives(server)`

**Setup UI Layer:**
- Purpose: Server-rendered configuration page mounted by the host at `/connectors/cinatra-ai/twenty-connector/setup`
- Location: `src/setup-page.tsx`, `src/twenty-setup-impl.tsx`, `src/components/ui/card.tsx`, `src/lib/utils.ts`
- Contains: React server components, UI primitives, tailwind utilities
- Depends on: `react`, `@cinatra-ai/sdk-ui`, `clsx`, `tailwind-merge`
- Used by: Host via `src/lib/connector-setup-pages.ts`

**API Key Store Layer:**
- Purpose: Types and stub functions for storing/retrieving the encrypted Twenty bearer JWT
- Location: `src/api-key-store.ts`, `src/deps.ts`
- Contains: `TwentyApiKeyConfig` type, `persistTwentyApiKey()`, `loadTwentyApiKey()` (both skeleton stubs)
- Depends on: Nothing
- Used by: Host-side wiring (not yet completed)

## Data Flow

### Contact CRUD (primary path)

1. Caller invokes `twentyConnector.searchContacts({ query, limit })` (`src/twenty-connector.ts:152`)
2. Connector calls `executeTwentyMcpTool("find_people", { filter, limit })` (`src/twenty-mcp-call.ts:85`)
3. Transport resolves the live Twenty row via `getTwentyRow()` → `getExternalMcpServerById("twenty-workspace")` (host `@/lib/external-mcp-registry`)
4. Transport resolves the bearer via `resolveExternalMcpServerBearer(row)` and issues `POST row.serverUrl` with JSON-RPC `tools/call execute_tool`
5. Response (JSON or SSE) is parsed → `ToolsCallResult` returned
6. Connector calls `readJsonContent<{ people?: TwentyPerson[] }>(result)` to parse the text payload
7. Each `TwentyPerson` is mapped to `CrmContact` via `mapPersonToContact()` and returned to caller

### List membership mutation

1. Caller invokes `addListMember({ listId, objectId, objectType })`
2. Connector calls `getList({ id: listId })` → internally calls `get_views` and finds the matching view
3. Connector reads current `inLists` array via `readMembershipInLists(objectId, objectType)` (`find_one_person` or `find_one_company`)
4. Connector appends the list slug and calls `patchMembershipInLists(objectId, objectType, next)` (`update_person` or `update_company`)

### Provider primitive registration

1. Host calls `registerTwentyConnectorPrimitives(server)` at boot (`src/mcp/module.ts:21`)
2. Two tools (`twenty_status`, `twenty_instances_list`) are registered on the `ExtensionMcpToolServer`
3. When invoked, handlers in `src/mcp/handlers.ts` produce JSON results wrapped in MCP `content` shape

**State Management:**
- Module-level `cachedObjectMetadataIds` in `src/twenty-connector.ts` caches Twenty's person/company object-metadata IDs after the first `get_object_metadata` call. Guarded by an inflight promise to deduplicate concurrent callers. Exposed for testing via `_setObjectMetadataIds()`.

## Key Abstractions

**CrmConnector:**
- Purpose: Provider-agnostic interface for CRM operations defined in `@cinatra-ai/sdk-extensions`
- Examples: `src/twenty-connector.ts` (implementation), `src/index.ts` (registration)
- Pattern: Interface + concrete object literal; registered with `registerCrmProvider()` from SDK

**executeTwentyMcpTool:**
- Purpose: Single function encapsulating all JSON-RPC machinery; all catalog tool calls flow through it
- Examples: `src/twenty-mcp-call.ts:85`
- Pattern: Async function returning `ToolsCallResult`; errors surface as `TwentyMcpError`

**TwentyMcpError / TwentyConfigError:**
- Purpose: Typed errors distinguishing upstream JSON-RPC errors from configuration problems
- Examples: `src/twenty-mcp-call.ts:46-62`
- Pattern: Custom `Error` subclasses with structured `code` field

**Mapper functions:**
- Purpose: Pure functions translating between cinatra-shape and Twenty raw shapes
- Examples: `mapPersonToContact`, `mapCompanyToAccount`, `contactToTopLevelArgs`, `accountToTopLevelArgs` — all in `src/twenty-connector.ts`
- Pattern: Stateless pure functions; no side effects

## Entry Points

**Library entry point:**
- Location: `src/index.ts`
- Triggers: Imported by the host application at boot
- Responsibilities: Exports all public symbols; `registerTwentyProvider()` registers the connector with the cinatra CRM façade

**MCP primitives entry point:**
- Location: `src/mcp/module.ts` → `registerTwentyConnectorPrimitives(server)`
- Triggers: Called by the host when initializing the extension MCP tool server
- Responsibilities: Registers `twenty_status` and `twenty_instances_list` tools

**Setup page entry point:**
- Location: `src/setup-page.tsx` (default export `TwentyConnectorSetupPage`)
- Triggers: Host mounts at `/connectors/cinatra-ai/twenty-connector/setup`
- Responsibilities: Renders connector configuration UI

## Architectural Constraints

- **Server-only:** Every file in `src/` (except UI components) imports `"server-only"`. The connector MUST NOT be imported in client bundles.
- **No direct DB access:** The connector has no database client. Persistence is delegated to the host via the external MCP registry (`@/lib/external-mcp-registry`) and the (not yet implemented) `connector_config` encrypted-bearer store.
- **Global state:** `cachedObjectMetadataIds` and `metadataLoadInflight` are module-level singletons in `src/twenty-connector.ts`. This is intentional for server-side caching but means tests must call `_setObjectMetadataIds(null)` to reset state between test runs.
- **No circular imports:** Layers are strictly ordered: `index → twenty-connector → twenty-mcp-call`; `mcp/module → mcp/handlers`; UI components have no connector dependencies.
- **Top-level args contract:** Twenty's catalog tools require arguments at the top level of the call (not nested under an `input` field). This is a hard behavioral constraint documented and tested explicitly.

## Anti-Patterns

### Wrapping arguments under an `input` key

**What happens:** Passing `{ input: { name, email } }` to `executeTwentyMcpTool`
**Why it's wrong:** Twenty's catalog tools require top-level arguments; wrapping causes silent field drops and silently broken CRUD
**Do this instead:** Pass flat top-level args as done by `contactToTopLevelArgs()` / `accountToTopLevelArgs()` in `src/twenty-connector.ts:114-141`

### Reading connector secrets outside the transport layer

**What happens:** Any file other than `src/twenty-mcp-call.ts` resolving or logging the bearer JWT
**Why it's wrong:** Bearer tokens must never cross a wire boundary; resolution is intentionally isolated in the transport layer
**Do this instead:** Add new tool calls through `executeTwentyMcpTool()` in `src/twenty-mcp-call.ts`

## Error Handling

**Strategy:** Typed error classes surface structured failure modes; callers use `instanceof` checks.

**Patterns:**
- `TwentyConfigError`: Thrown when the Twenty workspace row is missing or disabled (configuration problem, not runtime error)
- `TwentyMcpError`: Thrown on upstream HTTP errors, JSON-RPC errors, `isError: true` tool results, or JSON parse failures; carries a numeric `code` field matching JSON-RPC error codes
- Not-found handling: `getContact` and `getAccount` catch `TwentyMcpError` with `/not.?found/i` message and return `null` instead of throwing
- Best-effort operations: `create_view_filter` call in `createList` uses `.catch(() => {})` — failure is tolerated because direct `inLists` membership patches keep working

## Cross-Cutting Concerns

**Logging:** Not present — no logging framework is imported. Errors propagate as exceptions.
**Validation:** Input validation is structural (TypeScript types). `zod` is used only in `src/mcp/module.ts` for MCP tool input schemas (`EmptySchema`).
**Authentication:** Bearer resolution is fully encapsulated in `src/twenty-mcp-call.ts:99` via `resolveExternalMcpServerBearer(row)` from the host registry.

---

*Architecture analysis: 2026-06-09*
