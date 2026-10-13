// The Twenty connector's preview HOST HANDOVER (cinatra-ai/cinatra#4112).
//
// Declared in this package's manifest as
// `cinatra.devCliModules["preview-host-handover"]`. The cinatra CLI
// (cinatra-cli src/preview-host-handover.mjs) imports it ON THE HOST from the
// checkout's extensions/ tree and calls `previewHostHandover({ log })` once
// before `docker run` of a preview container. It answers
// `{ env?: Record<string, string>, forwards?: Array<{ port, network, target }> }`.
// Plain Node ESM with Node built-ins only, like src/twenty-keygen.mjs: the CLI
// imports it without the app's toolchain.
//
// WHY: a preview container carries no docker and no curl, so the connector's
// dev hook (src/dev-setup.ts) cannot mint a workspace key there, and the
// address it dials, http://localhost:3300, is the container's own loopback.
// This module therefore:
//   - mints the workspace key HERE, on the host, with the docker argv the dev
//     hook uses (src/twenty-keygen.mjs: the idempotent seed, then the mint),
//     and hands it over in the env var this package declares in
//     `cinatra.envOverrides` (the hook reads it through the host's env reader);
//   - declares ONE forward: 127.0.0.1:3300 inside the preview container to the
//     Twenty server's own port on the docker network the server container is
//     attached to (read from the running container, never assumed).
// Without a running server container on a user-defined network it hands
// nothing over and mints nothing.
//
// SECRET BOUNDARY: the minted key lives only in the returned env map. It is
// never logged, never part of an argv, never written to a file here, and the
// mint's output is piped, never inherited. Every log line is fixed text.
// Never throws: any failure answers `{}` (the CLI then hands nothing over).

import { spawnSync } from "node:child_process";

import {
  buildSeedDevArgs,
  buildGenerateApiKeyArgs,
  parseTwentyApiKey,
} from "./twenty-keygen.mjs";

/** The env var this package declares in `cinatra.envOverrides` (secrets:devApiKey). */
export const PREVIEW_HANDOVER_ENV_NAME = "CINATRA_EXT_CINATRA_HAI_STWENTY_HCONNECTOR__DEV_API_KEY";
/** The Twenty server container (the dev hook's LOCAL_TWENTY.containerName). */
export const TWENTY_SERVER_CONTAINER = "cinatra-twenty-1";
/** The port the connector dials inside the container (http://localhost:3300). */
export const TWENTY_LOCAL_PORT = 3300;
/** The Twenty server's own port on its docker network. */
export const TWENTY_SERVER_PORT = 3000;
/** The name of the workspace key minted for a preview. */
export const PREVIEW_HANDOVER_KEY_NAME = "cinatra-preview-handover";
/** Per-call bounds; together below the CLI's 120 s budget for a declarer. */
export const INSPECT_TIMEOUT_MS = 15_000;
export const EXEC_TIMEOUT_MS = 50_000;

// Docker's own networks without a name service for container names.
const DEFAULT_NETWORKS = new Set(["bridge", "host", "none"]);
// The network names the CLI accepts for a forward.
const NETWORK_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function defaultDocker(args, { timeoutMs }) {
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
}

/**
 * The user-defined networks of the running Twenty server container, sorted, or
 * null when it does not run (or docker does not answer).
 */
export function readTwentyServerNetworks(docker) {
  const r = docker(
    [
      "inspect",
      "--format",
      "{{.State.Running}}|{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}",
      TWENTY_SERVER_CONTAINER,
    ],
    { timeoutMs: INSPECT_TIMEOUT_MS },
  );
  if (r.status !== 0) return null;
  const [running, names = ""] = String(r.stdout ?? "").trim().split("|");
  if (running !== "true") return null;
  return names
    .split(/\s+/)
    .filter((name) => NETWORK_RE.test(name) && !DEFAULT_NETWORKS.has(name))
    .sort();
}

/** The CLI's declarer entry point (cinatra.devCliModules["preview-host-handover"]). */
export async function previewHostHandover({ log = () => {}, docker = defaultDocker } = {}) {
  const say = (line) => {
    try {
      log(`  Twenty CRM: ${line}`);
    } catch {
      // a failing log sink never fails the handover
    }
  };
  try {
    const networks = readTwentyServerNetworks(docker);
    if (networks === null) {
      say(`${TWENTY_SERVER_CONTAINER} is not running; no key and no forward are handed to the preview.`);
      return {};
    }
    if (networks.length === 0) {
      say(`${TWENTY_SERVER_CONTAINER} is on no user-defined docker network; no key and no forward are handed to the preview.`);
      return {};
    }
    const network = networks[0];
    const seed = docker(["exec", TWENTY_SERVER_CONTAINER, ...buildSeedDevArgs()], { timeoutMs: EXEC_TIMEOUT_MS });
    if (seed.status !== 0) {
      say(`the workspace seed exited ${seed.status}; no key and no forward are handed to the preview.`);
      return {};
    }
    const minted = docker(
      ["exec", TWENTY_SERVER_CONTAINER, ...buildGenerateApiKeyArgs({ keyName: PREVIEW_HANDOVER_KEY_NAME })],
      { timeoutMs: EXEC_TIMEOUT_MS },
    );
    // Only a clean exit is trusted: a failed exec can still print JWT-shaped noise.
    const key = minted.status === 0 ? parseTwentyApiKey(minted.stdout) : null;
    if (!key) {
      say(`could not mint a workspace key (exit ${minted.status}); no key and no forward are handed to the preview.`);
      return {};
    }
    say(
      `hands the preview a workspace key and the forward 127.0.0.1:${TWENTY_LOCAL_PORT} -> ` +
        `${TWENTY_SERVER_CONTAINER}:${TWENTY_SERVER_PORT} (network ${network}).`,
    );
    return {
      env: { [PREVIEW_HANDOVER_ENV_NAME]: key },
      forwards: [
        { port: TWENTY_LOCAL_PORT, network, target: `${TWENTY_SERVER_CONTAINER}:${TWENTY_SERVER_PORT}` },
      ],
    };
  } catch {
    // SECRET BOUNDARY: a fixed line; a thrown message could echo the key.
    say("the handover failed; no key and no forward are handed to the preview.");
    return {};
  }
}
