"use server";

// Connector-LOCAL server actions for the Twenty setup page (cinatra#1097).
//
// The setup page previously bound the host's boot-published action instances
// (deps.saveTwentyConnectionAction) DIRECTLY into `<form action={…}>` and
// relied on the host's RSC-layer reflection bridge
// (src/lib/connector-setup-action-references.server.ts, twenty-connector#39)
// to stamp the compiler-minted server-reference metadata onto them. That
// bridge decorates whatever instance the capability registry holds at the
// bridge's (one-shot) module evaluation — but the host re-publishes the
// service from other bundle graphs (e.g. the chat route's registrar import),
// REPLACING the registry instance after the connector captured the boot
// instance into its deps slot. Captured-but-undecorated instances then reach
// React's serializer unmarked and the page 500s ("Functions cannot be passed
// directly to Client Components…", cinatra#1097; previously surfaced as the
// cinatra#1068 redefine TypeError before the bridge's idempotency guard).
//
// This module is the apify/github pattern the bridge header blesses as its
// retirement path: the forms bind THESE exports — genuine `"use server"`
// references minted by the compiler in the SAME route graph that renders the
// page — and each action resolves the host implementation through the deps
// slot AT INVOCATION time, so no reflection and no capture-order dependency
// remain. "use server" actions compile into separately-compiled bundles and
// CANNOT close over the render-time deps, hence the globalThis-anchored slot
// (same reason as the github-connector actions).
//
// AUTHZ: unchanged. These wrappers add NO behavior — the host action they
// forward to owns the FULL authorization boundary (platform-admin gate, URL
// guard, live key probe, Nango import, row writes, redirects; see the host's
// `@/app/campaigns/actions`). A `redirect()` thrown inside the host action
// propagates through the await unchanged.

import { getTwentyDeps } from "./deps";
import { isTwentyWorkspaceConnected } from "./connection-check";
import { TWENTY_WORKSPACE_ROW_ID } from "./twenty-mcp-call";

/** Connect/re-connect the instance-global Twenty workspace (form POST). */
export async function saveTwentyConnectionAction(formData: FormData): Promise<void> {
  await getTwentyDeps().saveTwentyConnectionAction(formData);
}

/** Disconnect: remove the workspace row + the bound Nango connection (form POST). */
export async function disconnectTwentyConnectionAction(formData: FormData): Promise<void> {
  await getTwentyDeps().disconnectTwentyConnectionAction(formData);
}

/**
 * Check: the Connection status card's probe. Re-reads the workspace row at
 * call time and answers the same connected reading the page renders from. It
 * resolves the viewer first, as the page does, and returns only the status
 * (no URL, no key, no row fields).
 */
export async function checkTwentyConnectionAction(): Promise<"connected" | "disconnected"> {
  const deps = getTwentyDeps();
  await deps.resolveViewerContext();
  return isTwentyWorkspaceConnected(deps.getServerById(TWENTY_WORKSPACE_ROW_ID))
    ? "connected"
    : "disconnected";
}
