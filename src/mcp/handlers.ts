import "server-only";

// twenty_* provider primitives.
// Parallel to wordpress_status / wordpress_instances_list — provider-specific
// connector-state verbs that complement the provider-agnostic crm_* facade.

type TwentyStatusResult = {
  reachable: boolean;
  instanceId: string | null;
  workspaceId: string | null;
  bootstrapStatus: "configured" | "missing" | "skeleton";
  message: string;
};

/** Skeleton — not yet wired against the real connector_config + healthz probe. */
export async function twentyStatusHandler(): Promise<TwentyStatusResult> {
  return {
    reachable: false,
    instanceId: null,
    workspaceId: null,
    bootstrapStatus: "skeleton",
    message:
      "twenty_status: skeleton — not yet wired against the connector_config row + Twenty /healthz probe.",
  };
}

type TwentyInstance = {
  serverId: string;
  label: string;
  serverUrl: string;
  enabled: boolean;
  workspaceId: string | null;
};

/** Skeleton — not yet reading from external_mcp_servers + connector_config. */
export async function twentyInstancesListHandler(): Promise<TwentyInstance[]> {
  return [];
}
