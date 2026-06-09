# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript — all source files under `src/` and config files (`tsconfig.json`, `vitest.config.ts`)
- TSX — React components: `src/components/ui/card.tsx`, `src/setup-page.tsx`, `src/twenty-setup-impl.tsx`

**Secondary:**
- Not applicable

## Runtime

**Environment:**
- Node.js (server-only module guard enforced via `import "server-only"` in all server modules)
- ES module mode (`"type": "module"` in `package.json`)

**Package Manager:**
- pnpm (lockfile: `pnpm-lock.yaml` present)
- Lockfile: present

## Frameworks

**Core:**
- React 19 (peer dependency `react: ^19.2.3`, `react-dom: ^19.2.3`) — UI components (`src/setup-page.tsx`, `src/twenty-setup-impl.tsx`, `src/components/ui/card.tsx`)

**Testing:**
- Vitest ^4.1.6 — test runner; config: `vitest.config.ts`; tests in `src/__tests__/`

**Build/Dev:**
- TypeScript compiler via `tsconfig.json` — targets ES2023, module ESNext, bundler resolution, emits to `dist/`

## Key Dependencies

**Critical:**
- `zod ^4.4.3` — runtime schema validation used in MCP tool input schemas (`src/mcp/module.ts`)
- `server-only 0.0.1` — enforces server-only boundary on all data-access and MCP call modules
- `@cinatra-ai/sdk-extensions` (peer, optional) — provides `CrmConnector`, `CrmContact`, `CrmAccount`, `CrmList`, `CrmListMembership`, `ExtensionMcpToolServer`, and `registerCrmProvider` interfaces consumed throughout `src/`
- `@cinatra-ai/sdk-ui` (peer, optional) — UI primitives for setup page components
- `@cinatra-ai/crm-connector` (cinatra connector dependency, runtime edge) — the provider-agnostic CRM facade that resolves this connector via `lookupCrmProvider("twenty")`

**Infrastructure:**
- `clsx ^2.1.1` — conditional className construction in UI components (`src/lib/utils.ts`)
- `tailwind-merge ^3.5.0` — Tailwind class merging utility (`src/lib/utils.ts`)

## Configuration

**Environment:**
- `.npmrc` present — note existence only, contents not read
- No `.env` files detected in the repo root
- Runtime secrets (Twenty API key bearer) are stored encrypted-at-rest via the `connector_config` envelope; decrypt/persist is declared in `src/api-key-store.ts` (skeleton, not yet wired)
- Bearer resolution at call time via `resolveExternalMcpServerBearer` from `@/lib/external-mcp-registry` (host-injected)

**Build:**
- `tsconfig.json` — strict mode, `isolatedModules`, `verbatimModuleSyntax`, `declaration + declarationMap + sourceMap`, outDir `dist/`, rootDir `src/`
- `vitest.config.ts` — aliases `server-only` to a test stub; excludes `src/__tests__/raw-mcp-exposure.test.ts`

## Platform Requirements

**Development:**
- Node.js runtime with ESM support
- pnpm for dependency management
- A stub for `server-only` required for test runs (referenced at `../../../tests/__stubs__/server-only.ts` relative to package, implying a monorepo context)
- Access to the `@cinatra-ai/sdk-extensions` and `@cinatra-ai/sdk-ui` packages (peer, optional at install time)

**Production:**
- Deployed as part of the cinatra platform; the connector registers itself into the SDK-hosted CRM provider registry at boot via `registerTwentyProvider()` (`src/index.ts`)
- Requires a running self-hosted Twenty instance (`twentycrm/twenty:v2.7.3`) reachable at the configured MCP server URL
- Server-side only — all data-access modules are marked `server-only`

---

*Stack analysis: 2026-06-09*
