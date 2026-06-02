// Public surface for @cinatra-ai/twenty-connector.

import { registerCrmProvider } from "@cinatra-ai/sdk-extensions";
import { twentyConnector } from "./twenty-connector";

export { twentyConnector } from "./twenty-connector";
export { registerTwentyConnectorPrimitives } from "./mcp/module";
export type { TwentyApiKeyConfig } from "./api-key-store";

/**
 * Boot-time entry point. Registers the Twenty provider with the
 * crm-connector facade so `lookupCrmProvider("twenty")` resolves.
 * Idempotent.
 */
export function registerTwentyProvider(): void {
  registerCrmProvider(twentyConnector);
}
