// The Connection status card's Check flow (design/specs/app-connectors.html
// section II, "connection status - Check flow"):
//
//   "Pressing Check replaces the current badge with the indigo Checking...
//    badge - its icon spinning - until the probe resolves, then swaps to
//    Connected or Disconnected."
//
// The shared ConnectionStatusBadge already draws the transient "checking"
// chip (indigo tint, spinning loader); what this connector owns is the state
// that hands it that status while the probe runs. That state machine lives in
// the pure ../connection-check module and is exercised here at run time. The
// client island that wires it to the badge and the Check button imports
// host-provided modules this package's plain-node sandbox does not resolve, so
// its wiring is pinned against its authored source, like the sibling pins.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  runConnectionCheck,
  isTwentyWorkspaceConnected,
  type TwentyConnectionStatus,
} from "../connection-check";
import { checkTwentyConnectionAction } from "../actions";
import { registerTwentyConnector, _resetTwentyDepsForTests } from "../deps";
import type { TwentyConnectorHostDeps } from "../deps";
import { TWENTY_WORKSPACE_ROW_ID } from "../twenty-mcp-call";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Check flow - the badge shows Checking while the probe runs", () => {
  it("swaps the badge to checking BEFORE the probe settles, then to the probe's answer", async () => {
    const seen: TwentyConnectionStatus[] = [];
    const probe = deferred<"connected" | "disconnected">();
    const run = runConnectionCheck("disconnected", () => probe.promise, (s) => seen.push(s));
    // The probe has not answered yet: the badge already reads Checking.
    expect(seen).toEqual(["checking"]);
    probe.resolve("connected");
    expect(await run).toBe("connected");
    expect(seen).toEqual(["checking", "connected"]);
  });

  it("a probe that reports disconnected swaps Checking to Disconnected", async () => {
    const seen: TwentyConnectionStatus[] = [];
    const out = await runConnectionCheck("connected", async () => "disconnected", (s) => seen.push(s));
    expect(out).toBe("disconnected");
    expect(seen).toEqual(["checking", "disconnected"]);
  });

  it("a failed probe restores the last known status (an error is not a Disconnected)", async () => {
    const seen: TwentyConnectionStatus[] = [];
    const out = await runConnectionCheck(
      "connected",
      async () => {
        throw new Error("network");
      },
      (s) => seen.push(s),
    );
    expect(out).toBeNull();
    expect(seen).toEqual(["checking", "connected"]);
  });

  it("an answer that is not a settled status restores the last known status", async () => {
    const seen: TwentyConnectionStatus[] = [];
    const out = await runConnectionCheck(
      "disconnected",
      async () => "checking" as unknown as "connected",
      (s) => seen.push(s),
    );
    expect(out).toBeNull();
    expect(seen).toEqual(["checking", "disconnected"]);
  });

  it("no second probe starts while one is in flight", async () => {
    const seen: TwentyConnectionStatus[] = [];
    let calls = 0;
    const out = await runConnectionCheck(
      "checking",
      async () => {
        calls += 1;
        return "connected";
      },
      (s) => seen.push(s),
    );
    expect(out).toBeNull();
    expect(calls).toBe(0);
    expect(seen).toEqual([]);
  });
});

describe("Check flow - the connected reading is the workspace row", () => {
  it("connected only when the row is enabled AND bound to a connection", () => {
    expect(isTwentyWorkspaceConnected(null)).toBe(false);
    expect(isTwentyWorkspaceConnected({ enabled: true, nangoConnectionId: null })).toBe(false);
    expect(isTwentyWorkspaceConnected({ enabled: false, nangoConnectionId: "c1" })).toBe(false);
    expect(isTwentyWorkspaceConnected({ enabled: true, nangoConnectionId: "c1" })).toBe(true);
  });
});

describe("Check flow - the probe server action", () => {
  beforeEach(() => {
    _resetTwentyDepsForTests();
  });

  function register(row: { enabled: boolean; nangoConnectionId: string | null } | null, log: string[]) {
    registerTwentyConnector({
      resolveViewerContext: async () => {
        log.push("viewer");
        return { isAdmin: false, userId: "u1" };
      },
      getServerById: (id: string) => {
        log.push(`row:${id}`);
        return row;
      },
    } as unknown as TwentyConnectorHostDeps);
  }

  it("re-reads the workspace row at call time and answers connected", async () => {
    const log: string[] = [];
    register({ enabled: true, nangoConnectionId: "c1" }, log);
    expect(await checkTwentyConnectionAction()).toBe("connected");
    expect(log).toEqual(["viewer", `row:${TWENTY_WORKSPACE_ROW_ID}`]);
  });

  it("answers disconnected when the row is gone or unbound", async () => {
    register(null, []);
    expect(await checkTwentyConnectionAction()).toBe("disconnected");
    _resetTwentyDepsForTests();
    register({ enabled: true, nangoConnectionId: null }, []);
    expect(await checkTwentyConnectionAction()).toBe("disconnected");
  });

  it("fails loud when the host deps are not registered", async () => {
    let message = "";
    try {
      await checkTwentyConnectionAction();
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toMatch(/host runtime deps not registered/);
  });
});

describe("Check flow - the client island wires the state to the shared badge", () => {
  const island = readFileSync(
    fileURLToPath(new URL("../twenty-connection-status.tsx", import.meta.url)),
    "utf8",
  );
  const flat = island.replace(/\s+/g, " ");

  it("is a client module", () => {
    expect(island.startsWith('"use client";')).toBe(true);
  });

  it("takes the badge, the Button and the probe from their shared homes (no local copy)", () => {
    expect(island).toContain('import { ConnectionStatusBadge, type ConnectionStatus } from "@cinatra-ai/sdk-ui/connection-status-badge";');
    expect(island).toContain('import { Button } from "@cinatra-ai/design-primitives";');
    expect(island).toContain('import { checkTwentyConnectionAction } from "./actions";');
    expect(island).toContain('import { runConnectionCheck } from "./connection-check";');
  });

  it("the badge renders the island's live status, which the Check press drives through runConnectionCheck", () => {
    expect(flat).toContain("const [status, setStatus] = React.useState<ConnectionStatus>(initialStatus);");
    expect(flat).toContain("<ConnectionStatusBadge status={status} />");
    expect(flat).toMatch(/runConnectionCheck\(status, checkTwentyConnectionAction, setStatus\)/);
    expect(flat).toMatch(/<Button type="button" variant="outline" className="w-full justify-center" onClick=\{onCheck\} disabled=\{status === "checking"\}>/);
  });
});
