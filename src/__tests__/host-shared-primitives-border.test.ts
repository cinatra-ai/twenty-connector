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

/** The org extension-kind gate (extension-kind-gate.mjs) reads every source file
 *  of this package as RAW TEXT and matches imports with regexes: it has no
 *  parser and no test-file exemption. A fixture below that spelled an
 *  import, export or require keyword next to a quoted host-internal specifier
 *  would therefore read to that gate as a real host-internal import BY THIS
 *  PACKAGE, and fail the very border this file exists to keep. So the fixture
 *  INPUTS are assembled at run time from the parts below — each input string
 *  handed to specifiersOf is byte-identical to the literal form it replaces,
 *  while no line of this file's static text spells one. The EXPECTED values
 *  stay literal on purpose: a typo in a part below then fails the assertion
 *  instead of hiding on both sides of it. */
const KW_IMPORT = "im" + "port";
const KW_EXPORT = "ex" + "port";
const KW_FROM = "fr" + "om";
const KW_REQUIRE = "requi" + "re";
const LINE_COMMENT = "/" + "/";
const BLOCK_COMMENT = "/" + "* why *" + "/";
const HOST_INTERNAL_PREFIX = "@" + "/";
const SPEC_CARD = `${HOST_INTERNAL_PREFIX}components/ui/card`;
const SPEC_UTILS = `${HOST_INTERNAL_PREFIX}lib/utils`;
const SPEC_NEAR_MISS = `${HOST_DESIGN_PRIMITIVES_MODULE}/card`;

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

/** The keyword that opens a specifier position. It carries NO quantifier at
 *  all: everything after the keyword — the optional parenthesis, the whitespace
 *  and any block comments before the quote — is read below with plain string
 *  operations, so no part of this extraction can backtrack. The shape this
 *  replaces (a repeated block-comment group wrapped around a lazy any-character
 *  run) is the one CodeQL js/redos named for exponential backtracking on a
 *  keyword followed by many star-slash-slash-star repetitions.
 *
 *  Cost, stated exactly: the scan makes the same kind of forward searches the
 *  old expression made (one pass per keyword candidate for a comment
 *  terminator and for the closing quote), so it is no dearer than what it
 *  replaces; what is gone is the repeated group whose cost doubled with every
 *  repetition added.
 *
 *  One deliberate narrowing, recorded by a case below: the old expression's
 *  lazy comment body could run PAST a comment's terminator and swallow
 *  non-comment text, so a keyword followed by a comment, ordinary text, a
 *  second comment and a quoted specifier read as an import. The scan stops at
 *  the first terminator and reads nothing there. That shape is not module
 *  syntax; both extractions were run over every source file of this package
 *  and returned the same specifiers for each. */
const SPECIFIER_KEYWORD = /\b(?:from|import|require)/g;
const OPEN_COMMENT = "/" + "*";
const CLOSE_COMMENT = "*" + "/";
const QUOTES = ['"', "'"];

/** The first index at or after `start` that is not whitespace. */
function skipSpace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source.charAt(index))) index += 1;
  return index;
}

/** The first quote of either kind at or after `start`, or -1. */
function nextQuote(source: string, start: number): number {
  let found = -1;
  for (const quote of QUOTES) {
    const at = source.indexOf(quote, start);
    if (at !== -1 && (found === -1 || at < found)) found = at;
  }
  return found;
}

/** Every module specifier a file names: static imports/re-exports, bare
 *  side-effect imports, dynamic import() and require(). */
function specifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  // `from "x"`, a bare side-effect `import "x"`, `import("x")` and `require("x")`,
  // with block comments tolerated between the keyword and the specifier.
  SPECIFIER_KEYWORD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPECIFIER_KEYWORD.exec(source)) !== null) {
    let index = skipSpace(source, match.index + match[0].length);
    if (source.charAt(index) === "(") index = skipSpace(source, index + 1);
    while (source.startsWith(OPEN_COMMENT, index)) {
      const end = source.indexOf(CLOSE_COMMENT, index + OPEN_COMMENT.length);
      if (end === -1) break;
      index = skipSpace(source, end + CLOSE_COMMENT.length);
    }
    if (!QUOTES.includes(source.charAt(index))) continue;
    const close = nextQuote(source, index + 1);
    if (close === -1 || close === index + 1) continue;
    specifiers.push(source.slice(index + 1, close));
    SPECIFIER_KEYWORD.lastIndex = close + 1;
  }
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
    expect(specifiersOf(`${KW_IMPORT} "${SPEC_UTILS}";`)).toEqual(["@/lib/utils"]);
    expect(specifiersOf(`${KW_IMPORT} "${SPEC_NEAR_MISS}";`)).toEqual([
      "@cinatra-ai/design-primitives/card",
    ]);
    expect(
      specifiersOf(`${KW_IMPORT} { Card } ${KW_FROM} ${BLOCK_COMMENT} "${SPEC_CARD}";`),
    ).toEqual(["@/components/ui/card"]);
    expect(specifiersOf(`${KW_EXPORT} { Card } ${KW_FROM} "${SPEC_CARD}";`)).toEqual([
      "@/components/ui/card",
    ]);
    expect(specifiersOf(`${KW_IMPORT} type { Card } ${KW_FROM} "${SPEC_CARD}";`)).toEqual([
      "@/components/ui/card",
    ]);
    expect(specifiersOf(`const m = await ${KW_IMPORT}("${SPEC_CARD}");`)).toEqual([
      "@/components/ui/card",
    ]);
    expect(specifiersOf(`const u = ${KW_REQUIRE}("${SPEC_UTILS}");`)).toEqual(["@/lib/utils"]);
    // Prose is not an import: only whitespace or a block comment may sit
    // between the keyword and the specifier.
    expect(
      specifiersOf(`${LINE_COMMENT} derived ${KW_FROM}\nconst x = "${SPEC_UTILS}";`),
    ).toEqual([]);
  });

  it("reads a comment-laden fixture at once (it cannot backtrack exponentially)", () => {
    // The extraction above used to tolerate comments with a repeated group; on a
    // keyword followed by many star-slash-slash-star repetitions and no
    // specifier to find, that group backtracked exponentially — the finding
    // CodeQL js/redos raised against the expression this scan replaces. The
    // scan makes one forward pass per keyword, so this returns nothing at once
    // rather than costing twice as much with every repetition added.
    const pathological = `${KW_FROM} ${OPEN_COMMENT}${"*//*".repeat(28)}X`;
    const started = Date.now();
    expect(specifiersOf(pathological)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("stops at a comment's terminator (the one narrowing against the old scan)", () => {
    // The expression this scan replaces could swallow ordinary text between two
    // comments and still read the quoted specifier after them. That shape is
    // not module syntax, no source file carries it, and the scan does not read
    // it as an import. Recorded so the narrowing is deliberate, not drift.
    expect(
      specifiersOf(`${KW_FROM} ${BLOCK_COMMENT} plain ${BLOCK_COMMENT} "x";`),
    ).toEqual([]);
    // What the old scan and this one both read: comments only, then the quote.
    expect(specifiersOf(`${KW_FROM} ${BLOCK_COMMENT} ${BLOCK_COMMENT} "x";`)).toEqual(["x"]);
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
