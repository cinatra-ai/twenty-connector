import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The transport of src/twenty-mcp-call.ts against an event-stream answer.
// Twenty can send a `notifications/progress` frame before the JSON-RPC
// response frame; the transport must return the frame that answers its own
// request id, and skip notifications and answers to other ids. An event whose
// data is not JSON fails the call with the parse error, and the `data:` lines
// of one event are joined into one frame. The conformance table reads fields
// by the event-stream rules (line ends, comments, field names, the one
// optional space) from a body that arrives in chunks, and an answer on a
// stream that stays open is returned and the stream cancelled.

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

/** Answer the next fetch with a raw event-stream body built from the request's own id. */
function answerWithBody(body: (requestId: string) => string) {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const requestId = JSON.parse(init.body).id as string;
    return new Response(body(requestId), { status: 200, headers: { "content-type": "text/event-stream" } });
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

  it("rejects an event whose data is not JSON with the parse error", async () => {
    answerWithBody(() => "event: message\ndata: {not json\n\n");
    const err = await executeTwentyMcpTool("get_object_metadata", { limit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(SyntaxError);
  });

  it("rejects an event whose data is not JSON even when an answer frame follows", async () => {
    answerWithBody(
      (id) =>
        `event: message\ndata: {not json\n\n` +
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: okResult })}\n\n`,
    );
    const err = await executeTwentyMcpTool("get_object_metadata", { limit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(SyntaxError);
  });

  it("joins the data lines of one event into one frame and selects it by id", async () => {
    answerWithBody(
      (id) =>
        `event: message\ndata: ${JSON.stringify(progress)}\n\n` +
        `event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":${JSON.stringify(id)},"result":${JSON.stringify(okResult)}}\n\n`,
    );
    await expect(executeTwentyMcpTool("get_object_metadata", { limit: 100 })).resolves.toEqual(okResult);
  });

  it("reads a last event that has no closing blank line", async () => {
    answerWithBody(
      (id) =>
        `event: message\ndata: ${JSON.stringify(progress)}\n\n` +
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: okResult })}`,
    );
    await expect(executeTwentyMcpTool("get_object_metadata", { limit: 100 })).resolves.toEqual(okResult);
  });

  it("keeps the no-data error for an event-stream answer without a body", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const err = await executeTwentyMcpTool("get_object_metadata", { limit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(TwentyMcpError);
    expect((err as TwentyMcpError).code).toBe(-32603);
    expect((err as TwentyMcpError).message).toBe("no SSE data line in upstream response");
  });
});

type Chunk = string | Uint8Array;

type Outcome =
  | { resolved: unknown }
  | { rejected: string; code?: number; message?: string }
  | "still pending";

type ConformanceCase = {
  name: string;
  /** The body in the pieces it arrives in, built from the request's own id. */
  chunks: (requestId: string) => Chunk[];
  /** The stream stays open after the last chunk. */
  open?: boolean;
  expected: Outcome;
};

const encoder = new TextEncoder();

/** A result frame for `requestId` whose structured content names `chosen`. */
function frame(requestId: string, chosen: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { structuredContent: { chosen } } });
}

/** A body given with the literal request id "REQ", sent with the request's own id. */
function withId(body: string, requestId: string): string {
  return body.split('"REQ"').join(JSON.stringify(requestId));
}

/** `text` as UTF-8 bytes, cut at byte `at`. */
function splitBytes(text: string, at: number): Uint8Array[] {
  const bytes = encoder.encode(text);
  return [bytes.slice(0, at), bytes.slice(at)];
}

const chosen = (value: string): Outcome => ({ resolved: { structuredContent: { chosen: value } } });
const syntaxError: Outcome = { rejected: "SyntaxError" };

const CONFORMANCE: ConformanceCase[] = [
  {
    name: "ignores a field whose name has a leading space",
    chunks: (id) => [
      withId(
        ' data: {"jsonrpc":"2.0","id":"REQ","result":{"structuredContent":{"chosen":"wrong"}}}\n\n' +
          'data: {"jsonrpc":"2.0","id":"REQ","result":{"structuredContent":{"chosen":"right"}}}\n\n',
        id,
      ),
    ],
    expected: chosen("right"),
  },
  {
    name: "rejects an event whose data is empty from a bare data line",
    chunks: (id) => [withId('data\n\ndata: {"jsonrpc":"2.0","id":"REQ","result":{}}\n\n', id)],
    expected: syntaxError,
  },
  {
    name: "reads a data field without a space after the colon",
    chunks: (id) => [`data:${frame(id, "right")}\n\n`],
    expected: chosen("right"),
  },
  {
    name: "removes one optional space only",
    chunks: (id) => [`data:  ${frame(id, "right")}\n\n`],
    expected: chosen("right"),
  },
  {
    name: "trims nothing else from a value",
    chunks: (id) => [`data: \u00a0${frame(id, "wrong")}\n\n`, `data: ${frame(id, "right")}\n\n`],
    expected: syntaxError,
  },
  {
    name: "reads CRLF line ends",
    chunks: (id) => [`event: message\r\ndata: ${frame(id, "right")}\r\n\r\n`],
    expected: chosen("right"),
  },
  {
    name: "reads lone CR line ends",
    chunks: (id) => [`event: message\rdata: ${frame(id, "right")}\r\r`],
    expected: chosen("right"),
  },
  {
    name: "reads a CRLF split across two chunks as one line end",
    chunks: (id) => [
      `data: {"jsonrpc":"2.0",\r`,
      `\ndata: "id":${JSON.stringify(id)},"result":{"structuredContent":{"chosen":"right"}}}\r\n\r\n`,
    ],
    expected: chosen("right"),
  },
  {
    name: "ignores a comment line",
    chunks: (id) => [`: ping\n:data: ${frame(id, "wrong")}\ndata: ${frame(id, "right")}\n\n`],
    expected: chosen("right"),
  },
  {
    name: "ignores event, id and retry lines for the selection",
    chunks: (id) => [
      `event: message\nid: ${id}\nretry: 1000\ndata: ${frame(`${id}-other`, "wrong")}\n\n` +
        `event: other\nid: 7\ndata: ${frame(id, "right")}\n\n`,
    ],
    expected: chosen("right"),
  },
  {
    name: "dispatches nothing for an event without a data field",
    chunks: (id) => [`event: message\nid: 1\n\ndata: ${frame(id, "right")}\n\n`],
    expected: chosen("right"),
  },
  {
    name: "joins the data lines of one event with LF",
    chunks: (id) => [
      `data: {"jsonrpc":"2.0","id":${JSON.stringify(id)},\ndata: "result":{"structuredContent":{"chosen":"right"}}}\n\n`,
    ],
    expected: chosen("right"),
  },
  {
    name: "reads an event split across chunks",
    chunks: (id) => {
      const body = `event: message\ndata: ${frame(id, "right")}\n\n`;
      return [body.slice(0, 3), body.slice(3, 17), body.slice(17, 40), body.slice(40, -1), body.slice(-1)];
    },
    expected: chosen("right"),
  },
  {
    name: "decodes a character split across chunks",
    chunks: (id) => {
      const body = `data: ${frame(id, "r\u00efght")}\n\n`;
      return splitBytes(body, encoder.encode(body.slice(0, body.indexOf("\u00ef"))).length + 1);
    },
    expected: chosen("r\u00efght"),
  },
  {
    name: "keeps the no-data error for a stream of comments",
    chunks: () => [": ping\n\n"],
    expected: { rejected: "TwentyMcpError", code: -32603, message: "no SSE data line in upstream response" },
  },
  {
    name: "returns the answer on a stream that stays open",
    chunks: (id) => [`event: message\ndata: ${JSON.stringify(progress)}\n\n`, `data: ${frame(id, "right")}\n\n`],
    open: true,
    expected: chosen("right"),
  },
  {
    name: "rejects a malformed event on a stream that stays open",
    chunks: () => ["data: {not json\n\n"],
    open: true,
    expected: syntaxError,
  },
];

/** Answer the next fetch with a streamed event-stream body; the spy records a cancel of the stream. */
function answerWithStream(chunks: (requestId: string) => Chunk[], open: boolean) {
  const cancel = vi.fn();
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const requestId = JSON.parse(init.body).id as string;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks(requestId)) controller.enqueue(typeof c === "string" ? encoder.encode(c) : c);
        if (!open) controller.close();
      },
      cancel,
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return cancel;
}

/** How the call settled within `ms`. */
async function settle(call: Promise<unknown>, ms = 1000): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve("still pending"), ms);
  });
  const settled = call.then(
    (value): Outcome => ({ resolved: value }),
    (err: unknown): Outcome =>
      err instanceof TwentyMcpError
        ? { rejected: "TwentyMcpError", code: err.code, message: err.message }
        : { rejected: err instanceof SyntaxError ? "SyntaxError" : String(err) },
  );
  try {
    return await Promise.race([settled, pending]);
  } finally {
    clearTimeout(timer);
  }
}

describe("executeTwentyMcpTool reads event-stream fields by the event-stream rules", () => {
  for (const c of CONFORMANCE) {
    it(c.name, async () => {
      const cancel = answerWithStream(c.chunks, c.open ?? false);
      const outcome = await settle(executeTwentyMcpTool("get_object_metadata", { limit: 100 }));
      expect(outcome).toEqual(c.expected);
      if (c.open) expect(cancel).toHaveBeenCalled();
    });
  }
});
