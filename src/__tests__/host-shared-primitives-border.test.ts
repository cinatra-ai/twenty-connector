// cinatra#3509 (slice 3 of cinatra#3471, epic #2926) — the border assertion for
// this package once it takes the product's primitives from the HOST.
//
// The ruling of 2026-09-13: self-rendering extensions (connectors draw their own
// setup page) no longer carry BYTE COPIES of the product's primitives; the host
// lends them through the module id `@cinatra-ai/design-primitives`, the same road
// it already lends React (for the parts the host COMPILES, as this package's setup
// page is, the host's own path map resolves that id at build time). This
// package's only such copy was
// `src/components/ui/card.tsx` — the one pair the border gate's baseline names
// for it. This file is the standing proof that it is gone and does not come back:
//
//   1. no file lives under `src/components/ui/` at all (the copy is deleted, and
//      a re-vendor of any primitive lands there and fails here first);
//   2. no source file imports the product's internals — `@/components/ui/*` or
//      `@/lib/utils` — which is the coupling the copies were meant to prevent and
//      the second half of the border gate's own rule;
//   3. `package.json` declares no dependency, devDependency or peer on
//      `@cinatra-ai/design-primitives`: the id is VIRTUAL (the host resolves it and
//      nothing is published under it), so any specifier for it —
//      an optional peer included — makes `pnpm install` 404. This package's setup
//      and settings pages are COMPILED by the host, so it takes the build-time
//      road: the host's own path map resolves the id and the package declares
//      nothing at all for it. (Only a package that ships a client renderer
//      bundle records the contract version, in that bundle's preamble.)
//   4. where the shared module IS imported, it is imported by its EXACT bare id:
//      the host's build-time path map maps that exact id, and on the run-time
//      road the SDK's externals allowlist admits that exact id alone, so a
//      near-miss sub-path such as `@cinatra-ai/design-primitives/card`
//      resolves nowhere.
//
// The package's own components under `src/ui/` (badge, button, field, input) are
// NOT in scope: they are the connector's OWN trimmed primitives, not registry
// byte copies, and the border floor does not record them.
//
// Source-text assertions rather than a mounted render: this repo is an extension
// SOURCE MIRROR: react and react-dom are declared peers that a standalone
// checkout does not install, and there is no testing-library (the two
// @cinatra-ai/* peers are the optional ones the monorepo resolves) — the
// same pattern the sibling twenty-setup-toast-migration.test.ts uses.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

const PACKAGE_ROOT = path.join(__dirname, "..", "..");
const SRC_ROOT = path.join(PACKAGE_ROOT, "src");

/** The host-shared module id (mirrors HOST_DESIGN_PRIMITIVES_MODULE in the SDK's
 *  design-primitives contract — a literal here so this assertion stands with no
 *  peer resolved, exactly as this package's other tests do). */
const HOST_DESIGN_PRIMITIVES_MODULE = "@cinatra-ai/design-primitives";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** This file itself carries the banned specifiers as its own fixtures, so it is
 *  the one file the scan skips. */
const SELF = path.join(SRC_ROOT, "__tests__", "host-shared-primitives-border.test.ts");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

const rel = (file: string) => path.relative(PACKAGE_ROOT, file).split(path.sep).join("/");

const SOURCE_FILES = walk(SRC_ROOT)
  .filter((file) => SOURCE_EXTENSIONS.includes(path.extname(file)))
  .filter((file) => file !== SELF);

/** Every module specifier a file names: static imports/re-exports, bare
 *  side-effect imports, dynamic import() and require(). */
function specifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  // `from "x"`, a bare side-effect `import "x"`, `import("x")` and `require("x")`,
  // with a block comment tolerated between the keyword and the specifier.
  const re =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*(?:\/\*[\s\S]*?\*\/\s*)*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) specifiers.push(match[1]);
  return specifiers;
}

const IMPORTS: { file: string; specifier: string }[] = SOURCE_FILES.flatMap((file) =>
  specifiersOf(readFileSync(file, "utf-8")).map((specifier) => ({ file: rel(file), specifier })),
);

describe("host-shared design primitives — the border this package keeps", () => {
  it("carries no byte copy of a product primitive (nothing under src/components/ui)", () => {
    // The exact pair the border gate's baseline recorded for this package.
    expect(existsSync(path.join(SRC_ROOT, "components", "ui", "card.tsx"))).toBe(false);
    // And no primitive copy of any name, now or later.
    expect(SOURCE_FILES.map(rel).filter((file) => file.includes("src/components/ui/"))).toEqual([]);
    expect(existsSync(path.join(SRC_ROOT, "components", "ui"))).toBe(false);
  });

  it("imports nothing product-internal (@/components/ui/*, @/lib/utils, or a components/ui path)", () => {
    const offenders = IMPORTS.filter(
      ({ specifier }) =>
        specifier === "@/components/ui" ||
        specifier.startsWith("@/components/ui/") ||
        specifier === "@/lib/utils" ||
        specifier.startsWith("@/lib/utils/") ||
        /(^|\/)components\/ui\//.test(specifier),
    ).map(({ file, specifier }) => `${file}: ${specifier}`);
    expect(offenders).toEqual([]);
  });

  it("declares no dependency, devDependency or peer on the virtual module id", () => {
    const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf-8"));
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
      "peerDependenciesMeta",
    ]) {
      expect(Object.keys(pkg[field] ?? {})).not.toContain(HOST_DESIGN_PRIMITIVES_MODULE);
    }
  });

  it("sees every import form, including a bare side-effect import and a comment before the specifier", () => {
    // The scan above is only as good as this extraction; these are the forms
    // an earlier version of it missed, so a regression here fails loudly.
    expect(specifiersOf('import "@/lib/utils";')).toEqual(["@/lib/utils"]);
    expect(specifiersOf('import "@cinatra-ai/design-primitives/card";')).toEqual([
      "@cinatra-ai/design-primitives/card",
    ]);
    expect(specifiersOf('import { Card } from /* why */ "@/components/ui/card";')).toEqual([
      "@/components/ui/card",
    ]);
    expect(specifiersOf('export { Card } from "@/components/ui/card";')).toEqual([
      "@/components/ui/card",
    ]);
    expect(specifiersOf('import type { Card } from "@/components/ui/card";')).toEqual([
      "@/components/ui/card",
    ]);
    expect(specifiersOf('const m = await import("@/components/ui/card");')).toEqual([
      "@/components/ui/card",
    ]);
    expect(specifiersOf('const u = require("@/lib/utils");')).toEqual(["@/lib/utils"]);
    // Prose is not an import: only whitespace or a block comment may sit
    // between the keyword and the specifier.
    expect(specifiersOf('// derived from\nconst x = "@/lib/utils";')).toEqual([]);
  });

  it("names the shared module by its exact bare id wherever it imports it (no sub-path)", () => {
    const nearMisses = IMPORTS.filter(
      ({ specifier }) =>
        specifier.startsWith(`${HOST_DESIGN_PRIMITIVES_MODULE}/`) ||
        (specifier.startsWith(HOST_DESIGN_PRIMITIVES_MODULE) &&
          specifier !== HOST_DESIGN_PRIMITIVES_MODULE),
    ).map(({ file, specifier }) => `${file}: ${specifier}`);
    expect(nearMisses).toEqual([]);
  });
});
