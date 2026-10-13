// Type declarations for the preview host handover (src/preview-host-handover.mjs).
// Keep in lockstep with the .mjs.

export declare const PREVIEW_HANDOVER_ENV_NAME: string;
export declare const TWENTY_SERVER_CONTAINER: string;
export declare const TWENTY_LOCAL_PORT: number;
export declare const TWENTY_SERVER_PORT: number;
export declare const PREVIEW_HANDOVER_KEY_NAME: string;
export declare const INSPECT_TIMEOUT_MS: number;
export declare const EXEC_TIMEOUT_MS: number;

/** One docker call: its argv and its bound; answers the exit status (null when docker did not run) and stdout. */
export type PreviewHandoverDocker = (
  args: string[],
  opts: { timeoutMs: number },
) => { status: number | null; stdout: string };

/** The user-defined networks of the running Twenty server container, sorted, or null when it does not run. */
export declare function readTwentyServerNetworks(docker: PreviewHandoverDocker): string[] | null;

/** The CLI's declarer entry point (cinatra.devCliModules["preview-host-handover"]). */
export declare function previewHostHandover(opts?: {
  log?: (line: string) => void;
  docker?: PreviewHandoverDocker;
}): Promise<{
  env?: Record<string, string>;
  forwards?: Array<{ port: number; network: string; target: string }>;
}>;
