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
// HOST-HANDED KEY (cinatra#4098): a preview container carries no docker and no
// curl, so the docker probe fails and the docker mint cannot run. The install
// then mints the workspace key on the machine and hands it to the container in
// the env var this package declares in its manifest `cinatra.envOverrides`
// (`secrets:devApiKey`). The hook never reads the process environment itself:
// it reads the key through the host's env-override reader on the
// `@cinatra-ai/host:connector-config` capability. The handed key is used ONLY
// when the docker probe fails, and ONLY where the docker road would mint.
//
// THE REFUSED FIXTURE'S CONNECTION (cinatra#4112, cinatra#4137): when a boot
// refuses the development fixture account, the host makes the install's
// connections for the instance's first administrator. A Twenty connection an
// earlier boot made for the fixture account is handed to that administrator
// FIRST, before this hook reuses, mints or attaches anything: the hook asks the
// host's generic hand-over helper (`helpers.reownRefusedFixtureConnection`)
// for its own row and answers the helper's key check with the same REST probe
// the reuse step uses. An older host that does not offer the helper still
// hands the connection over itself before the hooks run, so then the hook
// does nothing here.
//
// THE CONNECTOR'S CUSTOM FIELDS (cinatra-ai/twenty-connector#83): the connector
// keeps list membership in a person's or company's `inLists` array and reads
// four more custom fields. Once the row has a working key, the hook creates
// any of them that the workspace lacks, through Twenty's own MCP metadata
// tools with that key (src/twenty-schema-provision.mjs, which reads every
// answer through the tool contract, src/twenty-tool-contract.mjs).
// Idempotent; a failure is logged with fixed words and never fails the hook.
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
import { mcpToolSender, provisionConnectorFields } from "./twenty-schema-provision.mjs";
import { CONNECTOR_CUSTOM_FIELDS } from "./twenty-tool-contract.mjs";

/** This package's name — the key the host's env-override reader is asked for. */
export const TWENTY_PACKAGE_NAME = "@cinatra-ai/twenty-connector";

/** The settings/secrets key the manifest maps the host-handed env var onto. */
export const HANDED_API_KEY_SECRET = "devApiKey";

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

/** The answer of the key check the host's hand-over asks for. */
export type TwentyKeyCheck = "ok" | "unauthorized" | "unreachable";

/**
 * The host's generic hand-over of an install-made connection that the
 * development fixture account REFUSED on this boot owns (cinatra#4137). The
 * host resolves the refused fixture account and the first administrator it
 * adopted itself; the hook names only its own server row and how to check the
 * stored key. Self-declared and OPTIONAL: the connector compiles against the
 * PUBLISHED SDK, which may not carry this helper, so it is feature-detected.
 */
export type RefusedFixtureHandOver = (input: {
  serverId: string;
  checkKey: (input: { apiKey: string; serverUrl: string }) => Promise<TwentyKeyCheck>;
}) => Promise<string>;

export type TwentyDevSetupDeps = {
  registry: Pick<HostExternalMcpRegistryService, "getServerById" | "upsertServer" | "resolveBearer" | "nangoProviderConfigKey"> & {
    /**
     * DEV-ONLY sanctioned Twenty bearer attach (cinatra#1238). Self-declared
     * OPTIONAL — the connector compiles against the PUBLISHED SDK, which does not
     * yet carry this host-local member, so it is typeof-guarded at the call site
     * (an older host without it degrades to a not-working hint). The host writer
     * imports the minted key through `saveTwentyConnection` (which seeds the
     * `externalMcp` connection identity + grant the bearer RESOLVER's use-gate
     * requires) and verifies the gated resolver mints a bearer.
     */
    devAttachTwentyBearer?: (input: {
      instanceUrl: string;
      apiKey: string;
    }) => Promise<{ resolved: boolean; connectionId: string | null }>;
  };
  nango: Pick<NangoSystemSurface, "isNangoConfigured" | "ensureNangoIntegration" | "importNangoConnection" | "getNangoCredentials">;
  helpers: ExtensionDevSetupContext["helpers"];
  log: (message: string) => void;
  /**
   * A workspace API key the install minted on the machine and handed to this
   * instance (cinatra#4098). Used only when the docker probe fails. SECRET: it
   * is never logged and never placed in a status, a reason, a detail or a note.
   */
  handedApiKey?: string | null;
  /**
   * The host's hand-over of the refused fixture account's connection
   * (cinatra#4137), or undefined on an older host that hands it over itself.
   */
  handOverRefusedFixtureConnection?: RefusedFixtureHandOver;
};

export type TwentyBearerOutcome = {
  nangoConnectionId: string | null;
  // True when a resolvable, authenticating bearer should exist after this call
  // (reused-OK, kept-on-transient-failure, or freshly minted + verified). False
  // means the connector will 401 — the caller surfaces a hint.
  working: boolean;
  minted: boolean;
  /** True when the host-handed key (not a docker mint) was attached. */
  handed?: boolean;
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
 *      registry's shared provider key, and readback-verify. With a host-handed
 *      key (`opts.handedApiKey`, passed only when docker is unavailable) the
 *      docker mint is skipped and the handed key is attached on the same road.
 * Soft-fails: any failure returns the prior connection id + a note, never throws.
 */
export async function ensureTwentyBearerAttached(
  deps: TwentyDevSetupDeps,
  existing: ReturnType<HostExternalMcpRegistryService["getServerById"]>,
  opts: { handedApiKey?: string | null } = {},
): Promise<TwentyBearerOutcome> {
  const prior = existing?.nangoConnectionId ?? null;
  const handed = handedKeyOf(opts.handedApiKey);

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

  // 3. Mint + attach through the SANCTIONED host path (cinatra#1238). Minting the
  //    workspace key and importing the RAW Nango credential directly (the old
  //    path) leaves the bearer RESOLVER failing closed: a raw
  //    `getNangoCredentials` readback passes (a false positive) while
  //    `resolveBearer` -> `gateExternalMcpConnectionUse` returns null because the
  //    `externalMcp` connection-identity row + workspace grant were never seeded,
  //    so agents 401. The dev-only host writer runs `saveTwentyConnection` (live
  //    probe -> foreign-identity preflight -> Nango import + readback -> row
  //    upsert -> identity + grant seed), bound to the seeded dev actor, and
  //    VERIFIES the gated resolver actually mints a bearer — an honest `resolved`.
  const providerConfigKey = deps.registry.nangoProviderConfigKey;
  if (!providerConfigKey) {
    return { nangoConnectionId: prior, working: false, minted: false, note: "registry provider key unpublished (older host)" };
  }
  const attach = deps.registry.devAttachTwentyBearer;
  if (typeof attach !== "function") {
    return {
      nangoConnectionId: prior,
      working: false,
      minted: false,
      note: "host does not publish the twenty dev-attach writer (older host)",
    };
  }
  if (handed) {
    // The install minted this key on the machine (docker is unavailable here):
    // attach it on the SAME sanctioned road the docker mint uses.
    try {
      const attached = await attach({ instanceUrl: LOCAL_TWENTY.serverUrl, apiKey: handed });
      if (!attached.resolved || !attached.connectionId) {
        return {
          nangoConnectionId: attached.connectionId ?? prior,
          working: false,
          minted: false,
          note: "attach-unresolved",
        };
      }
      return { nangoConnectionId: attached.connectionId, working: true, minted: false, handed: true };
    } catch {
      // SECRET BOUNDARY: a fixed label — a thrown message could echo the key.
      return { nangoConnectionId: prior, working: false, minted: false, note: "attach-failed" };
    }
  }
  try {
    // ensure the Apple workspace exists (idempotent)
    deps.helpers.dockerExecCapture(LOCAL_TWENTY.containerName, buildSeedDevArgs());
    const minted = deps.helpers.dockerExecCapture(
      LOCAL_TWENTY.containerName,
      buildGenerateApiKeyArgs({ keyName: TWENTY_DEV_API_KEY_NAME }),
    );
    // Only trust the mint output on a clean exit — a non-zero docker exec can
    // still emit JWT-shaped noise on stdout that parseTwentyApiKey would accept.
    const jwt = minted.code === 0 ? parseTwentyApiKey(minted.out) : null;
    if (!jwt) {
      return { nangoConnectionId: prior, working: false, minted: false, note: `mint-failed (exit ${minted.code})` };
    }
    const attached = await attach({ instanceUrl: LOCAL_TWENTY.serverUrl, apiKey: jwt });
    if (!attached.resolved || !attached.connectionId) {
      // The sanctioned save ran but the gated resolver still did not mint a
      // bearer (no dev actor/org, a live-probe reject, or an import failure).
      // Never claim a working credential — surface the honest not-working state.
      return {
        nangoConnectionId: attached.connectionId ?? prior,
        working: false,
        minted: false,
        note: "attach-unresolved",
      };
    }
    return { nangoConnectionId: attached.connectionId, working: true, minted: true };
  } catch {
    // SECRET BOUNDARY: a thrown error could echo the minted JWT. Failure notes
    // are FIXED labels — never interpolate the raw thrown message.
    return {
      nangoConnectionId: prior,
      working: false,
      minted: false,
      note: "attach-failed",
    };
  }
}

/** A non-blank handed key, trimmed; null for anything else. */
function handedKeyOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// The refused fixture account's connection (cinatra#4112, cinatra#4137).
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Loopback, RFC-1918 private, or link-local (incl. the cloud metadata address). */
function isPrivateOrLinkLocalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h === "0.0.0.0" ||
    /^f[cd][0-9a-f]{2}:/.test(h) ||
    /^fe80:/.test(h)
  );
}

/** Drop trailing slashes with a linear scan (no backtracking pattern). */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--; // 47 = "/"
  return value.slice(0, end);
}

/**
 * The REST base of the Twenty instance a row's MCP address points at, under the
 * rule the host's connect flow applies to an instance address: http only on a
 * loopback host, https otherwise, and never a private or link-local host. A
 * trailing slash and one trailing `/mcp` are dropped. Throws on an address the
 * rule refuses; the host's hand-over then answers "failed" and changes nothing.
 */
export function twentyRestBaseOf(serverUrl: string): string {
  const url = new URL(String(serverUrl ?? "").trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported instance address");
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !loopback) throw new Error("unsupported instance address");
  if (!loopback && isPrivateOrLinkLocalHost(url.hostname)) throw new Error("unsupported instance address");
  const path = withoutTrailingSlashes(url.pathname).replace(/\/mcp$/i, "");
  return `${url.origin}${path}`;
}

/**
 * The key check the host's hand-over asks for: does Twenty still accept the
 * stored key? The same REST probe the reuse step makes (GET
 * <instance>/rest/companies?limit=1 with the key as the bearer): "ok" on a 2xx,
 * "unauthorized" on 401/403, "unreachable" on anything else. SECRET BOUNDARY:
 * the key goes into that one request and nowhere else.
 */
export async function checkTwentyKey(input: { apiKey: string; serverUrl: string }): Promise<TwentyKeyCheck> {
  return probeTwentyBearer({ baseUrl: twentyRestBaseOf(input.serverUrl), apiKey: input.apiKey });
}

/** What the hook logs for each hand-over outcome; an outcome that changes nothing logs nothing. */
const HAND_OVER_SAID: Readonly<Record<string, string>> = {
  reowned:
    "the refused fixture account's Twenty connection now belongs to the first administrator (same key)",
  cleared:
    "the refused fixture account's Twenty connection had no working key and was removed — " +
    "the Twenty hook attaches one fresh key for the first administrator",
  deferred:
    "the refused fixture account's Twenty connection is kept as it is for now: its key could not be " +
    "checked against Twenty, or the hand-over did not complete and was undone; a later boot hands it over",
  failed:
    "could not hand the refused fixture account's Twenty connection over on this boot — if Twenty " +
    "stays unconnected, disconnect and reconnect it on the Twenty setup page",
};

/**
 * Ask the host to hand the Twenty row's connection from the refused fixture
 * account to the first administrator (cinatra#4137), and log what happened.
 * Runs FIRST in the hook, before any probe, reuse, mint or attach. Returns the
 * host's outcome, or null on an older host without the helper (that host
 * hands the connection over itself before the hooks run). Never throws: a
 * throwing helper reads as "failed".
 */
export async function handOverRefusedFixtureConnection(
  deps: Pick<TwentyDevSetupDeps, "handOverRefusedFixtureConnection" | "log">,
): Promise<string | null> {
  const handOver = deps.handOverRefusedFixtureConnection;
  if (typeof handOver !== "function") return null;
  let outcome: string;
  try {
    outcome = await handOver({ serverId: LOCAL_TWENTY.rowId, checkKey: checkTwentyKey });
  } catch {
    outcome = "failed";
  }
  const line = Object.prototype.hasOwnProperty.call(HAND_OVER_SAID, outcome) ? HAND_OVER_SAID[outcome] : undefined;
  if (line) {
    try {
      deps.log(line);
    } catch {
      // A throwing log sink never fails the hook.
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// The connector's custom fields (cinatra-ai/twenty-connector#83).
// ---------------------------------------------------------------------------

/**
 * Create the custom fields the connector reads and writes that the workspace
 * lacks, with the row's own key: the key is read back through the host's gated
 * resolver (the road the connector's own calls take) and used for the MCP
 * metadata calls only. Returns a short note for the status detail; logs one
 * fixed line when a field is still missing. Never throws. SECRET BOUNDARY: the
 * key reaches the MCP request's Authorization header and nothing else.
 */
export async function provisionTwentyConnectorFields(
  deps: Pick<TwentyDevSetupDeps, "registry" | "log">,
): Promise<string> {
  let apiKey: string | null = null;
  try {
    const row = deps.registry.getServerById(LOCAL_TWENTY.rowId);
    apiKey = row ? await deps.registry.resolveBearer(row) : null;
  } catch {
    apiKey = null;
  }
  if (!apiKey) return "custom fields not checked (no resolvable key)";
  let note: string;
  let missing: string[];
  try {
    const outcome = await provisionConnectorFields({
      send: mcpToolSender({ mcpUrl: LOCAL_TWENTY.mcpUrl, apiKey }),
    });
    missing = outcome.conflicts;
    note =
      missing.length === 0
        ? `custom fields: ${CONNECTOR_CUSTOM_FIELDS.length} present (${outcome.created.length} created)`
        : `custom fields incomplete: ${missing.join(", ")}`;
  } catch {
    // SECRET BOUNDARY: a fixed label — never the raw thrown message.
    missing = ["(unread)"];
    note = "custom fields not checked (metadata read failed)";
  }
  if (missing.length > 0) {
    try {
      deps.log(
        `${note} — CRM lists read no members until the person and company custom fields exist; ` +
          "the workspace key needs the data-model permission, and the next dev boot tries again.",
      );
    } catch {
      // A throwing log sink never fails the hook.
    }
  }
  return note;
}

/**
 * The Twenty auto-setup body (exported for tests; `runDevSetup` wraps it with
 * capability resolution).
 */
export async function autoSetupLocalTwenty(deps: TwentyDevSetupDeps): Promise<ExtensionDevSetupStatus> {
  // cinatra#4137: the refused fixture account's connection is handed to the
  // first administrator BEFORE anything below reuses, mints or attaches a key.
  await handOverRefusedFixtureConnection(deps);

  // NEVER-THROW boundary: probeDockerContainer / probeHttp / getServerById are
  // host helpers that may throw; a throw here must yield a soft-fail status, not
  // reject the hook. Fixed reason label only (SECRET BOUNDARY — no raw error).
  let existing: ReturnType<HostExternalMcpRegistryService["getServerById"]>;
  // The host-handed key applies ONLY when the docker probe fails (no docker in
  // the instance). With docker present the docker road runs unchanged and the
  // handed key is ignored.
  let handedApiKey: string | null = null;
  try {
    if (!deps.helpers.probeDockerContainer(LOCAL_TWENTY.containerName)) {
      handedApiKey = handedKeyOf(deps.handedApiKey);
      if (!handedApiKey) {
        return {
          status: "skipped",
          reason: `${LOCAL_TWENTY.containerName} not running (run docker compose --profile twenty up -d)`,
        };
      }
      // No docker and no curl here: the docker and curl probes are skipped; the
      // bearer probe and the host's attach road read Twenty themselves.
    } else if (!deps.helpers.probeHttp(`${LOCAL_TWENTY.serverUrl}/healthz`)) {
      return {
        status: "skipped",
        reason: `${LOCAL_TWENTY.serverUrl}/healthz not reachable yet (Twenty still booting)`,
      };
    }

    existing = deps.registry.getServerById(LOCAL_TWENTY.rowId);
  } catch {
    return { status: "error", reason: "dev-setup-probe-failed" };
  }

  // Auto-mint + attach a working bearer (reuse-first, soft-fail).
  const bearer = await ensureTwentyBearerAttached(deps, existing, { handedApiKey });

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
  } catch {
    // SECRET BOUNDARY: a fixed label only — a raw upsert error message could
    // echo the row's bearer/connection payload into deps.log(...).
    return {
      status: "error",
      reason: "server-upsert-failed",
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

  // cinatra-ai/twenty-connector#83: the custom fields, once a working key exists.
  const fieldsNote = bearer.working ? await provisionTwentyConnectorFields(deps) : null;

  const bearerNote = bearer.minted
    ? "bearer auto-minted + attached"
    : bearer.handed
      ? "host-handed bearer attached"
      : bearer.working
      ? "bearer present"
      : `no working bearer (${bearer.note ?? "unknown"})`;

  return {
    status: existing ? "already-wired" : "created",
    siteUrl: LOCAL_TWENTY.serverUrl,
    detail:
      `row ${LOCAL_TWENTY.rowId} ${existing ? "refreshed" : "created"} ` +
      `(${LOCAL_TWENTY.allowedCatalogTools.length} catalog tools allowed; ${bearerNote}` +
      `${fieldsNote ? `; ${fieldsNote}` : ""})`,
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

/** The host `connector-config` capability's additive env-override reader
 * (cinatra#982): returns this package's currently-set manifest env overrides,
 * keyed by their settings/secrets key. Narrowed structurally; an older host
 * without it yields no handed key. */
type ConnectorConfigEnvReader = { resolveEnvOverrides: (packageName: string) => unknown };

function isConnectorConfigEnvReader(impl: unknown): impl is ConnectorConfigEnvReader {
  const c = impl as Partial<ConnectorConfigEnvReader> | null;
  return !!c && typeof c === "object" && typeof c.resolveEnvOverrides === "function";
}

/** The host-handed key read through the host's env reader, or null (absent,
 * blank, an older host, or a throwing reader). Never logged. */
function readHandedApiKey(ctx: ExtensionDevSetupContext): string | null {
  try {
    const reader = resolveImpl(ctx, "@cinatra-ai/host:connector-config");
    if (!isConnectorConfigEnvReader(reader)) return null;
    const overrides = reader.resolveEnvOverrides(TWENTY_PACKAGE_NAME);
    if (!overrides || typeof overrides !== "object") return null;
    return handedKeyOf((overrides as Record<string, unknown>)[HANDED_API_KEY_SECRET]);
  } catch {
    return null;
  }
}

/** The host's hand-over helper when this host offers it (cinatra#4137), bound
 * to the helpers object so a helper written as a method keeps its receiver; an
 * older host without it, or a throwing read, yields undefined. */
function readHandOver(ctx: ExtensionDevSetupContext): RefusedFixtureHandOver | undefined {
  try {
    const helpers = ctx.helpers as { reownRefusedFixtureConnection?: unknown } | null | undefined;
    const helper = helpers?.reownRefusedFixtureConnection;
    return typeof helper === "function" ? (helper.bind(helpers) as RefusedFixtureHandOver) : undefined;
  } catch {
    return undefined;
  }
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
  // NEVER-THROW: capability resolution (ctx.capabilities.resolveProviders via
  // resolveImpl) runs outside autoSetupLocalTwenty's guards; a throwing host
  // resolver must degrade to a soft-fail status, honoring the docstring's
  // never-throws promise. Fixed reason label only (SECRET BOUNDARY).
  let registryImpl: unknown;
  let nangoImpl: unknown;
  try {
    registryImpl = resolveImpl(ctx, "@cinatra-ai/host:external-mcp-registry");
    nangoImpl = resolveImpl(ctx, "nango-system");
  } catch {
    return { status: "skipped", reason: "host capability resolution failed" };
  }
  if (!isRegistryService(registryImpl) || !isNangoSystemSurface(nangoImpl)) {
    return { status: "skipped", reason: "host services unresolved (external-mcp-registry / nango-system)" };
  }
  return autoSetupLocalTwenty({
    registry: registryImpl,
    nango: nangoImpl,
    helpers: ctx.helpers,
    log: ctx.log,
    handedApiKey: readHandedApiKey(ctx),
    handOverRefusedFixtureConnection: readHandOver(ctx),
  });
}
