import "server-only";

// Twenty provider deps surface.
//
// Provider connectors declare the host facilities they consume here (per
// https://docs.cinatra.ai/references/platform/extensions/ provider-connector contract). The host wires
// concrete implementations at boot; the provider package depends only on the
// types declared here.
//
// This module defines the dependency type shape for the resolver,
// encrypted-bearer store, and Twenty MCP forwarding.

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
