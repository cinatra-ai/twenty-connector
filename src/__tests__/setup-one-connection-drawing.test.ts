// Pins for the setup page's "One connection" drawing (design/specs/
// app-connectors.html section II, "One connection"):
//
//   "The two actions sit side by side, never stacked - an icon-led Connect
//    (indigo primary, the joined plug from the Connected badge) and Disconnect
//    (destructive, red-on-tint, the unplug from the Disconnected badge)"
//   "Disconnect is disabled until the connector is connected - there is
//    nothing to disconnect otherwise."
//   "The right Connection status card ... carries the status badge with both
//    icon and label plus the Check action beneath it."
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

  it("Disconnect is a destructive unplug-led button disabled while not connected", () => {
    const disconnect = buttonLabelled(/^\s*Disconnect\s*$/);
    expect(disconnect).toContain('variant="destructive"');
    expect(disconnect).toContain("disabled={!connected}");
    expect(disconnect).toMatch(/>\s*<Unplug aria-hidden="true" \/>\s*Disconnect\s*<\/Button>/);
  });

  it("Disconnect is drawn regardless of state (not only inside a connected-only branch)", () => {
    // The button submits the separate disconnect form by id, so it can sit in
    // the connect form's row without nesting forms.
    const disconnect = buttonLabelled(/^\s*Disconnect\s*$/);
    expect(disconnect).toContain('form="twenty-disconnect"');
    expect(flat).toMatch(/<form action=\{disconnectTwentyConnectionAction\} id="twenty-disconnect"/);
  });
});

describe("setup page - Connection status card carries Check beneath the badge", () => {
  it("renders a Check action after the status badge inside the card", () => {
    const card = flat.slice(flat.indexOf("Connection status </div>"));
    const badgeIdx = card.indexOf("<ConnectionStatusBadge");
    const checkIdx = card.search(/>\s*Check\s*<\/Button>/);
    expect(badgeIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(badgeIdx);
  });

  it("Check is an outline, refresh-led, full-width button", () => {
    const check = buttonLabelled(/^\s*Check\s*$/);
    expect(check).toContain('variant="outline"');
    expect(check).toContain("w-full");
    expect(check).toMatch(/>\s*<RefreshCw aria-hidden="true" \/>\s*Check\s*<\/Button>/);
  });

  it("Check re-reads the status by re-requesting this page (a plain GET of the same route; no new server API)", () => {
    expect(flat).toMatch(/<form method="get"[^>]*>\s*<Button type="submit" variant="outline"[^>]*>\s*<RefreshCw aria-hidden="true" \/>\s*Check\s*<\/Button>\s*<\/form>/);
    // The page's status read is the workspace row, read on every render.
    expect(src).toContain("deps.getServerById(TWENTY_WORKSPACE_ROW_ID)");
  });
});
