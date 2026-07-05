// Connector-owned dev-mode provisioning hook (cinatra-ai/cinatra#976, epic
// #978 wave W-D) — the Twenty block relocated VERBATIM-in-behavior from the
// host's `src/lib/dev-auto-setup.ts` behind the `cinatra.devSetup` manifest
// hook: wire the local docker Twenty stack (http://localhost:3300) into the
// host's external-MCP registry and auto-mint + attach a WORKING workspace
// API-key bearer (reuse-first, probe-then-rotate — never mint on a transient
// failure).
//
// Idempotent. Soft-fails (returns a status object) — never throws. SECRET
// BOUNDARY: the minted JWT is never logged; failure notes are fixed labels.
//
// SDK imports are TYPE-ONLY (host-peer value-import ban); the host services
// resolve at call time through the capability port on the hook context.

import type {
  ExtensionDevSetupContext,
  ExtensionDevSetupStatus,
  HostExternalMcpRegistryService,
  NangoSystemSurface,
} from "@cinatra-ai/sdk-extensions";

import {
  buildSeedDevArgs,
  buildGenerateApiKeyArgs,
  parseTwentyApiKey,
  probeTwentyBearer,
} from "./twenty-keygen.mjs";

export const LOCAL_TWENTY = {
  containerName: "cinatra-twenty-1",
  serverUrl: "http://localhost:3300",
  mcpUrl: "http://localhost:3300/mcp",
  rowId: "twenty-workspace",
  rowLabel: "Twenty CRM (local dev)",
  // Layer B catalog allowlist — the shared read-tool allowlist. Kept in
  // lockstep with the host's production UI connect flow (the host's
  // `TWENTY_LAYER_B_CATALOG_TOOLS` in external-mcp-registry.ts) so the dev
  // docker-mint path and the setup-page connect flow wire identical rows.
  allowedCatalogTools: [
    "find_companies",
    "find_people",
    "find_one_company",
    "find_one_person",
    "get_views",
  ] as string[],
} as const;

const TWENTY_DEV_API_KEY_NAME = "cinatra-dev-auto";

export type TwentyDevSetupDeps = {
  registry: Pick<HostExternalMcpRegistryService, "getServerById" | "upsertServer" | "resolveBearer" | "nangoProviderConfigKey">;
  nango: Pick<NangoSystemSurface, "isNangoConfigured" | "ensureNangoIntegration" | "importNangoConnection" | "getNangoCredentials">;
  helpers: ExtensionDevSetupContext["helpers"];
  log: (message: string) => void;
};

export type TwentyBearerOutcome = {
  nangoConnectionId: string | null;
  // True when a resolvable, authenticating bearer should exist after this call
  // (reused-OK, kept-on-transient-failure, or freshly minted + verified). False
  // means the connector will 401 — the caller surfaces a hint.
  working: boolean;
  minted: boolean;
  note?: string;
};

/**
 * Ensure the Twenty workspace row has a WORKING bearer, fully automatically:
 *   1. Reuse — if the row resolves to a bearer that authenticates ("ok"), keep
 *      it. On an INDETERMINATE probe ("unreachable": Twenty warming / 5xx /
 *      network) ALSO keep the existing key — do NOT mint (prevents key sprawl
 *      on transient failures). Only a DEFINITE "unauthorized" (401/403) or a
 *      missing credential falls through to minting a fresh key.
 *   2. If Nango is not configured we cannot persist a bearer the connector can
 *      resolve — leave the row as-is and report not-working (caller hints).
 *   3. Otherwise mint a fresh workspace API key via docker exec (seeding the
 *      Apple workspace first, both idempotent), import it into Nango under the
 *      registry's shared provider key, and readback-verify.
 * Soft-fails: any failure returns the prior connection id + a note, never throws.
 */
export async function ensureTwentyBearerAttached(
  deps: TwentyDevSetupDeps,
  existing: ReturnType<HostExternalMcpRegistryService["getServerById"]>,
): Promise<TwentyBearerOutcome> {
  const prior = existing?.nangoConnectionId ?? null;

  // 1. Reuse — and crucially, NEVER mint a duplicate on a transient failure.
  //    Once a connection already exists, the ONLY trigger to mint a fresh key
  //    is a DEFINITE auth failure (probe 401/403). A null/throwing credential
  //    resolution or an indeterminate probe is treated as transient: keep the
  //    existing connection, do not mint.
  if (prior && existing && deps.nango.isNangoConfigured()) {
    try {
      const bearer = await deps.registry.resolveBearer(existing);
      if (bearer) {
        const probe = await probeTwentyBearer({ baseUrl: LOCAL_TWENTY.serverUrl, apiKey: bearer });
        if (probe === "ok") {
          return { nangoConnectionId: prior, working: true, minted: false };
        }
        if (probe === "unreachable") {
          // Indeterminate (Twenty warming / 5xx / network) — keep the existing
          // key rather than minting a duplicate; it is almost certainly valid.
          return { nangoConnectionId: prior, working: true, minted: false, note: "probe-indeterminate (kept existing key)" };
        }
        // probe === "unauthorized" → key is genuinely stale; fall through to rotate.
      } else {
        // resolve returned null — could be a TRANSIENT Nango error OR a
        // genuinely missing credential. With a prior connection present we must
        // NOT mint: that would create a duplicate Twenty key on a transient
        // blip. Keep the connection and report not-working (operator hinted).
        return {
          nangoConnectionId: prior,
          working: false,
          minted: false,
          note: "credential-unresolved (kept connection; not minting to avoid a duplicate)",
        };
      }
    } catch {
      // resolve threw (transient) → keep the connection; do NOT mint a duplicate.
      return {
        nangoConnectionId: prior,
        working: false,
        minted: false,
        note: "credential-resolve-error (kept connection)",
      };
    }
  }

  // 2. No Nango → cannot persist a resolvable bearer.
  if (!deps.nango.isNangoConfigured()) {
    return { nangoConnectionId: prior, working: false, minted: false, note: "nango-not-configured" };
  }

  // 3. Mint + attach. The registry's shared Nango provider key is published as
  //    data on the capability (never hardcoded here) — a mismatch would leave
  //    the row's bearer resolution blind to the imported connection.
  const providerConfigKey = deps.registry.nangoProviderConfigKey;
  if (!providerConfigKey) {
    return { nangoConnectionId: prior, working: false, minted: false, note: "registry provider key unpublished (older host)" };
  }
  try {
    // ensure the Apple workspace exists (idempotent)
    deps.helpers.dockerExecCapture(LOCAL_TWENTY.containerName, buildSeedDevArgs());
    const minted = deps.helpers.dockerExecCapture(
      LOCAL_TWENTY.containerName,
      buildGenerateApiKeyArgs({ keyName: TWENTY_DEV_API_KEY_NAME }),
    );
    const jwt = parseTwentyApiKey(minted.out);
    if (!jwt) {
      return { nangoConnectionId: prior, working: false, minted: false, note: `mint-failed (exit ${minted.code})` };
    }
    const connectionId = prior ?? LOCAL_TWENTY.rowId;
    await deps.nango.ensureNangoIntegration({
      provider: "private-api-bearer",
      providerConfigKey,
      displayName: "Cinatra External MCP",
    });
    await deps.nango.importNangoConnection({
      providerConfigKey,
      connectionId,
      credentials: { type: "API_KEY", apiKey: jwt },
    });
    const readback = await deps.nango.getNangoCredentials(providerConfigKey, connectionId, {
      forceRefresh: true,
    });
    const readbackKey =
      readback && typeof readback === "object" && "apiKey" in readback
        ? (readback as { apiKey?: unknown }).apiKey
        : null;
    if (readbackKey !== jwt) {
      return { nangoConnectionId: prior, working: false, minted: false, note: "nango-readback-mismatch" };
    }
    return { nangoConnectionId: connectionId, working: true, minted: true };
  } catch (err) {
    return {
      nangoConnectionId: prior,
      working: false,
      minted: false,
      note: `attach-failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * The Twenty auto-setup body (exported for tests; `runDevSetup` wraps it with
 * capability resolution).
 */
export async function autoSetupLocalTwenty(deps: TwentyDevSetupDeps): Promise<ExtensionDevSetupStatus> {
  if (!deps.helpers.probeDockerContainer(LOCAL_TWENTY.containerName)) {
    return {
      status: "skipped",
      reason: `${LOCAL_TWENTY.containerName} not running (run docker compose --profile twenty up -d)`,
    };
  }
  if (!deps.helpers.probeHttp(`${LOCAL_TWENTY.serverUrl}/healthz`)) {
    return {
      status: "skipped",
      reason: `${LOCAL_TWENTY.serverUrl}/healthz not reachable yet (Twenty still booting)`,
    };
  }

  const existing = deps.registry.getServerById(LOCAL_TWENTY.rowId);

  // Auto-mint + attach a working bearer (reuse-first, soft-fail).
  const bearer = await ensureTwentyBearerAttached(deps, existing);

  try {
    deps.registry.upsertServer({
      id: LOCAL_TWENTY.rowId,
      label: LOCAL_TWENTY.rowLabel,
      serverUrl: LOCAL_TWENTY.mcpUrl,
      nangoConnectionId: bearer.nangoConnectionId,
      scope: "workspace",
      orgId: null,
      userId: null,
      enabled: true,
      // Layer A: leave native MCP tools unfiltered — `execute_tool`,
      // `get_tool_catalog`, `learn_tools`, `load_skills`, `search_help_center`
      // are all safe at this phase.
      allowedTools: null,
      // Layer B: curated catalog allowlist. The host proxy enforces this on
      // every execute_tool.
      allowedCatalogTools: [...LOCAL_TWENTY.allowedCatalogTools],
    });
  } catch (err) {
    return {
      status: "error",
      reason: `upsertExternalMcpServer failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Surface a hint whenever there is still no WORKING bearer (the connector
  // would 401) — including a stale connection id that is unresolvable because
  // Nango is not configured.
  if (!bearer.working) {
    deps.log(
      bearer.note === "nango-not-configured"
        ? "row wired but no working bearer: Nango is not configured. " +
            "Run `cinatra setup nango`; the next dev boot auto-mints + attaches a Twenty API key."
        : `row wired but bearer auto-attach did not complete (${bearer.note ?? "unknown"}). ` +
            "Agents get 401 until a key attaches; re-run once Twenty has finished booting.",
    );
  }

  const bearerNote = bearer.minted
    ? "bearer auto-minted + attached"
    : bearer.working
      ? "bearer present"
      : `no working bearer (${bearer.note ?? "unknown"})`;

  return {
    status: existing ? "already-wired" : "created",
    siteUrl: LOCAL_TWENTY.serverUrl,
    detail:
      `row ${LOCAL_TWENTY.rowId} ${existing ? "refreshed" : "created"} ` +
      `(${LOCAL_TWENTY.allowedCatalogTools.length} catalog tools allowed; ${bearerNote})`,
  };
}

// ---------------------------------------------------------------------------
// Capability resolution (structural narrowing; inlined id literals per the
// host-peer value-import ban).
// ---------------------------------------------------------------------------

function resolveImpl(ctx: ExtensionDevSetupContext, capability: string): unknown {
  return ctx.capabilities.resolveProviders(capability)[0]?.impl ?? null;
}

function isRegistryService(impl: unknown): impl is HostExternalMcpRegistryService {
  const c = impl as Partial<HostExternalMcpRegistryService> | null;
  return (
    !!c &&
    typeof c === "object" &&
    typeof c.getServerById === "function" &&
    typeof c.upsertServer === "function" &&
    typeof c.resolveBearer === "function"
  );
}

function isNangoSystemSurface(impl: unknown): impl is NangoSystemSurface {
  const c = impl as Partial<NangoSystemSurface> | null;
  return (
    !!c &&
    typeof c === "object" &&
    typeof c.isNangoConfigured === "function" &&
    typeof c.ensureNangoIntegration === "function" &&
    typeof c.importNangoConnection === "function" &&
    typeof c.getNangoCredentials === "function"
  );
}

/** The `cinatra.devSetup` entry point the host's dev-only shell invokes. */
export async function runDevSetup(ctx: ExtensionDevSetupContext): Promise<ExtensionDevSetupStatus> {
  const registryImpl = resolveImpl(ctx, "@cinatra-ai/host:external-mcp-registry");
  const nangoImpl = resolveImpl(ctx, "nango-system");
  if (!isRegistryService(registryImpl) || !isNangoSystemSurface(nangoImpl)) {
    return { status: "skipped", reason: "host services unresolved (external-mcp-registry / nango-system)" };
  }
  return autoSetupLocalTwenty({
    registry: registryImpl,
    nango: nangoImpl,
    helpers: ctx.helpers,
    log: ctx.log,
  });
}
