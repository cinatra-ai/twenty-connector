import "server-only";

// Twenty provider deps surface.
//
// Provider connectors declare the host facilities they consume here (per
// https://docs.cinatra.ai/references/platform/extensions/ provider-connector contract). The host wires
// concrete implementations at boot; the provider package depends only on the
// types declared here.
//
// This module defines the dependency type shape for the resolver,
// encrypted-bearer store, and Twenty MCP forwarding — and (cinatra#172 Stage
// H4) the host DI SINGLETON for the external-MCP registry read surface the
// Twenty transport resolves its live workspace row through.

export type TwentyConnectorDeps = {
  /** Encrypted bearer storage. */
  persistApiKey: (input: {
    serverId: string;
    apiKey: string;
    workspaceId: string;
    name: string;
  }) => Promise<void>;
  /** Decrypt a previously persisted bearer. */
  loadApiKey: (serverId: string) => Promise<string | null>;
};

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
