// DELIBERATELY WRONG. This file exists only so that this repository's
// extension-conformance-gate is on record refusing it. Never merged.
import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";

export function redRunCanary(ctx: ExtensionHostContext): unknown {
  return ctx.capabilities.resolveProviders("@cinatra-ai/host:blog-routing")[0]?.impl;
}
