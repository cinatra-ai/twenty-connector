// cinatra#1097 regression — the setup page's form actions are CONNECTOR-LOCAL
// "use server" exports (the apify/github pattern), never the deps-slot
// instances.
//
// THE FAILING STATE THIS PINS AGAINST: the host boot publishes the
// connect/disconnect implementations through the capability registry and the
// connector captures them into its deps slot at activation. Other host bundle
// graphs (e.g. the chat route) re-evaluate the registrar and RE-PUBLISH,
// REPLACING the registry instances — so any reflection applied to the
// registry's CURRENT instance (the host's setup-action bridge) never reaches
// a stale captured instance, which then crosses to React's serializer
// UNMARKED and 500s the page ("Functions cannot be passed directly to Client
// Components…"). Binding compiler-minted references from a connector-local
// `"use server"` module — part of the SAME route graph that renders the page —
// removes the reflection/capture-order dependency entirely.
//
// A unit runtime has no Next compiler, so the transform itself cannot mint
// `$$id` here; what IS assertable at this level (and is exactly what broke):
//   1. ./actions is a genuine server-action module — its FIRST statement is
//      the `"use server"` directive, so ANY route graph importing it gets
//      compiler-minted reference exports.
//   2. The setup impl binds THOSE exports into `<form action={…}>` — and
//      never binds a deps-slot member into a form action.
//   3. The actions forward to the deps-slot implementations at invocation
//      time (lazy — resolved per call, never captured at module load).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import {
  saveTwentyConnectionAction,
  disconnectTwentyConnectionAction,
} from "../actions";
import { registerTwentyConnector, _resetTwentyDepsForTests } from "../deps";
import type { TwentyConnectorHostDeps } from "../deps";

const SRC = path.join(__dirname, "..");

beforeEach(() => {
  _resetTwentyDepsForTests();
});

describe("connector-local setup actions (cinatra#1097)", () => {
  it("./actions is a server-action module: the FIRST statement is the \"use server\" directive", () => {
    const source = readFileSync(path.join(SRC, "actions.ts"), "utf-8");
    expect(source.startsWith(`"use server";`)).toBe(true);
  });

  it("the setup impl binds the connector-local actions into <form action> — never a deps-slot member", () => {
    const source = readFileSync(path.join(SRC, "twenty-setup-impl.tsx"), "utf-8");
    // The two forms bind the local "use server" exports…
    expect(source).toContain(`from "./actions"`);
    expect(source).toContain("<form action={saveTwentyConnectionAction}");
    expect(source).toContain("<form action={disconnectTwentyConnectionAction}");
    // …and no form binds a deps-slot instance (the #1097 unmarked crossing).
    expect(source).not.toContain("action={deps.saveTwentyConnectionAction}");
    expect(source).not.toContain("action={deps.disconnectTwentyConnectionAction}");
  });

  it("actions forward to the deps-slot host implementations at INVOCATION time (no capture at import)", async () => {
    // The actions module was imported at the top of this file while the slot
    // was empty — a load-time capture would have thrown or bound undefined.
    const save = vi.fn(async () => {});
    const disconnect = vi.fn(async () => {});
    registerTwentyConnector({
      saveTwentyConnectionAction: save,
      disconnectTwentyConnectionAction: disconnect,
    } as unknown as TwentyConnectorHostDeps);

    const saveFd = new FormData();
    await saveTwentyConnectionAction(saveFd);
    expect(save).toHaveBeenCalledWith(saveFd);

    const disconnectFd = new FormData();
    await disconnectTwentyConnectionAction(disconnectFd);
    expect(disconnect).toHaveBeenCalledWith(disconnectFd);
  });

  it("an unbound deps slot fails LOUD at invocation (not silently at render)", async () => {
    await expect(saveTwentyConnectionAction(new FormData())).rejects.toThrow(
      /host runtime deps not registered/,
    );
  });
});
