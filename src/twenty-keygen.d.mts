// Type declarations for the dependency-free keygen helpers (src/twenty-keygen.mjs)
// so the TS dev-setup hook consumes them typed. Keep in lockstep with the .mjs.

export declare const SEED_APPLE_WORKSPACE_ID: string;

/** Args for the idempotent Apple-workspace seed (`workspace:seed:dev --light`). */
export declare function buildSeedDevArgs(): string[];

/** Args for minting a workspace API key (`workspace:generate-api-key`). */
export declare function buildGenerateApiKeyArgs(opts: {
  workspaceId?: string;
  keyName: string;
  expireDays?: number | null;
}): string[];

/** Extract the first JWT-shaped token from command output, or null. */
export declare function parseTwentyApiKey(text: unknown): string | null;

/** Tri-state authenticated-REST bearer probe (ok / unauthorized / unreachable). */
export declare function probeTwentyBearer(opts: {
  baseUrl: string;
  apiKey: string | null | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<"ok" | "unauthorized" | "unreachable">;
