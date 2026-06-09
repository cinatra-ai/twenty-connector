# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Twenty CRM (self-hosted):**
- Twenty CRM MCP server — the primary upstream; all CRM operations (contacts, accounts, lists) are dispatched as JSON-RPC `tools/call` with `name: "execute_tool"` to the Twenty `/mcp` endpoint
  - SDK/Client: native `fetch` via `src/twenty-mcp-call.ts`; no dedicated SDK package
  - Auth: encrypted API key bearer (JWT minted via Twenty's `workspace:generate-api-key` CLI); resolved at call time via `resolveExternalMcpServerBearer` from host `@/lib/external-mcp-registry`
  - Protocol: JSON-RPC 2.0 over HTTP POST; supports both `application/json` and `text/event-stream` (Streamable HTTP MCP spec) responses — SSE parsing in `parseSseEnvelope` (`src/twenty-mcp-call.ts`)
  - Row lookup: resolves the workspace MCP server row by id `"twenty-workspace"` or falls back to any enabled workspace-scope row with a label matching `/twenty/i` (`src/twenty-mcp-call.ts` → `getTwentyRow`)
  - Catalog tools invoked: `find_people`, `find_one_person`, `create_person`, `update_person`, `find_companies`, `find_one_company`, `create_company`, `update_company`, `get_views`, `create_view`, `create_view_filter`, `get_object_metadata`

**Cinatra Platform (host SDK):**
- `@cinatra-ai/sdk-extensions` — provides `registerCrmProvider`, `CrmConnector` interface, and `ExtensionMcpToolServer`; consumed in `src/index.ts` and `src/mcp/module.ts`
- `@cinatra-ai/crm-connector` — the CRM facade connector; resolved at runtime as a required connector dependency (declared in `package.json` `cinatra.dependencies`)
- `@/lib/external-mcp-registry` — host-injected module that provides `getExternalMcpServerById`, `listExternalMcpServers`, `resolveExternalMcpServerBearer`; imported directly via path alias `@/` in `src/twenty-mcp-call.ts`

## Data Storage

**Databases:**
- Not applicable — this connector package contains no direct database access
- Encrypted API key storage is delegated to the host's `connector_config` encryption envelope; the `persistTwentyApiKey` / `loadTwentyApiKey` functions in `src/api-key-store.ts` are declared as skeletons (not yet wired to the DB layer)

**File Storage:**
- Not applicable

**Caching:**
- In-process module-level cache for Twenty object metadata IDs (person/company `objectMetadataId`); implemented in `src/twenty-connector.ts` via `cachedObjectMetadataIds` and `metadataLoadInflight` (lazy-load, deduplication, soft-fail on error, resettable via `_setObjectMetadataIds`)

## Authentication & Identity

**Auth Provider:**
- Twenty API key (bearer JWT) — not OAuth `client_credentials`; Twenty's OAuth only supports `authorization_code` + `refresh_token`
  - Implementation: encrypted-at-rest bearer storage declared in `src/api-key-store.ts` (`TwentyApiKeyConfig` type); actual encrypt/decrypt against `connector_config` row is not yet implemented (skeleton)
  - At call time: bearer is resolved server-side via `resolveExternalMcpServerBearer(row)` from the host registry and attached as `Authorization: Bearer <token>` header in `executeTwentyMcpTool` (`src/twenty-mcp-call.ts`)
  - Bearer is never returned across a wire boundary (in-process server-side only)

## Monitoring & Observability

**Error Tracking:**
- Not detected — no dedicated observability SDK integrated

**Logs:**
- No explicit logging framework; errors propagate as `TwentyMcpError` or `TwentyConfigError` typed exceptions (`src/twenty-mcp-call.ts`)

## CI/CD & Deployment

**Hosting:**
- Deployed as part of the cinatra platform monorepo; no standalone deployment config detected in this package
- Works with self-hosted Twenty (`twentycrm/twenty:v2.7.3`) via Docker stack (referenced in README as `docker-compose.yml --profile twenty` — not present in this package)

**CI Pipeline:**
- `.github/` directory present; contents not inspected

## Environment Configuration

**Required env vars:**
- None declared directly in this package; all secrets are resolved at runtime via the host's external MCP registry and `connector_config` encryption layer
- No `.env` files detected

**Secrets location:**
- Encrypted bearer stored in the host's `connector_config` database row (not yet wired in this package)
- At runtime: resolved via `@/lib/external-mcp-registry` (host-injected)

## Webhooks & Callbacks

**Incoming:**
- Not applicable — this package is a connector library, not an HTTP server

**Outgoing:**
- All outbound HTTP calls are to the Twenty MCP server endpoint (`row.serverUrl + /mcp`) via `executeTwentyMcpTool` in `src/twenty-mcp-call.ts`

## MCP Primitives Exposed

This connector registers two provider-specific MCP tools via `registerTwentyConnectorPrimitives` (`src/mcp/module.ts`):

- `twenty_status` — reports connector health (reachability + bootstrap status); currently returns a skeleton response (`src/mcp/handlers.ts`)
- `twenty_instances_list` — lists configured Twenty connector instances; currently returns empty array (`src/mcp/handlers.ts`)

---

*Integration audit: 2026-06-09*
