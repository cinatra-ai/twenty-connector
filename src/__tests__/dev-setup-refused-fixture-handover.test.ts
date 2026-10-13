// The refused fixture account's Twenty connection (cinatra#4112, cinatra#4137).
//
// When a boot refuses the development fixture account, the host makes the
// install's connections for the instance's first administrator. A Twenty
// connection an earlier boot made for the fixture account is handed to that
// administrator through the host's GENERIC hand-over helper
// (`helpers.reownRefusedFixtureConnection`): the hook names its own row and
// answers the helper's key check with its own REST probe; the host resolves
// the refused account and the new owner itself. These cases pin:
//   - the hook asks for the hand-over FIRST, before any probe, reuse, mint or
//     attach, and only for its own row;
//   - the key check is the probe the host used to make (same request, same
//     answers) and refuses an address the host's connect flow refused;
//   - the four outcomes are logged in the words the host used, and the
//     outcomes that change nothing log nothing;
//   - an older host without the helper, or a throwing helper, never fails
//     the hook, which then wires the row exactly as before;
//   - SECRET BOUNDARY: the stored key reaches the probe's request only.
//
// Each case loads the hook module inside itself, so each reads on its own.

import { beforeEach, describe, expect, it, vi } from "vitest";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXYifQ.c2lnbmF0dXJl";
const STORED = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdG9yZWQifQ.c3RvcmVkLXNpZ25hdHVyZQ";
const ROW_URL = "http://localhost:3300/mcp";

type Hook = typeof import("../dev-setup");

async function loadHook(): Promise<Hook> {
  return import("../dev-setup");
}

type Call = { name: string; order: number };

/** Hook deps whose fakes record the order in which the hook reached them. */
function fakes(handOver?: unknown) {
  const calls: Call[] = [];
  let n = 0;
  const record = (name: string) => calls.push({ name, order: (n += 1) });
  const log = vi.fn();
  const upsertServer = vi.fn(() => record("upsertServer"));
  const deps = {
    registry: {
      getServerById: vi.fn(() => {
        record("getServerById");
        return null;
      }),
      upsertServer,
      resolveBearer: vi.fn(async () => {
        record("resolveBearer");
        return null;
      }),
      nangoProviderConfigKey: "cinatra-external-mcp",
      devAttachTwentyBearer: vi.fn(async () => {
        record("devAttachTwentyBearer");
        return { resolved: true, connectionId: "twenty-workspace" };
      }),
    },
    nango: {
      isNangoConfigured: vi.fn(() => true),
      ensureNangoIntegration: vi.fn(async () => null),
      importNangoConnection: vi.fn(async () => null),
      getNangoCredentials: vi.fn(async () => null),
    },
    helpers: {
      probeDockerContainer: vi.fn(() => {
        record("probeDockerContainer");
        return true;
      }),
      probeHttp: vi.fn(() => true),
      probeHttpReachableWithRetry: vi.fn(async () => true),
      dockerExecCapture: vi.fn((_c: string, argv: string[]) => {
        record("dockerExecCapture");
        return argv.includes("workspace:generate-api-key") ? { code: 0, out: JWT } : { code: 0, out: "" };
      }),
      isLocalhostUrl: vi.fn(() => true),
      trimTrailingSlashes: (s: string) => s,
      ...(handOver === undefined ? {} : { reownRefusedFixtureConnection: handOver }),
    },
    log,
  };
  return { deps, calls, log, upsertServer };
}

/** A hook context over the fakes, as the host's dev-only shell builds it. */
function ctxOf(t: ReturnType<typeof fakes>) {
  const providers: Record<string, unknown> = {
    "@cinatra-ai/host:external-mcp-registry": t.deps.registry,
    "nango-system": t.deps.nango,
  };
  return {
    capabilities: {
      resolveProviders: (capability: string) =>
        providers[capability] === undefined ? [] : [{ packageName: "@cinatra-ai/host", impl: providers[capability] }],
    },
    helpers: t.deps.helpers,
    log: t.log,
  } as unknown as Parameters<Hook["runDevSetup"]>[0];
}

function stubFetch(status: number) {
  const fetchMock = vi.fn(async (..._args: unknown[]) => ({ ok: status >= 200 && status < 300, status }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function logged(log: ReturnType<typeof vi.fn>): string[] {
  return log.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the refused fixture account's connection: the hook asks the host to hand it over", () => {
  it("asks for its OWN row, once, BEFORE any probe, reuse, mint or attach", async () => {
    const { runDevSetup, LOCAL_TWENTY } = await loadHook();
    const handOver = vi.fn(async () => "no-owner");
    const t = fakes(handOver);
    handOver.mockImplementation(async () => {
      t.calls.push({ name: "handOver", order: 0 });
      return "no-owner";
    });

    const r = await runDevSetup(ctxOf(t));

    expect(handOver).toHaveBeenCalledTimes(1);
    expect(handOver).toHaveBeenCalledWith({ serverId: LOCAL_TWENTY.rowId, checkKey: expect.any(Function) });
    // The helper is called on the host's helpers object, so a helper written as a method keeps its receiver.
    expect(handOver.mock.contexts[0]).toBe(t.deps.helpers);
    expect(t.calls[0]?.name).toBe("handOver");
    expect(t.calls.map((c) => c.name)).toEqual(
      expect.arrayContaining(["handOver", "probeDockerContainer", "getServerById", "dockerExecCapture", "devAttachTwentyBearer", "upsertServer"]),
    );
    expect(r.status).toBe("created");
  });

  it("the key check is the host's former probe: GET /rest/companies?limit=1 on the instance, the stored key as the bearer", async () => {
    const { checkTwentyKey } = await loadHook();
    const answers: Array<[number, string]> = [[200, "ok"], [401, "unauthorized"], [403, "unauthorized"], [503, "unreachable"], [404, "unreachable"]];
    for (const [status, expected] of answers) {
      const fetchMock = stubFetch(status);
      await expect(checkTwentyKey({ apiKey: STORED, serverUrl: ROW_URL })).resolves.toBe(expected);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
      expect(url).toBe("http://localhost:3300/rest/companies?limit=1");
      expect(init.method).toBe("GET");
      expect(init.headers.Authorization).toBe(`Bearer ${STORED}`);
      vi.unstubAllGlobals();
    }
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));
    await expect(checkTwentyKey({ apiKey: STORED, serverUrl: "https://crm.example.com/mcp/" })).resolves.toBe("unreachable");
  });

  it("the key check refuses an address the host's connect flow refused, and asks Twenty nothing", async () => {
    const { checkTwentyKey, twentyRestBaseOf } = await loadHook();
    const fetchMock = stubFetch(200);
    for (const serverUrl of ["not a url", "ftp://localhost:3300/mcp", "http://crm.example.com/mcp", "https://10.0.0.5/mcp", "https://169.254.169.254/mcp"]) {
      await expect(checkTwentyKey({ apiKey: STORED, serverUrl })).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(twentyRestBaseOf("http://localhost:3300/mcp")).toBe("http://localhost:3300");
    expect(twentyRestBaseOf("https://crm.example.com/base/MCP//")).toBe("https://crm.example.com/base");
  });

  it("logs the four outcomes in the host's words, and nothing for the outcomes that change nothing", async () => {
    const { handOverRefusedFixtureConnection } = await loadHook();
    const said: Record<string, RegExp | null> = {
      reowned: /Twenty connection now belongs to the first administrator \(same key\)/,
      cleared: /had no working key and was removed — the Twenty hook attaches one fresh key for the first administrator/,
      deferred: /kept as it is for now: its key could not be checked against Twenty, or the hand-over did not complete and was undone; a later boot hands it over/,
      failed: /could not hand the refused fixture account's Twenty connection over on this boot — if Twenty stays unconnected, disconnect and reconnect it on the Twenty setup page/,
      "no-owner": null,
      "no-connection": null,
      "not-fixture-owned": null,
    };
    for (const [outcome, line] of Object.entries(said)) {
      const log = vi.fn();
      await expect(handOverRefusedFixtureConnection({ handOverRefusedFixtureConnection: async () => outcome, log })).resolves.toBe(outcome);
      if (line) {
        expect(logged(log)).toHaveLength(1);
        expect(logged(log)[0]).toMatch(line);
      } else {
        expect(log).not.toHaveBeenCalled();
      }
    }
  });

  it("a throwing helper reads as failed and never fails the hook, which wires the row as before", async () => {
    const { runDevSetup } = await loadHook();
    const t = fakes(vi.fn(async () => {
      throw new Error("identity store unavailable");
    }));

    const r = await runDevSetup(ctxOf(t));

    expect(logged(t.log).some((l) => l.startsWith("could not hand the refused fixture account's Twenty connection over"))).toBe(true);
    expect(r.status).toBe("created");
    expect(t.upsertServer).toHaveBeenCalledTimes(1);
  });

  it("an older host without the helper: nothing is asked or logged, and the hook wires the row exactly as before", async () => {
    const { handOverRefusedFixtureConnection, runDevSetup } = await loadHook();
    const log = vi.fn();
    await expect(handOverRefusedFixtureConnection({ log })).resolves.toBeNull();
    expect(log).not.toHaveBeenCalled();

    const t = fakes();
    const r = await runDevSetup(ctxOf(t));
    expect(r.status).toBe("created");
    expect(logged(t.log).filter((l) => l.includes("refused fixture account"))).toEqual([]);
    expect(t.calls[0]?.name).toBe("probeDockerContainer");
  });

  it("SECRET BOUNDARY: the stored key reaches the probe's request only — never a log line, the status or the row", async () => {
    const { runDevSetup } = await loadHook();
    const fetchMock = stubFetch(200);
    const handOver = vi.fn(async (input: { serverId: string; checkKey: (i: { apiKey: string; serverUrl: string }) => Promise<string> }) =>
      (await input.checkKey({ apiKey: STORED, serverUrl: ROW_URL })) === "ok" ? "reowned" : "deferred",
    );
    const t = fakes(handOver);

    const r = await runDevSetup(ctxOf(t));

    expect(handOver).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some((c) => (c[1] as { headers: Record<string, string> }).headers.Authorization === `Bearer ${STORED}`)).toBe(true);
    const surfaced = [JSON.stringify(r), ...logged(t.log), JSON.stringify(t.upsertServer.mock.calls)].join("\n");
    expect(surfaced).not.toContain(STORED);
    expect(logged(t.log).some((l) => l.includes("now belongs to the first administrator (same key)"))).toBe(true);
  });
});
