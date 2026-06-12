// The twenty connector's `register(ctx)` server entry.
//
// Transport-registration cutover: the host no longer imports `registerTwentyProvider` — this entry
// registers the Twenty `CrmConnector` impl behind the `crm-provider`
// capability at activation. The host's CRM bridge
// (src/lib/register-crm-providers.ts) feeds the SDK provider registry's
// external resolver from this capability, so `lookupCrmProvider("twenty")`
// resolves without the host naming this package.
//
// hostInternal pinned-empty sweep (cinatra#172 Stage H4): this entry ALSO
// binds the connector's host deps slot (`./deps`) by adapting the per-concern
// host service published in the capability registry
// (`@cinatra-ai/host:external-mcp-registry`) — `twenty-mcp-call.ts` stops
// importing `@/lib/external-mcp-registry` and resolves `getTwentyDeps()` from
// separately-compiled bundles instead. Every adapter member resolves its host
// service LAZILY at call time, so activation order against the host's boot
// imports never matters. Registration-only (no I/O) — probe-safe and safe
// under required-extension-activation's prod-boot arming.
//
// SDK imports here are TYPE-ONLY (host-peer value-import gate): the provider
// impl and the host service both travel as DATA through `ctx.capabilities`;
// the capability id is an inlined string literal; the service shape is a
// local structural type so the connector compiles against ANY host SDK it
// can meet during skew.

import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";
import { twentyConnector } from "./twenty-connector";
import { registerTwentyConnector, type TwentyConnectorHostDeps } from "./deps";

const PACKAGE_NAME = "@cinatra-ai/twenty-connector";

// Local STRUCTURAL shape of the per-concern host service this connector
// adapts into its deps slot (read + bearer-mint members only — the service's
// pre-existing writers stay unbound here, least privilege).
type HostExternalMcpRegistryShape = {
  getServerById: TwentyConnectorHostDeps["getServerById"];
  listServers: TwentyConnectorHostDeps["listServers"];
  resolveBearer: TwentyConnectorHostDeps["resolveBearer"];
};

/** Lazy per-concern host-service resolution (fail-loud on a missing service —
 * the host boot wiring publishes it before any connector call runs). */
function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-host-connector-services) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

/** Build the host-bound deps from the per-concern host service. Every member
 * resolves LAZILY at call time — constructing this object does no I/O and no
 * resolution (probe-safe). */
function buildHostBoundDeps(ctx: ExtensionHostContext): TwentyConnectorHostDeps {
  const registry = () =>
    hostService<HostExternalMcpRegistryShape>(ctx, "@cinatra-ai/host:external-mcp-registry");
  return {
    getServerById: (id) => registry().getServerById(id),
    listServers: () => registry().listServers(),
    // IN-PROCESS bearer mint — trusted-path posture documented in ./deps
    // (the minted bearer never crosses a wire boundary).
    resolveBearer: (server) => registry().resolveBearer(server),
  };
}

export function register(ctx: ExtensionHostContext): void {
  ctx.capabilities.registerProvider("crm-provider", {
    packageName: PACKAGE_NAME,
    impl: twentyConnector,
  });
  // Bind the host deps slot. Always-bind: re-activation — incl. a hot-update
  // digest swap — re-binds fresh lazy resolvers, so a stale deps object can
  // never outlive its digest.
  registerTwentyConnector(buildHostBoundDeps(ctx));
}
