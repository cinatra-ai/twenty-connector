// Pins for the setup page's "One connection" drawing (design/specs/
// app-connectors.html section II, "One connection"):
//
//   "The two actions sit side by side, never stacked - an icon-led Connect
//    (indigo primary, the joined plug from the Connected badge) and Disconnect
//    (destructive, red-on-tint, the unplug from the Disconnected badge)"
//   "Disconnect is disabled until the connector is connected - there is
//    nothing to disconnect otherwise."
//   "Disconnecting is destructive, so it opens an AlertDialog on the --paper
//    ground with a strong hairline header rule - a Cancel outline beside the
//    red Disconnect confirm (same unplug icon) - never a bare browser prompt;
//    its copy stays connector-neutral."
//   "The right Connection status card ... carries the status badge with both
//    icon and label plus the Check action beneath it."
//   "Pressing Check replaces the current badge with the indigo Checking...
//    badge - its icon spinning - until the probe resolves, then swaps to
//    Connected or Disconnected."
//
// Like the sibling setup-page-tabs pins, these assert against the AUTHORED
// SOURCE of ../twenty-setup-impl.tsx: the sdk-ui / design-primitives modules
// the page renders with are host-provided and do not resolve in this
// package's plain-node vitest sandbox.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("../twenty-setup-impl.tsx", import.meta.url)),
  "utf8",
);
const flat = src.replace(/\s+/g, " ");

// The Connection status card's badge + Check live in a client island (the
// Checking state is client state); it sits beside the page.
const STATUS_ISLAND = "../twenty-connection-status.tsx";
function islandSource(): string {
  return readFileSync(fileURLToPath(new URL(STATUS_ISLAND, import.meta.url)), "utf8");
}

/** Every <Button ...>...</Button> element in source order, whitespace-collapsed. */
function buttons(): string[] {
  return flat.match(/<Button\b[^>]*>.*?<\/Button>/g) ?? [];
}

function buttonLabelled(label: RegExp): string {
  const hit = buttons().find((b) => label.test(b.split(/<[^>]*>/).join("")));
  if (!hit) throw new Error(`no <Button> labelled ${label}`);
  return hit;
}

/** The admin connect form's action row: the flex row that holds Connect. */
function actionRow(): string {
  const m = flat.match(/<div className="flex[^"]*">\s*<Button type="submit" disabled=\{!connectionServiceReady\}.*?<\/div>/);
  if (!m) throw new Error("no action row holding the Connect submit button");
  return m[0];
}

describe("setup page - icon-led Connect (joined plug)", () => {
  it("imports the shared joined-plug glyph from the sdk-ui icons subpath (no local re-draw)", () => {
    expect(src).toContain('import { PlugConnected } from "@cinatra-ai/sdk-ui/icons";');
  });

  it("the Connect submit button leads with the PlugConnected glyph", () => {
    const connect = buttonLabelled(/Connect Twenty/);
    expect(connect).toMatch(/<Button type="submit"[^>]*>\s*<PlugConnected aria-hidden="true" \/>/);
  });
});

describe("setup page - Disconnect beside Connect, disabled until connected", () => {
  it("draws Disconnect in the same action row as Connect, after it (side by side)", () => {
    const row = actionRow();
    expect(row).toContain("Disconnect");
    expect(row.indexOf("Connect Twenty")).toBeLessThan(row.indexOf("Disconnect"));
  });

  it("the action row never stacks: an explicit flex-nowrap row whose every class is a plain row class (no wrap, column, variant, important or arbitrary form)", () => {
    const cls = actionRow().match(/^<div className="([^"]*)">/);
    expect(cls === null).toBe(false);
    const tokens = (cls as RegExpMatchArray)[1].split(" ").filter(Boolean);
    expect(tokens).toContain("flex");
    expect(tokens).toContain("flex-nowrap");
    // An allow-list, not a deny-list: a variant prefix (sm:), an important
    // modifier (!flex-col, flex-wrap!) or an arbitrary property
    // ([flex-direction:column]) can each re-stack the row, so every class must
    // be one of these plain, unprefixed row classes.
    for (const t of tokens) {
      expect(t).toMatch(/^(flex|flex-nowrap|items-(start|center|end|baseline|stretch)|justify-(start|center|end|between)|gap-(x-)?[0-9]+(\.5)?)$/);
    }
  });

  it("the row holds Connect and then the Disconnect dialog directly, under no condition", () => {
    const row = actionRow();
    expect(row).toMatch(/ : "Connect Twenty"\} <\/Button> <AlertDialog> <AlertDialogTrigger asChild>/);
    expect(row.endsWith("</AlertDialogContent> </AlertDialog> </div>")).toBe(true);
  });

  it("Disconnect is a destructive unplug-led button disabled while not connected", () => {
    const disconnect = buttonLabelled(/^\s*Disconnect\s*$/);
    expect(disconnect).toContain('variant="destructive"');
    expect(disconnect).toContain("disabled={!connected}");
    expect(disconnect).toMatch(/>\s*<Unplug aria-hidden="true" \/>\s*Disconnect\s*<\/Button>/);
  });

  it("Disconnect is drawn regardless of state (not only inside a connected-only branch)", () => {
    const row = actionRow();
    expect(row).toContain("<AlertDialogTrigger asChild>");
    expect(flat).not.toMatch(/\{connected \? \(?\s*<AlertDialog>/);
  });
});

describe("setup page - Disconnect confirms through the host AlertDialog", () => {
  it("imports the AlertDialog family from the host-shared primitives (no local copy)", () => {
    const imp = flat.match(/import \{([^}]*)\} from "@cinatra-ai\/design-primitives";/);
    expect(imp === null).toBe(false);
    for (const name of [
      "AlertDialog",
      "AlertDialogTrigger",
      "AlertDialogContent",
      "AlertDialogHeader",
      "AlertDialogTitle",
      "AlertDialogDescription",
      "AlertDialogFooter",
      "AlertDialogCancel",
    ]) {
      expect((imp as RegExpMatchArray)[1]).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("the row's Disconnect only opens the dialog: it is the AlertDialog trigger and submits nothing", () => {
    const row = actionRow();
    expect(row).toMatch(
      /<AlertDialog> <AlertDialogTrigger asChild> <Button type="button" variant="destructive" disabled=\{!connected\}> <Unplug aria-hidden="true" \/> Disconnect <\/Button> <\/AlertDialogTrigger>/,
    );
    // No direct submit of the disconnect action from the row (the bare road).
    expect(flat).not.toContain('form="twenty-disconnect"');
    expect(flat).not.toContain('id="twenty-disconnect"');
  });

  it("the dialog carries the drawing's connector-neutral copy", () => {
    expect(flat).toContain("<AlertDialogTitle>Disconnect connector?</AlertDialogTitle>");
    expect(flat).toContain(
      "<AlertDialogDescription> Disconnect this connector and remove its saved configuration? It will stop working until you connect it again. </AlertDialogDescription>",
    );
  });

  it("Cancel (outline) sits beside the red, unplug-led Disconnect confirm, which alone submits the disconnect action", () => {
    const content = flat.slice(flat.indexOf("<AlertDialogContent"), flat.indexOf("</AlertDialogContent>"));
    expect(content).toMatch(
      /<form action=\{disconnectTwentyConnectionAction\}> <AlertDialogFooter> <AlertDialogCancel>Cancel<\/AlertDialogCancel> <Button type="submit" variant="destructive"> <Unplug aria-hidden="true" \/> Disconnect <\/Button> <\/AlertDialogFooter> <\/form>/,
    );
    // The disconnect action is bound exactly once, inside the dialog.
    expect(flat.split("action={disconnectTwentyConnectionAction}").length - 1).toBe(1);
    expect(flat.indexOf("action={disconnectTwentyConnectionAction}")).toBeGreaterThan(flat.indexOf("<AlertDialogContent"));
  });

  it("never falls back to a bare browser prompt", () => {
    expect(src).not.toMatch(/\bconfirm\(/);
    expect(src).not.toMatch(/window\.confirm/);
  });
});

describe("setup page - Connection status card carries Check beneath the badge", () => {
  it("the card renders the status island (badge + Check) beneath its heading, seeded with the read status and keyed by it", () => {
    const card = flat.slice(flat.indexOf("Connection status </div>"));
    expect(card).toMatch(/^Connection status <\/div> <div className="mt-3\.5"> <TwentyConnectionStatus key=\{settledStatus\} initialStatus=\{settledStatus\} \/> <\/div>/);
    expect(src).toContain('import { TwentyConnectionStatus } from "./twenty-connection-status";');
  });

  it("the island draws the shared badge, then Check beneath it", () => {
    const island = islandSource().replace(/\s+/g, " ");
    const badgeIdx = island.indexOf("<ConnectionStatusBadge status={status} />");
    const checkIdx = island.search(/>\s*Check\s*<\/Button>/);
    expect(badgeIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(badgeIdx);
  });

  it("Check is an outline, refresh-led, full-width button", () => {
    const island = islandSource().replace(/\s+/g, " ");
    const check = (island.match(/<Button\b[^>]*>.*?<\/Button>/g) ?? []).find((b) => /^\s*Check\s*$/.test(b.split(/<[^>]*>/).join("")));
    expect(typeof check).toBe("string");
    expect(check as string).toContain('variant="outline"');
    expect(check as string).toContain("w-full");
    expect(check as string).toMatch(/>\s*<RefreshCw aria-hidden="true" \/>\s*Check\s*<\/Button>/);
  });

  it("the page no longer reloads itself for Check (no plain GET form)", () => {
    expect(flat).not.toMatch(/<form method="get"/);
  });

  it("the page's status read is still the workspace row, read on every render", () => {
    expect(src).toContain("deps.getServerById(TWENTY_WORKSPACE_ROW_ID)");
  });
});
