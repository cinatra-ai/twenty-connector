// twenty-connector#51 — flash div-banners -> sdk-ui toast island.
//
// Render-composition proof for the setup page's toast state. This repo has no
// react-dom / @testing-library/react (it's a source-mirror extension package —
// react and @cinatra-ai/sdk-ui are optional peerDependencies the cinatra
// monorepo resolves when it workspace-links this package; see
// .github/workflows/ci.yml's "Classify repo" step and vitest.config.ts's
// server-only stub alias, both of which key off that same fact). The cinatra
// host itself tests the identical <SearchParamToast> composition the same way
// (src/components/__tests__/search-param-toast.test.tsx): assert against the
// component's own source text rather than an unavailable DOM renderer. This is
// that pattern applied to twenty-setup-impl.tsx's render tree — it locks the
// exact JSX composition (island mounted, legacy banners gone, persistent
// warning untouched) so a regression here fails a real, specific assertion
// rather than "no test exists".

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const IMPL_SOURCE = readFileSync(
  path.join(__dirname, "..", "twenty-setup-impl.tsx"),
  "utf-8",
);

describe("twenty-setup-impl.tsx — toast island composition", () => {
  it("imports the canonical sdk-ui SearchParamToast island (not a connector-local reimplementation)", () => {
    expect(IMPL_SOURCE).toMatch(
      /import \{ SearchParamToast \} from "@cinatra-ai\/sdk-ui\/search-param-toast";/,
    );
  });

  it("mounts the island, wrapped in Suspense (useSearchParams requires a Suspense boundary), wired to the static flash map", () => {
    expect(IMPL_SOURCE).toMatch(/import \{ Suspense \} from "react";/);
    expect(IMPL_SOURCE).toMatch(
      /<Suspense fallback=\{null\}>\s*<SearchParamToast toasts=\{TWENTY_SETUP_FLASH_TOASTS\} \/>\s*<\/Suspense>/,
    );
    expect(IMPL_SOURCE).toMatch(
      /import \{ TWENTY_SETUP_FLASH_TOASTS \} from "\.\/setup-flash";/,
    );
  });

  it("deletes the three legacy raw-div banners outright (render->spec: no stale elements)", () => {
    // The retired banners rendered these exact literal strings/classes inline;
    // none may remain now that the toast island owns the message (it holds
    // the identical copy in setup-flash.ts instead).
    expect(IMPL_SOURCE).not.toContain("Twenty workspace connected.");
    expect(IMPL_SOURCE).not.toContain("Twenty workspace disconnected.");
    expect(IMPL_SOURCE).not.toContain("border-success/30 bg-success/10");
    expect(IMPL_SOURCE).not.toContain("border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning\">\n                Twenty workspace disconnected");
    expect(IMPL_SOURCE).not.toContain("border-destructive/30 bg-destructive/10");
    expect(IMPL_SOURCE).not.toMatch(/\{errorMessage\}/);
    expect(IMPL_SOURCE).not.toMatch(/const saved = pickParam/);
    expect(IMPL_SOURCE).not.toMatch(/const deleted = pickParam/);
    expect(IMPL_SOURCE).not.toMatch(/const errorMessage = pickParam/);
  });

  it("leaves the persistent 'connection service is not configured' prerequisite warning untouched (ongoing state, not a transient outcome)", () => {
    expect(IMPL_SOURCE).toContain(
      "The connection service is not configured yet, so the key",
    );
    expect(IMPL_SOURCE).toMatch(/\{!connectionServiceReady \? \(/);
  });

  it("still binds the connector-local server actions to the connect/disconnect forms (untouched by the toast migration)", () => {
    expect(IMPL_SOURCE).toContain("<form action={saveTwentyConnectionAction}");
    expect(IMPL_SOURCE).toContain("<form action={disconnectTwentyConnectionAction}");
  });
});
