// `register(ctx)` shape — the cinatra#172 Stage H4 deps-slot cutover: the
// connector keeps its `crm-provider` registration AND binds its host deps
// slot itself (always-bind, lazy per-call host-service resolution over the
// `@cinatra-ai/host:external-mcp-registry` READ + bearer-mint surface).
// Slot-timing coverage (cinatra#172 finding 8): the slot is populated AT
// ACTIVATION — before `twenty-mcp-call.ts` resolves it — and an unbound slot
// fails LOUD naming the package and the registration step.

import { describe, expect, it, vi, beforeEach } from "vitest";

import { register } from "../register";
import {
  getTwentyDeps,
  registerTwentyConnector,
  _resetTwentyDepsForTests,
  type ExternalMcpServerRecordShape,
} from "../deps";

function activateWithServices(impls: Record<string, unknown>) {
  const registerProvider = vi.fn();
  const resolveProviders = vi.fn((capability: string) =>
    impls[capability] !== undefined
      ? [{ packageName: "@cinatra-ai/host", impl: impls[capability] }]
      : [],
  );
  const ctx = {
    capabilities: { registerProvider, resolveProviders },
  } as never;
  register(ctx);
  return { registerProvider, resolveProviders };
}

const ROW: ExternalMcpServerRecordShape = {
  id: "twenty-workspace",
  label: "Twenty (workspace)",
  serverUrl: "https://twenty.example/mcp",
  nangoConnectionId: "conn-1",
  scope: "workspace",
  orgId: null,
  userId: null,
  enabled: true,
  allowedTools: null,
  allowedCatalogTools: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetTwentyDepsForTests();
});

describe("register(ctx) — provider + deps binding (cinatra#172 Stage H4)", () => {
  it("keeps the crm-provider registration AND binds the deps slot at activation, resolving READ members lazily + forwarding the real setup-page action refs", async () => {
    const getServerById = vi.fn((id: string) => (id === ROW.id ? ROW : null));
    const listServers = vi.fn(() => [ROW]);
    const resolveBearer = vi.fn(async () => "jwt-bearer");
    const saveTwentyConnectionAction = vi.fn(async () => {});
    const disconnectTwentyConnectionAction = vi.fn(async () => {});
    const resolveViewerContext = vi.fn(async () => ({ isAdmin: true, userId: "u1" }));
    const isConnectionServiceReady = vi.fn(() => true);
    const isPrivateUrl = vi.fn(() => false);
    const { registerProvider } = activateWithServices({
      "@cinatra-ai/host:external-mcp-registry": {
        getServerById,
        listServers,
        resolveBearer,
        saveTwentyConnectionAction,
        disconnectTwentyConnectionAction,
        resolveViewerContext,
        isConnectionServiceReady,
        isPrivateUrl,
      },
    });
    // The CRM provider registration is unchanged by the H4 cutover.
    expect(registerProvider).toHaveBeenCalledWith(
      "crm-provider",
      expect.objectContaining({ packageName: "@cinatra-ai/twenty-connector" }),
    );
    // Probe-safe: constructing the deps slot invokes NO host READ member
    // (registration does one eager service resolution to forward the real
    // setup-page server-action references, but calls none of the members).
    expect(getServerById).not.toHaveBeenCalled();
    expect(listServers).not.toHaveBeenCalled();
    expect(resolveViewerContext).not.toHaveBeenCalled();

    expect(getTwentyDeps().getServerById("twenty-workspace")).toEqual(ROW);
    expect(getTwentyDeps().getServerById("nope")).toBeNull();
    expect(getTwentyDeps().listServers()).toEqual([ROW]);
    // IN-PROCESS bearer mint (trusted-path posture — see the deps TRUST note).
    await expect(getTwentyDeps().resolveBearer(ROW)).resolves.toBe("jwt-bearer");
    expect(resolveBearer).toHaveBeenCalledWith(ROW);

    // The setup-page connect/disconnect members are the host's REAL server-action
    // references (forwarded directly so `<form action={…}>` gets a genuine
    // server action), and the viewer/connection surface resolves lazily.
    const fd = new FormData();
    await getTwentyDeps().saveTwentyConnectionAction(fd);
    expect(saveTwentyConnectionAction).toHaveBeenCalledWith(fd);
    await getTwentyDeps().disconnectTwentyConnectionAction(fd);
    expect(disconnectTwentyConnectionAction).toHaveBeenCalledWith(fd);
    await expect(getTwentyDeps().resolveViewerContext()).resolves.toEqual({ isAdmin: true, userId: "u1" });
    expect(getTwentyDeps().isConnectionServiceReady()).toBe(true);
    expect(getTwentyDeps().isPrivateUrl("https://x")).toBe(false);
  });

  it("REPLACES a pre-bound deps slot (always-bind — a hot-update digest swap re-binds fresh resolvers)", () => {
    const sentinel = vi.fn(() => ROW);
    registerTwentyConnector({ getServerById: sentinel } as never);
    activateWithServices({
      "@cinatra-ai/host:external-mcp-registry": {
        getServerById: () => null,
        listServers: () => [],
        resolveBearer: async () => null,
      },
    });
    expect(getTwentyDeps().getServerById("twenty-workspace")).toBeNull();
    expect(sentinel).not.toHaveBeenCalled();
  });

  it("fails LOUD (descriptive) on a missing host service at call time", () => {
    activateWithServices({});
    expect(() => getTwentyDeps().listServers()).toThrow(
      /host service "@cinatra-ai\/host:external-mcp-registry" is not registered/,
    );
  });

  it("fails LOUD with the package name + registration step when the SLOT itself is unbound", () => {
    expect(() => getTwentyDeps()).toThrow(
      /@cinatra-ai\/twenty-connector: host runtime deps not registered[\s\S]*registerTwentyConnector/,
    );
  });
});
