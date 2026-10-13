// The preview HOST HANDOVER declarer (cinatra#4112): the module the cinatra CLI
// imports on the host through `cinatra.devCliModules["preview-host-handover"]`
// and calls once before `docker run` of a preview container
// (cinatra-cli src/preview-host-handover.mjs: `previewHostHandover({ log })`,
// async, answering `{ env?, forwards? }`).
//   - it mints the workspace key on the host with the dev hook's own docker
//     argv (src/twenty-keygen.mjs) and hands it over in the env var this
//     package declares in `cinatra.envOverrides`;
//   - it declares ONE forward, 127.0.0.1:3300 to the Twenty server's port 3000
//     on the docker network the running server container is attached to;
//   - without a running server on a user-defined network, a failed seed or a
//     failed mint it hands nothing over; it never throws.
//
// SECRET BOUNDARY: the key used here is a made-up JWT-shaped string; the
// assertions check that it reaches only the returned env map.

import { describe, expect, it, vi, beforeEach } from "vitest";

import { buildSeedDevArgs, buildGenerateApiKeyArgs } from "../twenty-keygen.mjs";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));

type Docker = (args: string[], opts: { timeoutMs: number }) => { status: number | null; stdout: string };
type Handover = {
  env?: Record<string, string>;
  forwards?: Array<{ port: number; network: string; target: string }>;
};
type Module = {
  previewHostHandover: (opts?: { log?: (line: string) => void; docker?: Docker }) => Promise<Handover>;
};

// Loaded inside each case, so each case reads red on its own while the module is absent.
const load = async (): Promise<Module> => (await import("../preview-host-handover.mjs")) as unknown as Module;

const KEY = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcmV2aWV3In0.bWFkZS11cA";
const ENV_NAME = "CINATRA_EXT_CINATRA_HAI_STWENTY_HCONNECTOR__DEV_API_KEY";
const NETWORK = "lane-twenty_default";
const INSPECT = [
  "inspect",
  "--format",
  "{{.State.Running}}|{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}",
  "cinatra-twenty-1",
];
const SEED = ["exec", "cinatra-twenty-1", ...buildSeedDevArgs()];
const MINT = ["exec", "cinatra-twenty-1", ...buildGenerateApiKeyArgs({ keyName: "cinatra-preview-handover" })];

// The CLI's acceptance of a declarer's answer (cinatra-cli 5d2435a6
// src/preview-host-handover.mjs: HANDOVER_ENV_NAME_RE, NETWORK_RE,
// TARGET_HOST_RE, ports 1024-65535 other than the preview app's 3000).
const CLI_ENV_NAME_RE = /^CINATRA_EXT_[A-Z0-9_]+__[A-Z0-9_]+$/;
const CLI_NETWORK_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const CLI_TARGET_HOST_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,252}$/;

function fakeDocker(answers: { inspect?: string | null; seed?: number; mint?: { status: number; stdout: string } } = {}) {
  const calls: string[][] = [];
  const docker = vi.fn((args: string[], opts: { timeoutMs: number }) => {
    calls.push(args);
    expect(opts.timeoutMs).toBeGreaterThan(0);
    if (args[0] === "inspect") {
      const inspect = answers.inspect === undefined ? `true|bridge ${NETWORK} ` : answers.inspect;
      return inspect === null ? { status: 1, stdout: "" } : { status: 0, stdout: `${inspect}\n` };
    }
    if (args.includes("workspace:seed:dev")) return { status: answers.seed ?? 0, stdout: "seeded\n" };
    if (args.includes("workspace:generate-api-key")) {
      return answers.mint ?? { status: 0, stdout: `info: generated\n  ${KEY}\n done\n` };
    }
    return { status: 1, stdout: "" };
  });
  return { docker, calls };
}

beforeEach(() => {
  spawnSync.mockReset();
});

describe("manifest: the preview host handover declaration", () => {
  it("declares cinatra.devCliModules['preview-host-handover'] as a published module inside the package", async () => {
    const fs = await vi.importActual<{
      readFileSync: (path: URL, encoding: "utf-8") => string;
      existsSync: (path: URL) => boolean;
    }>("node:fs");
    const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as {
      files: string[];
      cinatra: { devCliModules?: Record<string, string>; envOverrides?: Record<string, string> };
    };
    expect(pkg.cinatra.devCliModules).toEqual({ "preview-host-handover": "./src/preview-host-handover.mjs" });
    expect(fs.existsSync(new URL("../preview-host-handover.mjs", import.meta.url))).toBe(true);
    expect(pkg.files).toContain("src");
    // The env var it hands over is the one the manifest maps onto the hook's handed key.
    expect(pkg.cinatra.envOverrides?.[ENV_NAME]).toBe("secrets:devApiKey");
  });
});

describe("previewHostHandover: the host-side mint and the 3300 forward", () => {
  it("mints on the host with the dev hook's argv and hands over the key and one forward to the server's network", async () => {
    const { previewHostHandover } = await load();
    const { docker, calls } = fakeDocker();
    const out = await previewHostHandover({ log: () => {}, docker });
    expect(calls).toEqual([INSPECT, SEED, MINT]);
    expect(out).toEqual({
      env: { [ENV_NAME]: KEY },
      forwards: [{ port: 3300, network: NETWORK, target: "cinatra-twenty-1:3000" }],
    });
  });

  it("answers the shape the CLI accepts: a namespaced one-line env entry and a valid forward", async () => {
    const { previewHostHandover } = await load();
    const out = await previewHostHandover({ log: () => {}, docker: fakeDocker().docker });
    for (const [name, value] of Object.entries(out.env ?? {})) {
      expect(name).toMatch(CLI_ENV_NAME_RE);
      expect(value).not.toMatch(/[\n\r\0]/);
    }
    expect(out.forwards).toHaveLength(1);
    for (const f of out.forwards ?? []) {
      expect(Number.isInteger(f.port) && f.port >= 1024 && f.port <= 65535 && f.port !== 3000).toBe(true);
      expect(f.network).toMatch(CLI_NETWORK_RE);
      const i = f.target.lastIndexOf(":");
      expect(f.target.slice(0, i)).toMatch(CLI_TARGET_HOST_RE);
      expect(f.target.slice(i + 1)).toBe("3000");
    }
  });

  it("SECRET BOUNDARY: the key reaches only the returned env map — never a log line or a docker argument", async () => {
    const { previewHostHandover } = await load();
    const lines: string[] = [];
    const { docker, calls } = fakeDocker();
    const out = await previewHostHandover({ log: (line) => lines.push(line), docker });
    expect(out.env?.[ENV_NAME]).toBe(KEY);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(KEY);
    expect(JSON.stringify(calls)).not.toContain(KEY);
    expect(JSON.stringify(out.forwards)).not.toContain(KEY);
  });

  it("its default docker runner pipes every output and bounds every call", async () => {
    const { previewHostHandover } = await load();
    spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "inspect") return { status: 0, stdout: `true|${NETWORK} \n`, stderr: "" };
      if (args.includes("workspace:generate-api-key")) return { status: 0, stdout: `  ${KEY}\n`, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    const out = await previewHostHandover({ log: () => {} });
    expect(out.env?.[ENV_NAME]).toBe(KEY);
    expect(spawnSync).toHaveBeenCalledTimes(3);
    for (const [cmd, , opts] of spawnSync.mock.calls) {
      expect(cmd).toBe("docker");
      expect(opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
      expect(opts.timeout).toBeGreaterThan(0);
    }
  });

  it("reads the network from the running server container and skips docker's default networks", async () => {
    const { previewHostHandover } = await load();
    const { docker } = fakeDocker({ inspect: "true|bridge zz-net aa-net " });
    const out = await previewHostHandover({ log: () => {}, docker });
    expect(out.forwards).toEqual([{ port: 3300, network: "aa-net", target: "cinatra-twenty-1:3000" }]);
  });

  it("hands nothing over and mints nothing when the server container does not run", async () => {
    const { previewHostHandover } = await load();
    for (const inspect of [null, "false|lane-twenty_default "]) {
      const lines: string[] = [];
      const { docker, calls } = fakeDocker({ inspect });
      expect(await previewHostHandover({ log: (line) => lines.push(line), docker })).toEqual({});
      expect(calls).toEqual([INSPECT]);
      expect(lines).toHaveLength(1);
    }
  });

  it("hands nothing over and mints nothing when the server is on no user-defined network", async () => {
    const { previewHostHandover } = await load();
    const { docker, calls } = fakeDocker({ inspect: "true|bridge " });
    expect(await previewHostHandover({ log: () => {}, docker })).toEqual({});
    expect(calls).toEqual([INSPECT]);
  });

  it("hands nothing over when the seed or the mint fails, and never trusts a failed mint's output", async () => {
    const { previewHostHandover } = await load();
    const seedFails = fakeDocker({ seed: 1 });
    expect(await previewHostHandover({ log: () => {}, docker: seedFails.docker })).toEqual({});
    expect(seedFails.calls).toEqual([INSPECT, SEED]);
    const mintFails = fakeDocker({ mint: { status: 1, stdout: `error\n  ${KEY}\n` } });
    const lines: string[] = [];
    expect(await previewHostHandover({ log: (line) => lines.push(line), docker: mintFails.docker })).toEqual({});
    expect(lines.join("\n")).not.toContain(KEY);
    const noKey = fakeDocker({ mint: { status: 0, stdout: "no key printed\n" } });
    expect(await previewHostHandover({ log: () => {}, docker: noKey.docker })).toEqual({});
  });

  it("never throws: a docker runner or a log sink that throws answers nothing handed over", async () => {
    const { previewHostHandover } = await load();
    const docker = vi.fn(() => {
      throw new Error(`boom ${KEY}`);
    });
    const lines: string[] = [];
    await expect(previewHostHandover({ log: (line) => lines.push(line), docker })).resolves.toEqual({});
    expect(lines.join("\n")).not.toContain(KEY);
    const throwingLog = () => {
      throw new Error("sink");
    };
    await expect(previewHostHandover({ log: throwingLog, docker: fakeDocker().docker })).resolves.toEqual({
      env: { [ENV_NAME]: KEY },
      forwards: [{ port: 3300, network: NETWORK, target: "cinatra-twenty-1:3000" }],
    });
  });
});
