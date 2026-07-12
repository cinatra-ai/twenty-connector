// Regression pins for the tabbed setup page (twenty-connector#57, epic
// cinatra-ai/cinatra#1101 connector-setup-tabs rollout).
//
// The setup page is an async server component composed from
// `@cinatra-ai/sdk-ui/*` primitives that this connector package does not
// resolve in isolation (host-provided at build time; the repo's vitest
// environment is plain "node" with no react-dom/jsdom — see
// vitest.config.ts). Matching the sibling connectors' pattern (e.g.
// google-calendar-connector's setup-page-review.test.ts), these pins assert
// against the AUTHORED SOURCE of ../twenty-setup-impl.tsx: the file text is
// the closest artifact this sandbox can exercise, and each assertion maps
// 1:1 to one acceptance item on #57 so a regression names the exact ask.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("../twenty-setup-impl.tsx", import.meta.url)),
  "utf8",
);

// Collapse insignificant JSX whitespace so multi-line elements match as text.
const flat = src.replace(/\s+/g, " ");

// Pull the value= of every <TabsTrigger> in source order, the same order the
// rendered <TabsListRow> will emit them (JSX renders top-to-bottom).
function tabTriggerOrder(): string[] {
  const re = /<TabsTrigger\s+value="([^"]+)"/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function tabsContentBlock(value: string): string {
  const re = new RegExp(
    `<TabsContent\\s+value="${value}"[\\s\\S]*?(?=<TabsContent\\s+value="|</Tabs>)`,
  );
  const m = src.match(re);
  if (!m) throw new Error(`no TabsContent block found for value="${value}"`);
  return m[0];
}

describe("setup-page — uses the shared sdk-ui Tabs primitive, no vendored copy", () => {
  it("imports Tabs/TabsContent/TabsListRow/TabsTrigger from @cinatra-ai/sdk-ui/tabs", () => {
    expect(src).toContain(
      'import { Tabs, TabsContent, TabsListRow, TabsTrigger } from "@cinatra-ai/sdk-ui/tabs";',
    );
  });

  it("does not vendor its own tabs.tsx (boundary respected — no copied primitive)", () => {
    // No connector-local tabs module import (e.g. "./ui/tabs" or "./tabs").
    expect(src).not.toMatch(/from ["']\.\/(ui\/)?tabs["']/);
  });

  it("composes the shared ConnectorSetupPage/ConnectorSetupColumns/ConnectionStatusBadge shell (extended §II design)", () => {
    expect(src).toContain(
      'import { ConnectorSetupPage } from "@cinatra-ai/sdk-ui/connector-setup-page";',
    );
    expect(src).toContain(
      'import { ConnectorSetupColumns } from "@cinatra-ai/sdk-ui/connector-setup-columns";',
    );
    expect(src).toContain(
      'import { ConnectionStatusBadge } from "@cinatra-ai/sdk-ui/connection-status-badge";',
    );
    // Tabbed page — the tab row owns the section rule, not the header.
    expect(flat).toContain("divider={false}");
  });
});

describe("setup-page — tab presence and order (Help always LAST)", () => {
  it("declares exactly two tabs: setup, then help", () => {
    expect(tabTriggerOrder()).toEqual(["setup", "help"]);
  });

  it('the tablist row renders "Setup" then "Help", in that literal order', () => {
    const listRowMatch = src.match(/<TabsListRow[\s\S]*?<\/TabsListRow>/);
    expect(listRowMatch).not.toBeNull();
    const listRow = listRowMatch![0];
    const setupIdx = listRow.indexOf(">Setup<");
    const helpIdx = listRow.indexOf(">Help<");
    expect(setupIdx).toBeGreaterThan(-1);
    expect(helpIdx).toBeGreaterThan(-1);
    expect(setupIdx).toBeLessThan(helpIdx);
  });

  it("help is the single-connection connector's only custom tab, so it is also the LAST tab overall", () => {
    const order = tabTriggerOrder();
    expect(order[order.length - 1]).toBe("help");
  });
});

describe("setup-page — a11y tab semantics", () => {
  it("the tablist row carries an accessible label", () => {
    expect(src).toMatch(/<TabsListRow\s+aria-label="[^"]+"/);
  });

  it("Tabs declares a defaultValue so a selected tab is always determinate on load", () => {
    expect(src).toMatch(/<Tabs\s+defaultValue="setup"/);
  });

  it("every TabsContent is forceMount + data-state driven (keeps inactive panels in the DOM, hidden via [data-state=inactive], not unmounted) so tab switching is a state change, not a remount", () => {
    const contentBlocks = src.match(/<TabsContent[^>]*>/g) ?? [];
    expect(contentBlocks.length).toBe(2);
    for (const tag of contentBlocks) {
      expect(tag).toContain("forceMount");
      expect(tag).toContain("data-[state=inactive]:hidden");
    }
  });

  it("keyboard nav / roving focus / aria-selected are inherited from the shared Radix-backed Tabs primitive, not reimplemented here", () => {
    // No hand-rolled role="tab" / aria-selected / keydown handling in this
    // file — that semantics lives once in @cinatra-ai/sdk-ui/tabs.
    expect(src).not.toMatch(/role=["']tab["']/);
    expect(src).not.toMatch(/aria-selected/);
    expect(src).not.toMatch(/onKeyDown/);
  });
});

describe("setup-page — content mapping (each tab holds the right content, nothing bleeds across tabs)", () => {
  it('the "setup" tab holds the connect/update form + admin gate, inside ConnectorSetupColumns', () => {
    const block = tabsContentBlock("setup");
    expect(block).toContain("<ConnectorSetupColumns");
    expect(block).toContain("saveTwentyConnectionAction");
    expect(block).toContain("Twenty instance URL");
    expect(block).toContain("Twenty API key");
    expect(block).toContain("conformanceId=\"connector-setup\"");
    // The Connection status aside lives inside the same Setup tab (single
    // connection — no separate "Connections" tab per the one-connection
    // layout in app-connectors.html §II).
    expect(block).toContain("Connection status");
    expect(block).toContain("ConnectionStatusBadge");
  });

  it('the "help" tab is read-only — no form, no Save, no server action bindings', () => {
    const block = tabsContentBlock("help");
    expect(block).not.toContain("<form");
    expect(block).not.toContain("saveTwentyConnectionAction");
    expect(block).not.toContain("disconnectTwentyConnectionAction");
    expect(block).not.toMatch(/>\s*Save\s*</);
  });

  it('the "help" tab carries the setup how-to prose (prerequisite + connect steps)', () => {
    const block = tabsContentBlock("help");
    expect(block).toContain("Prerequisite");
    expect(block).toContain("Connect your workspace");
    expect(block).toContain("APIs &amp; Webhooks");
  });

  it("the disconnect action stays scoped to the setup tab's status card, never appears in help", () => {
    const setupBlock = tabsContentBlock("setup");
    const helpBlock = tabsContentBlock("help");
    expect(setupBlock).toContain("disconnectTwentyConnectionAction");
    expect(helpBlock).not.toContain("disconnectTwentyConnectionAction");
  });
});

describe("setup-page — pre-existing behavior preserved across the restructure", () => {
  it("still gates the connect/update form on viewer.isAdmin (admin-only connect surface, unchanged)", () => {
    expect(src).toContain("viewer.isAdmin");
  });

  it("still surfaces the private-instance-URL advisory when connected", () => {
    expect(src).toContain("isPrivateUrl");
    expect(src).toContain("This instance URL is private");
  });

  it("still mounts the codes-only SearchParamToast flash island", () => {
    expect(src).toContain("TWENTY_SETUP_FLASH_TOASTS");
    expect(src).toContain("<SearchParamToast");
  });

  it("still gates the form on the connection service being ready", () => {
    expect(src).toContain("connectionServiceReady");
    expect(src).toContain("connection service is not configured");
  });
});
