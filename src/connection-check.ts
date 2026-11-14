// The Connection status card's Check flow (design/specs/app-connectors.html
// section II, "connection status - Check flow"): pressing Check replaces the
// badge with the transient indigo Checking badge until the probe resolves,
// then swaps it to Connected or Disconnected.
//
// Pure and framework-free, so the state machine runs under this package's
// plain-node tests; the client island (./twenty-connection-status) wires it
// to the shared ConnectionStatusBadge and the Check button.

export type TwentyConnectionStatus = "connected" | "disconnected" | "checking";
export type SettledTwentyConnectionStatus = Exclude<TwentyConnectionStatus, "checking">;

/** The connection reading: the workspace row is enabled and bound to a
 * connection. The page and the Check probe read it the same way. */
export function isTwentyWorkspaceConnected(
  row: { enabled: boolean; nangoConnectionId: string | null } | null | undefined,
): boolean {
  return Boolean(row?.enabled && row?.nangoConnectionId);
}

/**
 * Run one Check: show "checking" at once, await the probe, then show its
 * answer. A failed probe (or an answer that is not a settled status) restores
 * the last known status, so an error never reads as Disconnected. A press
 * while a probe is in flight starts nothing. Returns the settled answer, or
 * null when nothing was settled.
 */
export async function runConnectionCheck(
  current: TwentyConnectionStatus,
  probe: () => Promise<SettledTwentyConnectionStatus>,
  onStatus: (status: TwentyConnectionStatus) => void,
): Promise<SettledTwentyConnectionStatus | null> {
  if (current === "checking") return null;
  onStatus("checking");
  try {
    const next = await probe();
    if (next !== "connected" && next !== "disconnected") {
      onStatus(current);
      return null;
    }
    onStatus(next);
    return next;
  } catch {
    onStatus(current);
    return null;
  }
}
