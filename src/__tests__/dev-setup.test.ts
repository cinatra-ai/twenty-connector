// Connector-owned dev-setup hook — Twenty bearer attach discipline
// (cinatra#976 relocation; the reuse-first / probe-then-rotate rules the host's
// dev-auto-setup enforced, now asserted against the hook's explicit deps):
//   - reuse on an "ok" probe; keep on an indeterminate probe (never mint)
//   - never mint on an unresolved credential with a prior connection
//   - mint + import + readback-verify only on a definite auth failure or a
//     first attach; the import lands under the registry's PUBLISHED provider key
//   - with no docker in the instance, a HOST-HANDED key (read through the
//     host's env reader) is attached on the same road where the docker road
//     would mint; reuse-first stays; with docker present the key is ignored
//
// SECRET BOUNDARY: assertions only check statuses/booleans — never a key value.

import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  ensureTwentyBearerAttached,
  autoSetupLocalTwenty,
  runDevSetup,
  LOCAL_TWENTY,
  type TwentyDevSetupDeps,
} from "../dev-setup";

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

// ---------------------------------------------------------------------------
// HOST-HANDED KEY (cinatra#4098): a preview instance has no docker and no curl.
// The install mints the workspace key on the machine and hands it to the
// instance in the env var the manifest declares; the hook reads it through the
// host's env reader and attaches it where the docker road would mint.
// ---------------------------------------------------------------------------

const HANDED = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYW5kZWQifQ.aGFuZGVkLXNpZ25hdHVyZQ";
const HANDED_ENV_VAR = "CINATRA_EXT_CINATRA_HAI_STWENTY_HCONNECTOR__DEV_API_KEY";

/** No docker binary and no curl binary: both host probes answer false. */
function withoutDocker(t: Fakes, handedApiKey?: string | null): Fakes {
  (t.deps.helpers.probeDockerContainer as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (t.deps.helpers.probeHttp as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (t.deps as { handedApiKey?: string | null }).handedApiKey = handedApiKey;
  return t;
}

/** Every text the hook could surface: the status, the log lines, the row. */
function surfacedText(t: Fakes, result: unknown): string {
  const logged = (t.deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
  return [JSON.stringify(result), ...logged, JSON.stringify(t.upsertServer.mock.calls)].join("\n");
}

describe("host-handed key (no docker in the instance)", () => {
  it("NO DOCKER + HANDED KEY, first wire: attaches the handed key on the sanctioned road — no docker exec, no curl probe", async () => {
    const t = withoutDocker(makeDeps(), HANDED);

    const r = await autoSetupLocalTwenty(t.deps);

    expect(t.devAttachTwentyBearer).toHaveBeenCalledTimes(1);
    expect(t.devAttachTwentyBearer).toHaveBeenCalledWith({ instanceUrl: LOCAL_TWENTY.serverUrl, apiKey: HANDED });
    expect(t.docker).not.toHaveBeenCalled();
    expect(t.deps.helpers.probeHttp).not.toHaveBeenCalled();
    expect(r.status).toBe("created");
    if (r.status !== "created") throw new Error("expected created");
    expect(r.detail).toContain("host-handed bearer attached");
    expect(t.upsertServer).toHaveBeenCalledWith(
      expect.objectContaining({ id: LOCAL_TWENTY.rowId, nangoConnectionId: "twenty-workspace", enabled: true }),
    );
  });

  it("NO DOCKER + HANDED KEY + an existing row whose bearer authenticates: REUSE — no attach, no duplicate", async () => {
    const t = withoutDocker(makeDeps(), HANDED);
    t.getServerById.mockReturnValue(EXISTING_ROW);
    t.resolveBearer.mockResolvedValueOnce(JWT);
    stubProbeStatus(200);

    const r = await autoSetupLocalTwenty(t.deps);

    expect(r.status).toBe("already-wired");
    if (r.status !== "already-wired") throw new Error("expected already-wired");
    expect(r.detail).toContain("bearer present");
    expect(t.devAttachTwentyBearer).not.toHaveBeenCalled();
    expect(t.docker).not.toHaveBeenCalled();
    expect(t.upsertServer).toHaveBeenCalledWith(expect.objectContaining({ nangoConnectionId: "twenty-workspace" }));
  });

  it("NO DOCKER + HANDED KEY + an existing row on an indeterminate probe: KEEP — no attach", async () => {
    const t = withoutDocker(makeDeps(), HANDED);
    t.getServerById.mockReturnValue(EXISTING_ROW);
    t.resolveBearer.mockResolvedValueOnce(JWT);
    stubProbeStatus(503);

    const r = await autoSetupLocalTwenty(t.deps);

    expect(r.status).toBe("already-wired");
    expect(t.devAttachTwentyBearer).not.toHaveBeenCalled();
    expect(t.docker).not.toHaveBeenCalled();
  });

  it("NO DOCKER + HANDED KEY + an existing row on a definite 401: ROTATE with the handed key, never a docker mint", async () => {
    const t = withoutDocker(makeDeps(), HANDED);
    t.getServerById.mockReturnValue(EXISTING_ROW);
    t.resolveBearer.mockResolvedValueOnce("stale-jwt");
    stubProbeStatus(401);

    const r = await autoSetupLocalTwenty(t.deps);

    expect(r.status).toBe("already-wired");
    expect(t.devAttachTwentyBearer).toHaveBeenCalledTimes(1);
    expect(t.devAttachTwentyBearer).toHaveBeenCalledWith({ instanceUrl: LOCAL_TWENTY.serverUrl, apiKey: HANDED });
    expect(t.docker).not.toHaveBeenCalled();
  });

  it("a handed key never mints over an unresolved credential or without Nango (reuse-first rules hold)", async () => {
    const unresolved = makeDeps();
    unresolved.resolveBearer.mockResolvedValueOnce(null);
    const kept = await ensureTwentyBearerAttached(unresolved.deps, EXISTING_ROW, { handedApiKey: HANDED });
    expect(kept).toMatchObject({ working: false, minted: false, nangoConnectionId: "twenty-workspace" });
    expect(kept.note).toMatch(/credential-unresolved/);
    expect(unresolved.devAttachTwentyBearer).not.toHaveBeenCalled();

    const noNango = makeDeps();
    (noNango.deps.nango.isNangoConfigured as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const r = await ensureTwentyBearerAttached(noNango.deps, null, { handedApiKey: HANDED });
    expect(r).toMatchObject({ working: false, minted: false, note: "nango-not-configured" });
    expect(noNango.devAttachTwentyBearer).not.toHaveBeenCalled();
  });

  it("NO DOCKER + NO HANDED KEY: skipped exactly as today", async () => {
    for (const handed of [undefined, null, "", "   "]) {
      const t = withoutDocker(makeDeps(), handed);

      const r = await autoSetupLocalTwenty(t.deps);

      expect(r.status).toBe("skipped");
      if (r.status !== "skipped") throw new Error("expected skipped");
      expect(r.reason).toBe(`${LOCAL_TWENTY.containerName} not running (run docker compose --profile twenty up -d)`);
      expect(t.upsertServer).not.toHaveBeenCalled();
      expect(t.devAttachTwentyBearer).not.toHaveBeenCalled();
      expect(t.docker).not.toHaveBeenCalled();
    }
  });

  it("SECRET BOUNDARY: the handed key reaches only the attach road — never a log line, a status or a returned field", async () => {
    const scenarios: Array<(t: Fakes) => void> = [
      () => {},
      (t) => t.devAttachTwentyBearer.mockResolvedValueOnce({ resolved: false, connectionId: null }),
      (t) => t.devAttachTwentyBearer.mockRejectedValueOnce(new Error(`nango 400 on payload {"apiKey":"${HANDED}"}`)),
      (t) => {
        t.getServerById.mockReturnValue(EXISTING_ROW);
        t.resolveBearer.mockResolvedValueOnce("stale-jwt");
        stubProbeStatus(401);
      },
    ];
    for (const arrange of scenarios) {
      vi.unstubAllGlobals();
      const t = withoutDocker(makeDeps(), HANDED);
      arrange(t);

      const r = await autoSetupLocalTwenty(t.deps);
      // The returned outcome is read under the SAME arranged scenario (a failed
      // attach, a throwing writer, a rotation), not only on a clean attach.
      const direct = withoutDocker(makeDeps(), HANDED);
      arrange(direct);
      const outcome = await ensureTwentyBearerAttached(direct.deps, direct.deps.registry.getServerById(LOCAL_TWENTY.rowId), {
        handedApiKey: HANDED,
      });

      expect(t.devAttachTwentyBearer).toHaveBeenCalledWith(expect.objectContaining({ apiKey: HANDED }));
      expect(direct.devAttachTwentyBearer).toHaveBeenCalledWith(expect.objectContaining({ apiKey: HANDED }));
      expect(surfacedText(t, r)).not.toContain(HANDED);
      expect(JSON.stringify(outcome)).not.toContain(HANDED);
    }
  });

  it("DOCKER PRESENT: the handed key is ignored — the docker road mints and attaches its own key", async () => {
    const t = makeDeps();
    (t.deps as { handedApiKey?: string }).handedApiKey = HANDED;
    t.docker
      .mockReturnValueOnce({ code: 0, out: "" }) // seed
      .mockReturnValueOnce({ code: 0, out: `key: ${JWT}\n` }); // mint

    const r = await autoSetupLocalTwenty(t.deps);

    expect(r.status).toBe("created");
    expect(t.docker).toHaveBeenCalledTimes(2);
    expect(t.devAttachTwentyBearer).toHaveBeenCalledTimes(1);
    expect(t.devAttachTwentyBearer).toHaveBeenCalledWith({ instanceUrl: LOCAL_TWENTY.serverUrl, apiKey: JWT });
  });
});

describe("runDevSetup reads the handed key through the host's env reader", () => {
  function ctxFor(t: Fakes, connectorConfig: unknown) {
    const providers: Record<string, unknown> = {
      "@cinatra-ai/host:external-mcp-registry": t.deps.registry,
      "nango-system": t.deps.nango,
      "@cinatra-ai/host:connector-config": connectorConfig,
    };
    return {
      capabilities: {
        resolveProviders: vi.fn((capability: string) =>
          providers[capability] === undefined ? [] : [{ packageName: "@cinatra-ai/host", impl: providers[capability] }],
        ),
      },
      helpers: t.deps.helpers,
      log: t.deps.log,
    } as unknown as Parameters<typeof runDevSetup>[0];
  }

  it("asks the connector-config reader for THIS package's overrides and attaches its devApiKey when docker is unavailable", async () => {
    const t = withoutDocker(makeDeps());
    const resolveEnvOverrides = vi.fn(() => ({ devApiKey: HANDED }));

    const r = await runDevSetup(ctxFor(t, { read: vi.fn(), write: vi.fn(), resolveEnvOverrides }));

    expect(resolveEnvOverrides).toHaveBeenCalledWith("@cinatra-ai/twenty-connector");
    expect(t.devAttachTwentyBearer).toHaveBeenCalledWith({ instanceUrl: LOCAL_TWENTY.serverUrl, apiKey: HANDED });
    expect(r.status).toBe("created");
    expect(surfacedText(t, r)).not.toContain(HANDED);
  });

  it("an older host (no reader), a throwing reader or a blank value → no handed key: skipped as today", async () => {
    const readers: unknown[] = [
      undefined,
      { read: vi.fn(), write: vi.fn() },
      { resolveEnvOverrides: vi.fn(() => { throw new Error("registry unavailable"); }) },
      { resolveEnvOverrides: vi.fn(() => ({ devApiKey: "   " })) },
      { resolveEnvOverrides: vi.fn(() => ({})) },
    ];
    for (const reader of readers) {
      const t = withoutDocker(makeDeps());

      const r = await runDevSetup(ctxFor(t, reader));

      expect(r.status).toBe("skipped");
      if (r.status !== "skipped") throw new Error("expected skipped");
      expect(r.reason).toMatch(/--profile twenty/);
      expect(t.devAttachTwentyBearer).not.toHaveBeenCalled();
    }
  });
});

describe("manifest: the host-handed key's env var", () => {
  it("declares exactly the namespaced env var mapped to secrets:devApiKey", async () => {
    const { readFileSync } = await vi.importActual<{ readFileSync: (path: URL, encoding: "utf-8") => string }>("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as {
      name: string;
      cinatra: { envOverrides?: Record<string, string> };
    };
    expect(pkg.cinatra.envOverrides).toEqual({ [HANDED_ENV_VAR]: "secrets:devApiKey" });
    // The SDK's namespace rule (packages/sdk-extensions env-overrides.ts): drop
    // the scope sigil, uppercase alphanumerics, `-` -> `_H`, `/` -> `_S`, then
    // `CINATRA_EXT_<namespace>__<KEY>`.
    const namespace = pkg.name
      .replace(/^@/, "")
      .replace(/[^A-Za-z0-9]/g, (ch) => ({ "-": "_H", _: "_U", ".": "_D", "/": "_S" })[ch] ?? ch)
      .toUpperCase();
    expect(HANDED_ENV_VAR.startsWith(`CINATRA_EXT_${namespace}__`)).toBe(true);
    expect(HANDED_ENV_VAR).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });
});
