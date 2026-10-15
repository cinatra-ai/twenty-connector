// Type declarations for src/twenty-schema-provision.mjs (dependency-free, shared
// by the dev-setup hook and the bootstrap proof). Keep in lockstep with the .mjs.

import type { MakeError, ToolCallResult } from "./twenty-tool-contract.mjs";

export type SendTool = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
export type ReadToolResult = (toolName: string, args: Record<string, unknown>, result: unknown) => unknown;

export declare function mcpToolSender(opts: {
  mcpUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  makeError?: MakeError;
}): (toolName: string, args: Record<string, unknown>) => Promise<ToolCallResult>;

export type ProvisionOutcome = { created: string[]; existing: string[]; conflicts: string[] };

export declare function provisionConnectorFields(opts: {
  send: SendTool;
  read?: ReadToolResult;
  makeError?: MakeError;
}): Promise<ProvisionOutcome>;
