"use client";

// Client island for the setup page's Connection status card (design/specs/
// app-connectors.html section II): the shared status badge with the Check
// action beneath it. Pressing Check hands the badge the transient "checking"
// status - the shared ConnectionStatusBadge draws it as the indigo Checking
// chip with its icon spinning - until the probe resolves, then Connected or
// Disconnected. The card chrome and the heading stay in the server page.
//
// The badge, the Button and the probe come from their shared homes: the badge
// from @cinatra-ai/sdk-ui, the Button from the host-shared primitives, the
// probe from the connector-local "use server" actions. The state machine is
// the pure ./connection-check module.
//
// initialStatus seeds the state once, at mount. The page keys the island by
// that same settled status, so a server re-render with a new reading mounts a
// fresh island instead of keeping a stale badge.

import * as React from "react";
import { RefreshCw } from "lucide-react";

import { ConnectionStatusBadge, type ConnectionStatus } from "@cinatra-ai/sdk-ui/connection-status-badge";
import { Button } from "@cinatra-ai/design-primitives";
import { checkTwentyConnectionAction } from "./actions";
import { runConnectionCheck } from "./connection-check";

export function TwentyConnectionStatus({
  initialStatus,
}: {
  /** The status the page read on this render (the workspace row). */
  initialStatus: "connected" | "disconnected";
}) {
  const [status, setStatus] = React.useState<ConnectionStatus>(initialStatus);

  function onCheck() {
    void runConnectionCheck(status, checkTwentyConnectionAction, setStatus);
  }

  return (
    <>
      <ConnectionStatusBadge status={status} />
      <div className="mt-[15px]">
        <Button type="button" variant="outline" className="w-full justify-center" onClick={onCheck} disabled={status === "checking"}>
          <RefreshCw aria-hidden="true" />
          Check
        </Button>
      </div>
    </>
  );
}
