# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
twenty-connector/
├── src/
│   ├── __tests__/                  # Vitest test suites (co-located under src)
│   │   ├── raw-mcp-exposure.test.ts
│   │   └── twenty-connector-impl.test.ts
│   ├── components/
│   │   └── ui/
│   │       └── card.tsx            # Shared Card UI component for setup page
│   ├── lib/
│   │   └── utils.ts                # cn() helper (clsx + tailwind-merge)
│   ├── mcp/
│   │   ├── handlers.ts             # twenty_status / twenty_instances_list logic
│   │   └── module.ts               # MCP tool registration (registerTwentyConnectorPrimitives)
│   ├── api-key-store.ts            # TwentyApiKeyConfig type + stub bearer persistence
│   ├── deps.ts                     # TwentyConnectorDeps interface (host facility contracts)
│   ├── index.ts                    # Package entry point (public exports)
│   ├── setup-page.tsx              # Server component: connector setup page shell
│   ├── twenty-connector.ts         # CrmConnector implementation
│   ├── twenty-mcp-call.ts          # MCP transport (JSON-RPC to Twenty /mcp)
│   └── twenty-setup-impl.tsx       # Full setup UI component
├── .github/
│   └── workflows/
│       ├── ci.yml                  # CI pipeline
│       └── release.yml             # Release pipeline
├── LICENSE
├── README.md
├── package.json                    # Package manifest with cinatra connector metadata
├── pnpm-lock.yaml
├── tsconfig.json
└── vitest.config.ts
```

## Directory Purposes

**`src/`:**
- Purpose: All source code. Consumed as TypeScript source directly (no build step — `"main": "./src/index.ts"`)
- Contains: Connector implementation, MCP transport, setup UI, tests
- Key files: `src/index.ts` (entry), `src/twenty-connector.ts` (core logic), `src/twenty-mcp-call.ts` (transport)

**`src/__tests__/`:**
- Purpose: Vitest test suites
- Contains: Integration-style unit tests that mock the MCP transport layer
- Key files: `src/__tests__/twenty-connector-impl.test.ts` (comprehensive connector tests), `src/__tests__/raw-mcp-exposure.test.ts`

**`src/mcp/`:**
- Purpose: Provider-primitive MCP tools (`twenty_status`, `twenty_instances_list`) parallel to wordpress/drupal patterns
- Contains: Tool registration module and handler implementations
- Key files: `src/mcp/module.ts`, `src/mcp/handlers.ts`

**`src/components/ui/`:**
- Purpose: Low-level React UI primitives used by the setup page
- Contains: `card.tsx` — reusable Card layout component
- Generated: No

**`src/lib/`:**
- Purpose: Shared utility functions for the UI layer
- Contains: `utils.ts` with `cn()` helper combining `clsx` and `tailwind-merge`

## Key File Locations

**Entry Points:**
- `src/index.ts`: Package public API — all consumers import from here
- `src/setup-page.tsx`: Default export mounted by the host as the connector setup page

**Configuration:**
- `package.json`: NPM manifest; also contains `"cinatra"` metadata block declaring `kind: "connector"` and runtime dependency on `@cinatra-ai/crm-connector`
- `tsconfig.json`: TypeScript configuration
- `vitest.config.ts`: Test runner configuration

**Core Logic:**
- `src/twenty-connector.ts`: Full `CrmConnector` implementation — contacts, accounts, lists, membership
- `src/twenty-mcp-call.ts`: JSON-RPC transport to Twenty's MCP endpoint
- `src/api-key-store.ts`: Encrypted bearer type definitions and stubs
- `src/deps.ts`: Host-facility dependency interface (`TwentyConnectorDeps`)

**Testing:**
- `src/__tests__/twenty-connector-impl.test.ts`: Main connector test suite
- `src/__tests__/raw-mcp-exposure.test.ts`: MCP transport exposure tests

## Naming Conventions

**Files:**
- Kebab-case for all TypeScript source files: `twenty-connector.ts`, `twenty-mcp-call.ts`, `api-key-store.ts`
- `*.tsx` for files containing JSX: `setup-page.tsx`, `twenty-setup-impl.tsx`, `card.tsx`
- `*.test.ts` suffix for test files (no `.spec.ts` variant used)

**Directories:**
- Lowercase kebab-case: `__tests__/`, `components/`, `ui/`, `lib/`, `mcp/`
- `__tests__` convention for test directory (double-underscore, under `src/`)

**Exports:**
- Named exports throughout; the only default export is the React page component in `src/setup-page.tsx`
- Internal test-escape-hatch exports prefixed with underscore: `_setObjectMetadataIds`
- Error classes: PascalCase with descriptive suffix — `TwentyMcpError`, `TwentyConfigError`

**Types:**
- Internal Twenty raw shapes prefixed with `Twenty`: `TwentyPerson`, `TwentyCompany`, `TwentyView`
- Public types use cinatra-shape names from the SDK: `CrmContact`, `CrmAccount`, `CrmList`
- Config types exported with `Config` suffix: `TwentyApiKeyConfig`

## Where to Add New Code

**New CRM verb (e.g., `deleteContact`):**
- Implementation: Add method to the `twentyConnector` object in `src/twenty-connector.ts`
- If a new mapper is needed, add it as a pure function in the same file
- Tests: Add a `describe` block in `src/__tests__/twenty-connector-impl.test.ts`

**New provider-primitive MCP tool (e.g., `twenty_health_check`):**
- Handler logic: `src/mcp/handlers.ts`
- Tool registration: `src/mcp/module.ts` → `registerTwentyConnectorPrimitives()`
- Follow the `twenty_status` pattern: zod schema + `jsonResult()` wrapper

**New transport utility:**
- Add to `src/twenty-mcp-call.ts` and export from there
- Do NOT add HTTP calls or bearer resolution in any other file

**New UI component for setup:**
- Add under `src/components/ui/` using the `card.tsx` pattern
- Use `cn()` from `src/lib/utils.ts` for class merging

**New shared type or host-facility contract:**
- Provider-facing types: `src/deps.ts`
- API-key / config types: `src/api-key-store.ts`
- Public re-exports: add to `src/index.ts`

## Special Directories

**`.github/workflows/`:**
- Purpose: CI and release pipelines
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents
- Generated: Yes (by gsd-map-codebase)
- Committed: Optional (project-specific)

---

*Structure analysis: 2026-06-09*
