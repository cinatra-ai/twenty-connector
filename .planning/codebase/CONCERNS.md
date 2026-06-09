# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**API-key store is entirely unimplemented:**
- Issue: Both `persistTwentyApiKey` and `loadTwentyApiKey` in `src/api-key-store.ts` immediately `throw new Error("skeleton — not yet implemented")`. No encryption envelope is wired. Any call path that depends on storing or retrieving a bearer (the full OAuth/API-key flow) will throw at runtime.
- Files: `src/api-key-store.ts`
- Impact: The setup page cannot mint or persist API keys. The connector can only function when an external-MCP-registry row is manually pre-inserted with a bearer already resolved by `resolveExternalMcpServerBearer`.
- Fix approach: Wire the existing `connector_config` encryption envelope used by wordpress-connector and drupal-connector (referenced in `src/api-key-store.ts` comments).

**`twenty_status` and `twenty_instances_list` MCP handlers are skeletons:**
- Issue: `twentyStatusHandler` always returns `{ reachable: false, bootstrapStatus: "skeleton" }` with a hardcoded message. `twentyInstancesListHandler` always returns `[]`. Neither reads from `connector_config` or `external_mcp_servers`, and no `healthz` probe is issued.
- Files: `src/mcp/handlers.ts`
- Impact: `twenty_status` is always wrong; `twenty_instances_list` is always empty. Any LLM agent calling these tools gets stale/misleading data.
- Fix approach: Implement the DB read from `external_mcp_servers` and issue a `GET /healthz` probe against the configured `serverUrl`.

**Setup page UI is a placeholder with no functionality:**
- Issue: `TwentyConnectorSetupImpl` renders static text instructing users to bootstrap manually via docker. No form, no bearer minting, no row insertion.
- Files: `src/twenty-setup-impl.tsx`
- Impact: Admins cannot configure the connector via the UI; only manual docker-based bootstrapping works.
- Fix approach: Wire the setup form to `persistTwentyApiKey` once the store is implemented.

**`getList` fetches all views to find one:**
- Issue: `getList({ id })` calls `get_views` (which returns ALL workspace views) then does a linear scan to find the matching id. Twenty has no `find_one_view` catalog tool.
- Files: `src/twenty-connector.ts` (line 289–295)
- Impact: Performance degrades linearly with workspace view count. `addListMember` and `removeListMember` each also call `getList`, multiplying this cost on every membership operation.
- Fix approach: Cache resolved views or wait for Twenty to expose a `find_one_view` catalog tool; at minimum document the N-views cost in method JSDoc.

**`addListMember` / `removeListMember` — non-atomic read-modify-write on `inLists`:**
- Issue: Both methods do `readMembershipInLists` then `patchMembershipInLists` as two separate MCP round-trips with no locking. Concurrent calls can silently clobber each other's membership changes.
- Files: `src/twenty-connector.ts` (lines 359–377)
- Impact: Race condition in concurrent list-membership updates; a member added by one caller can be silently dropped when a concurrent caller writes back a stale `inLists` array.
- Fix approach: Use a server-side atomic append/remove if Twenty exposes one, or serialize calls via a per-object lock/queue.

**`slugify` is called on view names for list slug derivation — no collision detection:**
- Issue: `mapViewToList` calls `slugify(v.name ?? v.id)`. Multiple views with similar names (e.g. "Leaders 2024" and "Leaders 2025") can produce the same slug. List membership uses slugs as set identifiers in the `inLists` string array; collisions silently merge separate lists.
- Files: `src/twenty-connector.ts` (lines 384–395)
- Impact: List membership data corruption when two views share the same slug. Silent — no error is raised.
- Fix approach: Include the view id in the slug derivation or enforce slug uniqueness at create time.

**Module-level mutable singletons for metadata cache are never reset between requests:**
- Issue: `cachedObjectMetadataIds` and `metadataLoadInflight` are module-level variables. In a long-running Node.js server process they persist across all requests. If Twenty workspace object metadata changes (e.g. after a migration), the cache is never invalidated.
- Files: `src/twenty-connector.ts` (lines 401–402)
- Impact: Stale metadata IDs cause `viewObjectTypeFor` to misclassify views (defaulting to `"contact"`) or `createList`/`searchLists` to use wrong metadata IDs after a workspace reconfiguration.
- Fix approach: Add TTL-based cache invalidation or a `resetObjectMetadataCache()` export callable after workspace reconfiguration.

## Known Bugs

**`getContact` and `getAccount` silently swallow non-"not found" upstream errors:**
- Symptoms: If Twenty returns a 500 or a generic `TwentyMcpError` whose message does not match `/not.?found/i`, both `getContact` and `getAccount` re-throw correctly. However, the regex `/not.?found/i` is fragile; an upstream message like "record does not exist" would cause a re-throw instead of returning `null`, breaking callers that expect null for missing records.
- Files: `src/twenty-connector.ts` (lines 162–173, 219–231)
- Trigger: Twenty changes its "not found" error message wording.
- Workaround: None; callers will receive a `TwentyMcpError` instead of `null`.

**`createList` silently ignores `create_view_filter` failures:**
- Symptoms: When `create_view_filter` fails (e.g. due to schema mismatch), the `.catch(() => {})` swallows the error. The list is created in Twenty but the `inLists CONTAINS <slug>` filter is not attached. The list appears to work for membership operations but the Twenty view will not visually reflect list members.
- Files: `src/twenty-connector.ts` (lines 321–328)
- Trigger: Any Twenty version where the `create_view_filter` payload shape differs from what the connector sends.
- Workaround: Manually add the filter in the Twenty UI.

## Security Considerations

**Bearer token attaches without validation of `serverUrl`:**
- Risk: `executeTwentyMcpTool` attaches the bearer JWT to any `serverUrl` stored in the external MCP registry row. If the row's `serverUrl` is modified to point at an attacker-controlled server, the bearer is leaked.
- Files: `src/twenty-mcp-call.ts` (lines 99–104, 118)
- Current mitigation: The registry row is presumably operator-managed; no URL allowlist or scheme check is present in this package.
- Recommendations: Validate `serverUrl` scheme (`https://` only in production) and optionally pin to a known hostname prefix before attaching the bearer.

**Fallback server lookup uses case-insensitive label match (`/twenty/i`):**
- Risk: `getTwentyRow` falls back to any workspace-scope row whose label matches `/twenty/i`. An operator who names another row "Twenty Backup" or "Not-Twenty" could inadvertently route bearer tokens to the wrong server.
- Files: `src/twenty-mcp-call.ts` (lines 37–43)
- Current mitigation: Only workspace-scope rows are matched; `enabled` is checked.
- Recommendations: Remove the fuzzy fallback or narrow the label match to an exact string. Prefer explicit `TWENTY_WORKSPACE_ROW_ID` lookup only.

**`_setObjectMetadataIds` is exported as a public API:**
- Risk: The internal cache reset function `_setObjectMetadataIds(null)` is exported from `src/index.ts` (via `src/twenty-connector.ts`). Any consumer package can reset or spoof the metadata cache, causing incorrect view-to-type mappings.
- Files: `src/twenty-connector.ts` (line 452), `src/index.ts`
- Current mitigation: The leading underscore signals internal use by convention.
- Recommendations: Restrict export to test environments via a conditional export or move test helpers to a separate entry point not published in the package surface.

## Performance Bottlenecks

**`get_views` fetched for every single-list lookup:**
- Problem: `getList`, `addListMember`, and `removeListMember` all call `get_views` (all workspace views) each time. With 100+ views this is a large payload parsed on every membership operation.
- Files: `src/twenty-connector.ts` (lines 289–295, 359–368, 370–377)
- Cause: No `find_one_view` in the Twenty catalog; no local view cache.
- Improvement path: Cache views with a short TTL (e.g. 30 s) or pre-resolve `listId → slug` at a higher layer to avoid repeated full-list fetches.

**`getListMembers` issues `get_views` + a full `find_people`/`find_companies` with `limit: 1000`:**
- Problem: `getListMembers` first calls `getList` (which fetches all views) then issues a `find_people` or `find_companies` with a hard limit of 1000. For large workspaces this returns up to 1000 records only to extract their IDs.
- Files: `src/twenty-connector.ts` (lines 334–357)
- Cause: No Twenty API for fetching only IDs or paginating beyond the limit.
- Improvement path: Accept a cursor/page parameter; expose pagination to callers rather than silently capping at 1000.

## Fragile Areas

**`readJsonContent` assumes the first `type: "text"` content entry contains valid JSON:**
- Files: `src/twenty-mcp-call.ts` (lines 168–183)
- Why fragile: Twenty tool responses that return non-JSON text (e.g. error strings, HTML error pages from a misconfigured proxy) will throw a `TwentyMcpError` with a JSON parse error rather than the original error message, losing diagnostic context.
- Safe modification: Add a content-type sniff or check `entry.text` for a leading `{`/`[` before attempting parse; include the raw text in the thrown error.
- Test coverage: Not tested for malformed/non-JSON upstream responses.

**`parseSseEnvelope` only reads the first `data:` line:**
- Files: `src/twenty-mcp-call.ts` (lines 185–199)
- Why fragile: If Twenty sends a multi-event SSE stream (keepalive, then data), `dataLines[0]` is the keepalive, not the JSON-RPC envelope. The parse will fail silently.
- Safe modification: Skip `data: ` lines that parse as non-objects (`:` keepalive comments) or find the line containing a valid JSON-RPC envelope.
- Test coverage: No SSE-specific unit tests.

**`viewObjectTypeFor` defaults to `"contact"` for unknown metadata IDs:**
- Files: `src/twenty-connector.ts` (line 446)
- Why fragile: Any view whose `objectMetadataId` is not in the two-entry cache silently resolves as `"contact"`. This includes account-typed views before metadata is loaded, custom object views, and views created after a workspace reconfiguration. Callers will dispatch `find_people` instead of `find_companies`.
- Safe modification: Return `"unknown"` or throw when the ID is unrecognized; never silently default.
- Test coverage: Not tested for unrecognized metadata IDs.

## Scaling Limits

**`inLists` string array stored per-record in Twenty:**
- Current capacity: No documented limit; Twenty stores as a JSON array column.
- Limit: Very large numbers of lists per record (hundreds) will make every read/write of the record carry a large array, slowing `update_person`/`update_company` and `find_one_person`/`find_one_company` response sizes.
- Scaling path: Consider a join-table approach in a future Twenty schema migration rather than embedding list membership in the record.

## Dependencies at Risk

**`zod` at `^4.4.3`:**
- Risk: Zod v4 is a major version with breaking changes from v3. The rest of the cinatra monorepo may pin zod v3. If both are present, schema instances from different major versions are incompatible (`.parse` cross-version throws).
- Impact: Type mismatch errors at runtime if zod schemas from this package are used alongside v3 schemas in the host app.
- Migration plan: Align zod version with the monorepo's canonical version; avoid mixing majors.

**`server-only` at `0.0.1`:**
- Risk: This is a stub package that may not enforce server-only semantics in all bundler configurations. The `import "server-only"` guard in multiple source files relies on the bundler throwing on client-side import; if the bundler does not support this pattern the guard is silently a no-op.
- Impact: Bearer tokens and MCP call logic could be bundled into client-side code without error.
- Migration plan: Verify bundler enforcement is active; add runtime checks if needed.

## Missing Critical Features

**No end-to-end setup flow:**
- Problem: There is no working UI or programmatic flow to mint a Twenty API key, encrypt it, and insert the `external_mcp_servers` row. Both `persistTwentyApiKey` and `loadTwentyApiKey` throw "not implemented".
- Blocks: Cannot deploy this connector to a new workspace without manual database intervention and docker CLI commands.

**No delete operations for contacts, accounts, or lists:**
- Problem: `CrmConnector` CRUD surface has no `deleteContact`, `deleteAccount`, or `deleteList` methods; Twenty does expose delete tools (`delete_person`, `delete_company`). Whether the interface requires them is unclear, but list lifecycle is incomplete.
- Blocks: Callers cannot clean up test data or remove stale CRM records via the connector API.

**`twenty_instances_list` always returns empty:**
- Problem: `twentyInstancesListHandler` returns `[]` unconditionally. Callers (LLM agents, monitoring) cannot enumerate configured Twenty instances.
- Blocks: Multi-instance support advertised in README is not functional.

## Test Coverage Gaps

**`raw-mcp-exposure.test.ts` is permanently excluded from the test run:**
- What's not tested: The Layer B catalog allowlist (`validateExecuteToolCall`) is not executed in CI. The test file is excluded in `vitest.config.ts` with the comment "this test was never actually running pre-this-PR".
- Files: `src/__tests__/raw-mcp-exposure.test.ts`, `vitest.config.ts`
- Risk: Security regressions in the MCP tool allowlist go undetected.
- Priority: High — this is a security enforcement layer.

**No tests for `executeTwentyMcpTool` error paths:**
- What's not tested: Upstream HTTP errors (4xx, 5xx), SSE response parsing, non-JSON upstream responses, `TwentyConfigError` when no row is configured, disabled-row rejection.
- Files: `src/twenty-mcp-call.ts`
- Risk: Regressions in error handling and SSE parsing are invisible.
- Priority: High.

**No tests for `api-key-store.ts`:**
- What's not tested: `persistTwentyApiKey` and `loadTwentyApiKey` behavior once implemented.
- Files: `src/api-key-store.ts`
- Risk: Store implementation ships without validation.
- Priority: Medium (deferred until implementation lands).

**No tests for `getTwentyRow` fallback path:**
- What's not tested: The fuzzy label-match fallback in `getTwentyRow` (lines 37–43 of `src/twenty-mcp-call.ts`) is never exercised by any test.
- Files: `src/twenty-mcp-call.ts`
- Risk: Fallback silently routes to wrong server; regression undetected.
- Priority: Medium.

**No tests for `parseSseEnvelope`:**
- What's not tested: SSE multi-line streams, keepalive lines, malformed SSE bodies.
- Files: `src/twenty-mcp-call.ts`
- Risk: Silent failures for SSE-mode Twenty deployments.
- Priority: Medium.

---

*Concerns audit: 2026-06-09*
