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
  devAttachTwentyBearer: ReturnType<typeof vi.fn>;
  upsertServer: ReturnType<typeof vi.fn>;
  getServerById: ReturnType<typeof vi.fn>;
};

function makeDeps(): Fakes {
  const docker = vi.fn(() => ({ code: 0, out: "" }));
  const resolveBearer = vi.fn(async () => null);
  const importNangoConnection = vi.fn(async () => null);
  const getNangoCredentials = vi.fn(async () => null);
  // Sanctioned host attach (cinatra#1238) — defaults to a resolved bearer.
  const devAttachTwentyBearer = vi.fn(async () => ({ resolved: true, connectionId: "twenty-workspace" }));
  const upsertServer = vi.fn();
  const getServerById = vi.fn(() => null);
  const deps = {
    registry: {
      getServerById,
      upsertServer,
      resolveBearer,
      nangoProviderConfigKey: "cinatra-external-mcp",
      devAttachTwentyBearer,
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
  return { deps, docker, resolveBearer, importNangoConnection, getNangoCredentials, devAttachTwentyBearer, upsertServer, getServerById };
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

  it("FIRST WIRE (no prior): mints via docker exec then the SANCTIONED host attach seeds identity → a RESOLVED bearer in a single boot (cinatra#1238)", async () => {
    const t = makeDeps();
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" }) // seed
      .mockReturnValueOnce({ code: 0, out: `key: ${JWT}\n` }); // mint
    // The host writer runs saveTwentyConnection (identity + grant seed) and
    // reports the gated resolver mints a bearer.
    t.devAttachTwentyBearer.mockResolvedValueOnce({ resolved: true, connectionId: "twenty-workspace" });

    const r = await ensureTwentyBearerAttached(t.deps, null);

    expect(r).toMatchObject({ working: true, minted: true, nangoConnectionId: "twenty-workspace" });
    // Attached with the minted key against the local Twenty instance URL.
    expect(t.devAttachTwentyBearer).toHaveBeenCalledWith({
      instanceUrl: LOCAL_TWENTY.serverUrl,
      apiKey: JWT,
    });
    // The connector no longer imports the raw Nango credential itself.
    expect(t.importNangoConnection).not.toHaveBeenCalled();
  });

  it("ROTATE on a definite 401 — mints and re-attaches through the sanctioned writer", async () => {
    const t = makeDeps();
    t.resolveBearer.mockResolvedValueOnce("stale-jwt");
    stubProbeStatus(401);
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" }) // seed
      .mockReturnValueOnce({ code: 0, out: `key: ${JWT}\n` }); // mint
    t.devAttachTwentyBearer.mockResolvedValueOnce({ resolved: true, connectionId: "twenty-workspace" });

    const r = await ensureTwentyBearerAttached(t.deps, EXISTING_ROW);

    expect(r).toMatchObject({ working: true, minted: true, nangoConnectionId: "twenty-workspace" });
    expect(t.devAttachTwentyBearer).toHaveBeenCalledWith({ instanceUrl: LOCAL_TWENTY.serverUrl, apiKey: JWT });
  });

  it("ATTACH-UNRESOLVED: the sanctioned save ran but the gated resolver did not mint → honest not-working (no false positive)", async () => {
    const t = makeDeps();
    // no existing row → first attach path
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" })
      .mockReturnValueOnce({ code: 0, out: JWT });
    t.devAttachTwentyBearer.mockResolvedValueOnce({ resolved: false, connectionId: null });

    const r = await ensureTwentyBearerAttached(t.deps, null);

    expect(r).toMatchObject({ working: false, minted: false });
    expect(r.note).toBe("attach-unresolved");
  });

  it("UNPUBLISHED registry provider key (older host) → soft not-working, no docker exec", async () => {
    const t = makeDeps();
    (t.deps.registry as { nangoProviderConfigKey?: string }).nangoProviderConfigKey = undefined;

    const r = await ensureTwentyBearerAttached(t.deps, null);

    expect(r).toMatchObject({ working: false, minted: false });
    expect(r.note).toMatch(/provider key unpublished/);
    expect(t.docker).not.toHaveBeenCalled();
  });

  it("OLDER HOST without the dev-attach writer → soft not-working, no docker exec", async () => {
    const t = makeDeps();
    (t.deps.registry as { devAttachTwentyBearer?: unknown }).devAttachTwentyBearer = undefined;

    const r = await ensureTwentyBearerAttached(t.deps, null);

    expect(r).toMatchObject({ working: false, minted: false });
    expect(r.note).toMatch(/dev-attach writer \(older host\)/);
    expect(t.docker).not.toHaveBeenCalled();
  });

  it("SECRET BOUNDARY: a throwing dev-attach writer whose message echoes the JWT → fixed 'attach-failed' note, never the raw message", async () => {
    const t = makeDeps();
    t.resolveBearer.mockResolvedValueOnce("stale-jwt");
    stubProbeStatus(401);
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" }) // seed
      .mockReturnValueOnce({ code: 0, out: `key: ${JWT}\n` }); // mint
    // Simulate the host writer rethrowing its request payload (the minted JWT)
    // in the error message — the note must NOT carry it through.
    t.devAttachTwentyBearer.mockRejectedValueOnce(new Error(`nango 400 on payload {"apiKey":"${JWT}"}`));

    const r = await ensureTwentyBearerAttached(t.deps, EXISTING_ROW);

    expect(r).toMatchObject({ working: false, minted: false, nangoConnectionId: "twenty-workspace" });
    expect(r.note).toBe("attach-failed");
    expect(r.note ?? "").not.toContain(JWT);
  });

  it("MINT exit-code: a non-zero docker exec with JWT-shaped stdout is NOT trusted", async () => {
    const t = makeDeps();
    // No prior row → first-attach mint path.
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" }) // seed
      .mockReturnValueOnce({ code: 1, out: `key: ${JWT}\n` }); // mint failed but emitted JWT-shaped noise

    const r = await ensureTwentyBearerAttached(t.deps, null);

    expect(r).toMatchObject({ working: false, minted: false });
    expect(r.note).toMatch(/mint-failed \(exit 1\)/);
    expect(t.devAttachTwentyBearer).not.toHaveBeenCalled();
  });
});

describe("autoSetupLocalTwenty", () => {
  it("wires the workspace row with the Layer-B catalog allowlist and a minted bearer", async () => {
    const t = makeDeps();
    t.getServerById.mockReturnValueOnce(null); // first wire
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" })
      .mockReturnValueOnce({ code: 0, out: JWT });
    t.devAttachTwentyBearer.mockResolvedValueOnce({ resolved: true, connectionId: "twenty-workspace" });

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

  it("NEVER-THROW: a throwing host probe helper yields a soft-fail status, not a rejection", async () => {
    const t = makeDeps();
    (t.deps.helpers.probeDockerContainer as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("docker daemon unreachable");
    });

    const r = await autoSetupLocalTwenty(t.deps);

    expect(r.status).toBe("error");
    if (r.status !== "error") throw new Error("expected error");
    expect(r.reason).toBe("dev-setup-probe-failed");
    expect(t.upsertServer).not.toHaveBeenCalled();
  });

  it("NEVER-THROW: a throwing getServerById yields a soft-fail status, not a rejection", async () => {
    const t = makeDeps();
    t.getServerById.mockImplementationOnce(() => {
      throw new Error("registry read failed");
    });

    const r = await autoSetupLocalTwenty(t.deps);

    expect(r.status).toBe("error");
    if (r.status !== "error") throw new Error("expected error");
    expect(r.reason).toBe("dev-setup-probe-failed");
  });
});
