import "server-only";

// Twenty provider deps surface.
//
// Provider connectors declare the host facilities they consume here (per
// https://docs.cinatra.ai/references/platform/extensions/ provider-connector contract). The host wires
// concrete implementations at boot; the provider package depends only on the
// types declared here.
//
// This module defines the host DI SINGLETON for the external-MCP registry
// read surface the Twenty transport resolves its live workspace row through
// (cinatra#172 Stage H4), plus the setup-page connect/disconnect actions +
// viewer/connection-service surface the setup page renders against
// (twenty-connector#39). The pasted API key never lives connector-side — the
// host connect action holds it and stores it in Nango — so there is no
// connector-side bearer store.

/** A host server action the setup page's connect/disconnect forms submit to.
 *  Travels as DATA through the capability registry; the connector treats it as
 *  an opaque FormData->Promise<void> server action. */
export type TwentyConnectionAction = (formData: FormData) => Promise<void>;

/** The resolved viewer the setup page reads to gate the admin-only surface. */
export type TwentyViewerContext = { isAdmin: boolean; userId: string };

// ---------------------------------------------------------------------------
// hostInternal pinned-empty sweep (cinatra#172 Stage H4): `twenty-mcp-call.ts`
// stops importing `@/lib/external-mcp-registry` — the registry READ +
// bearer-mint surface is delivered here, bound at activation by
// `register(ctx)` adapting the per-concern host service published in the
// capability registry (`@cinatra-ai/host:external-mcp-registry`).
//
// TRUST (moves with the code it serves): the registry is server-side only —
// never client-resolvable. `resolveBearer` MINTS the upstream bearer via
// Nango and returns it IN-PROCESS; server-side callers are trusted and may
// hit the upstream directly, BYPASSING the host's Layer-B
// (`allowed_catalog_tools`) proxy — that proxy remains the LLM-facing
// enforcement point, and in-process callers are responsible for using the
// right tool names. The minted bearer must never cross a wire boundary.
//
// The deps slot is anchored on `globalThis` via a namespaced+versioned Symbol
// so the boot-time registration and the runtime callers — which live in
// SEPARATELY-COMPILED Next.js bundles (the MCP handlers do NOT import the
// registrar) — resolve the SAME slot. A plain module-local binding would
// leave those bundles' instance unregistered → getTwentyDeps() would throw.
// (Same reason as the SDK action-guard + the crm/github/linkedin deps slots.)

/** Structural external-MCP server registry row (mirror of the host's
 * `ExternalMcpServerRecord` — no SDK type import needed to compile against
 * any host this connector can meet during skew; registry rows always carry
 * the full document, so no skew-optional fields). */
export type ExternalMcpServerRecordShape = {
  id: string;
  label: string;
  serverUrl: string;
  nangoConnectionId: string | null;
  scope: "global" | "org" | "team" | "user" | "workspace";
  orgId: string | null;
  userId: string | null;
  enabled: boolean;
  /** Layer A — native MCP allowlist (`null` = no filter). */
  allowedTools: string[] | null;
  /** Layer B — catalog toolName allowlist enforced by the host proxy
   * (`null` = no filter at the proxy layer). */
  allowedCatalogTools: string[] | null;
  createdAt: string;
  updatedAt: string;
};

export interface TwentyConnectorHostDeps {
  /** One registry row by id (null when unknown). */
  getServerById: (id: string) => ExternalMcpServerRecordShape | null;
  /** Every registry row (cached host-side, createdAt ASC). */
  listServers: () => ExternalMcpServerRecordShape[];
  /** Upstream bearer mint for a row via its Nango binding (null when Nango is
   * unconfigured, the row has no connection, or resolution fails — callers
   * treat null as "no auth header"). IN-PROCESS ONLY, per the TRUST note. */
  resolveBearer: (server: ExternalMcpServerRecordShape) => Promise<string | null>;
  // --- setup-page connect surface (twenty-connector#39) --------------------
  // The host server actions the setup page's connect/disconnect forms submit
  // to. The host owns the admin authz + URL guard + live key probe + Nango
  // import + row write inside these; the connector reimplements NO auth and
  // never sees the key.
  /** Connect/re-connect the instance-global Twenty workspace. */
  saveTwentyConnectionAction: TwentyConnectionAction;
  /** Disconnect: remove the row + the bound Nango connection. */
  disconnectTwentyConnectionAction: TwentyConnectionAction;
  /** Resolve the current viewer (admin flag + user id) so the setup page can
   * gate its admin-only connect surface. */
  resolveViewerContext: () => Promise<TwentyViewerContext>;
  /** Is the host connection (Nango) service configured for API-key storage? */
  isConnectionServiceReady: () => boolean;
  /** Is the given URL private/non-public (surfaced as an advisory)? */
  isPrivateUrl: (serverUrl: string) => boolean;
}

const TWENTY_DEPS_KEY = Symbol.for("@cinatra-ai/twenty-connector:host-deps/v1");
type DepsHolder = { [k: symbol]: TwentyConnectorHostDeps | null | undefined };
const _holder = globalThis as unknown as DepsHolder;

export function registerTwentyConnector(deps: TwentyConnectorHostDeps): void {
  _holder[TWENTY_DEPS_KEY] = deps;
}

export function getTwentyDeps(): TwentyConnectorHostDeps {
  const deps = _holder[TWENTY_DEPS_KEY];
  if (!deps) {
    throw new Error(
      "@cinatra-ai/twenty-connector: host runtime deps not registered. " +
        "Call registerTwentyConnector(deps) at boot.",
    );
  }
  return deps;
}

/** @internal test-only. */
export function _resetTwentyDepsForTests(): void {
  _holder[TWENTY_DEPS_KEY] = null;
}
