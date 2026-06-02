import "server-only";

import type { ExtensionMcpToolServer } from "@cinatra-ai/sdk-extensions";
import { z } from "zod";

import { twentyStatusHandler, twentyInstancesListHandler } from "./handlers";

const EmptySchema = z.object({});

function jsonResult<T>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as unknown as Record<string, unknown>,
  };
}

/**
 * Twenty provider MCP module. Registers two
 * provider-specific primitives parallel to the wordpress/drupal patterns.
 */
export function registerTwentyConnectorPrimitives(server: ExtensionMcpToolServer): void {
  server.registerTool(
    "twenty_status",
    {
      title: "twenty_status",
      description:
        "Report Twenty CRM connector health (instance reachability + bootstrap status). Parallel to wordpress_status / drupal_status.",
      inputSchema: EmptySchema,
    },
    async () => jsonResult(await twentyStatusHandler()),
  );

  server.registerTool(
    "twenty_instances_list",
    {
      title: "twenty_instances_list",
      description:
        "List configured Twenty CRM connector instances. Parallel to wordpress_instances_list / drupal_instances_list. Multiple instances are supported per cinatra's connector-instance surface.",
      inputSchema: EmptySchema,
    },
    async () => jsonResult(await twentyInstancesListHandler()),
  );
}

export function createTwentyConnectorModule() {
  return {
    registerCapabilities: registerTwentyConnectorPrimitives,
  };
}
