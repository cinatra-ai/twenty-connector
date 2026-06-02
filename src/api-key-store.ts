import "server-only";

// Twenty API-key bearer storage.
//
// Twenty's OAuth supports only `authorization_code` + `refresh_token`,
// NOT `client_credentials`. Server-to-server automation uses an API key (a
// JWT-encoded bearer) minted via Twenty's dev/test-only CLI
// `workspace:generate-api-key`. cinatra stores that bearer encrypted-at-rest
// using the same `connector_config` envelope WordPress + Drupal already use
// for their API keys.
//
// This module ships the shape; the actual encrypt + decrypt against the
// connector_config row is not yet wired.

export type TwentyApiKeyConfig = {
  /** External MCP server row id this key belongs to (e.g. `twenty-apple`) */
  serverId: string;
  /** The encrypted bearer JWT — opaque to callers; only decryptApiKey reads it. */
  encryptedApiKey: string;
  /** Twenty workspace id this key was minted against (e.g. SEED_APPLE_WORKSPACE_ID) */
  workspaceId: string;
  /** Human-readable name the key was minted with */
  name: string;
  /** ISO timestamp of mint */
  mintedAt: string;
};

/**
 * Persist an encrypted bearer for the given server row.
 *
 * Currently throws "not implemented"; the full path through the existing
 * `connector_config` encryption envelope (mirrors wordpress-connector +
 * drupal-connector patterns) is not yet wired.
 */
export async function persistTwentyApiKey(_config: TwentyApiKeyConfig): Promise<void> {
  throw new Error(
    "twenty-connector.persistTwentyApiKey: skeleton — not yet implemented",
  );
}

/**
 * Decrypt + return the bearer for the given server row, or null if no key is
 * persisted. The bearer is only ever returned for in-process consumers (the
 * Layer B proxy in `src/lib/external-mcp/twenty-execute-tool-proxy.ts`); it
 * MUST NOT cross any wire boundary.
 */
export async function loadTwentyApiKey(_serverId: string): Promise<string | null> {
  throw new Error(
    "twenty-connector.loadTwentyApiKey: skeleton — not yet implemented",
  );
}
