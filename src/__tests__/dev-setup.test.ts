// Connector-owned dev-setup hook — Twenty bearer attach discipline
// (cinatra#976 relocation; the reuse-first / probe-then-rotate rules the host's
// dev-auto-setup enforced, now asserted against the hook's explicit deps):
//   - reuse on an "ok" probe; keep on an indeterminate probe (never mint)
//   - never mint on an unresolved credential with a prior connection
//   - mint + import + readback-verify only on a definite auth failure or a
//     first attach; the import lands under the registry's PUBLISHED provider key
//
// SECRET BOUNDARY: assertions only check statuses/booleans — never a key value.

import { describe, expect, it, vi, beforeEach } from "vitest";

import { ensureTwentyBearerAttached, autoSetupLocalTwenty, LOCAL_TWENTY, type TwentyDevSetupDeps } from "../dev-setup";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXYifQ.c2lnbmF0dXJl";

type Fakes = {
  deps: TwentyDevSetupDeps;
  docker: ReturnType<typeof vi.fn>;
  resolveBearer: ReturnType<typeof vi.fn>;
  importNangoConnection: ReturnType<typeof vi.fn>;
  getNangoCredentials: ReturnType<typeof vi.fn>;
  upsertServer: ReturnType<typeof vi.fn>;
  getServerById: ReturnType<typeof vi.fn>;
};

function makeDeps(): Fakes {
  const docker = vi.fn(() => ({ code: 0, out: "" }));
  const resolveBearer = vi.fn(async () => null);
  const importNangoConnection = vi.fn(async () => null);
  const getNangoCredentials = vi.fn(async () => null);
  const upsertServer = vi.fn();
  const getServerById = vi.fn(() => null);
  const deps = {
    registry: {
      getServerById,
      upsertServer,
      resolveBearer,
      nangoProviderConfigKey: "cinatra-external-mcp",
    },
    nango: {
      isNangoConfigured: vi.fn(() => true),
      ensureNangoIntegration: vi.fn(async () => null),
      importNangoConnection,
      getNangoCredentials,
    },
    helpers: {
      probeDockerContainer: vi.fn(() => true),
      probeHttp: vi.fn(() => true),
      probeHttpAnswered: vi.fn(() => true),
      probeHttpReachableWithRetry: vi.fn(async () => true),
      dockerExecCapture: docker,
      isLocalhostUrl: vi.fn(() => true),
      trimTrailingSlashes: (s: string) => s,
    },
    log: vi.fn(),
  } as unknown as TwentyDevSetupDeps;
  return { deps, docker, resolveBearer, importNangoConnection, getNangoCredentials, upsertServer, getServerById };
}

function stubProbeStatus(status: number) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 300, status }) as Response));
}

const EXISTING_ROW = { id: "twenty-workspace", nangoConnectionId: "twenty-workspace" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ensureTwentyBearerAttached", () => {
  it("REUSE on an authenticating bearer — no mint, no import", async () => {
    const t = makeDeps();
    t.resolveBearer.mockResolvedValueOnce(JWT);
    stubProbeStatus(200);

    const r = await ensureTwentyBearerAttached(t.deps, EXISTING_ROW);

    expect(r).toMatchObject({ working: true, minted: false, nangoConnectionId: "twenty-workspace" });
    expect(t.docker).not.toHaveBeenCalled();
    expect(t.importNangoConnection).not.toHaveBeenCalled();
  });

  it("KEEP on an indeterminate probe (5xx) — never mint a duplicate on a blip", async () => {
    const t = makeDeps();
    t.resolveBearer.mockResolvedValueOnce(JWT);
    stubProbeStatus(503);

    const r = await ensureTwentyBearerAttached(t.deps, EXISTING_ROW);

    expect(r).toMatchObject({ working: true, minted: false });
    expect(r.note).toMatch(/probe-indeterminate/);
    expect(t.docker).not.toHaveBeenCalled();
  });

  it("NO mint on an unresolved credential with a prior connection (transient Nango blip)", async () => {
    const t = makeDeps();
    t.resolveBearer.mockResolvedValueOnce(null);

    const r = await ensureTwentyBearerAttached(t.deps, EXISTING_ROW);

    expect(r).toMatchObject({ working: false, minted: false, nangoConnectionId: "twenty-workspace" });
    expect(r.note).toMatch(/credential-unresolved/);
    expect(t.docker).not.toHaveBeenCalled();
  });

  it("ROTATE on a definite 401 — mints via docker exec, imports under the PUBLISHED provider key, readback-verifies", async () => {
    const t = makeDeps();
    t.resolveBearer.mockResolvedValueOnce("stale-jwt");
    stubProbeStatus(401);
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" }) // seed
      .mockReturnValueOnce({ code: 0, out: `key: ${JWT}\n` }); // mint
    t.getNangoCredentials.mockResolvedValueOnce({ apiKey: JWT });

    const r = await ensureTwentyBearerAttached(t.deps, EXISTING_ROW);

    expect(r).toMatchObject({ working: true, minted: true, nangoConnectionId: "twenty-workspace" });
    expect(t.importNangoConnection).toHaveBeenCalledWith(
      expect.objectContaining({ providerConfigKey: "cinatra-external-mcp", connectionId: "twenty-workspace" }),
    );
  });

  it("readback mismatch → not-working, prior connection kept", async () => {
    const t = makeDeps();
    // no existing row → first attach path
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" })
      .mockReturnValueOnce({ code: 0, out: JWT });
    t.getNangoCredentials.mockResolvedValueOnce({ apiKey: "some-other-key" });

    const r = await ensureTwentyBearerAttached(t.deps, null);

    expect(r).toMatchObject({ working: false, minted: false, nangoConnectionId: null });
    expect(r.note).toBe("nango-readback-mismatch");
  });

  it("UNPUBLISHED registry provider key (older host) → soft not-working, no docker exec", async () => {
    const t = makeDeps();
    (t.deps.registry as { nangoProviderConfigKey?: string }).nangoProviderConfigKey = undefined;

    const r = await ensureTwentyBearerAttached(t.deps, null);

    expect(r).toMatchObject({ working: false, minted: false });
    expect(r.note).toMatch(/provider key unpublished/);
    expect(t.docker).not.toHaveBeenCalled();
  });
});

describe("autoSetupLocalTwenty", () => {
  it("wires the workspace row with the Layer-B catalog allowlist and a minted bearer", async () => {
    const t = makeDeps();
    t.getServerById.mockReturnValueOnce(null); // first wire
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" })
      .mockReturnValueOnce({ code: 0, out: JWT });
    t.getNangoCredentials.mockResolvedValueOnce({ apiKey: JWT });

    const r = await autoSetupLocalTwenty(t.deps);

    expect(r.status).toBe("created");
    expect(t.upsertServer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: LOCAL_TWENTY.rowId,
        serverUrl: LOCAL_TWENTY.mcpUrl,
        scope: "workspace",
        enabled: true,
        allowedTools: null,
        allowedCatalogTools: [...LOCAL_TWENTY.allowedCatalogTools],
      }),
    );
  });

  it("container down → skipped with the compose profile hint", async () => {
    const t = makeDeps();
    (t.deps.helpers.probeDockerContainer as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    const r = await autoSetupLocalTwenty(t.deps);

    expect(r.status).toBe("skipped");
    if (r.status !== "skipped") throw new Error("expected skipped");
    expect(r.reason).toMatch(/--profile twenty/);
    expect(t.upsertServer).not.toHaveBeenCalled();
  });
});
