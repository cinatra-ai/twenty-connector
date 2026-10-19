import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The transport of src/twenty-mcp-call.ts against an event-stream answer.
// Twenty can send a `notifications/progress` frame before the JSON-RPC
// response frame; the transport must return the frame that answers its own
// request id, and skip notifications and answers to other ids.

import {
  registerTwentyConnector,
  _resetTwentyDepsForTests,
  type ExternalMcpServerRecordShape,
  type TwentyConnectorHostDeps,
} from "../deps";
import { executeTwentyMcpTool, TwentyMcpError } from "../twenty-mcp-call";

const ROW: ExternalMcpServerRecordShape = {
  id: "twenty-workspace",
  label: "Twenty",
  serverUrl: "http://twenty.test/mcp",
  nangoConnectionId: null,
  scope: "workspace",
  orgId: null,
  userId: null,
  enabled: true,
  allowedTools: null,
  allowedCatalogTools: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function registerDeps() {
  const deps = {
    getServerById: (id: string) => (id === ROW.id ? ROW : null),
    listServers: () => [ROW],
    resolveBearer: async () => null,
  } as unknown as TwentyConnectorHostDeps;
  registerTwentyConnector(deps);
}

/** Answer the next fetch with an event stream; each frame is built from the request's own id. */
function answerWithFrames(frames: (requestId: string) => unknown[]) {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const requestId = JSON.parse(init.body).id as string;
    const body = frames(requestId)
      .map((f) => `event: message\ndata: ${JSON.stringify(f)}\n\n`)
      .join("");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const progress = { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1, progressToken: "t" } };
const okResult = { content: [{ type: "text", text: JSON.stringify({ ok: true }) }], isError: false };

beforeEach(() => {
  _resetTwentyDepsForTests();
  registerDeps();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetTwentyDepsForTests();
});

describe("executeTwentyMcpTool reads an event-stream answer", () => {
  it("returns the result frame that follows a progress frame", async () => {
    answerWithFrames((id) => [progress, { jsonrpc: "2.0", id, result: okResult }]);
    await expect(executeTwentyMcpTool("get_object_metadata", { limit: 100 })).resolves.toEqual(okResult);
  });

  it("surfaces the error frame's code that follows a progress frame", async () => {
    answerWithFrames((id) => [progress, { jsonrpc: "2.0", id, error: { code: -32602, message: "bad params" } }]);
    const err = await executeTwentyMcpTool("get_object_metadata", { limit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(TwentyMcpError);
    expect((err as TwentyMcpError).code).toBe(-32602);
    expect((err as TwentyMcpError).message).toBe("bad params");
  });

  it("still reads a single-frame answer", async () => {
    answerWithFrames((id) => [{ jsonrpc: "2.0", id, result: okResult }]);
    await expect(executeTwentyMcpTool("get_object_metadata", { limit: 100 })).resolves.toEqual(okResult);
  });

  it("skips a frame that answers a different id", async () => {
    const other = { content: [{ type: "text", text: JSON.stringify({ other: true }) }], isError: false };
    answerWithFrames((id) => [
      { jsonrpc: "2.0", id: `${id}-other`, result: other },
      { jsonrpc: "2.0", id, result: okResult },
    ]);
    await expect(executeTwentyMcpTool("get_object_metadata", { limit: 100 })).resolves.toEqual(okResult);
  });

  it("keeps the no-result error when only notifications arrive", async () => {
    answerWithFrames(() => [progress]);
    const err = await executeTwentyMcpTool("get_object_metadata", { limit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(TwentyMcpError);
    expect((err as TwentyMcpError).code).toBe(-32603);
    expect((err as TwentyMcpError).message).toBe("upstream returned no result");
  });
});
