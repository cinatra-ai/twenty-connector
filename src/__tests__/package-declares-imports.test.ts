// Every package the shipped sources import must be declared in package.json.
//
// The setup page and its client island are bundled by the host from this
// package. A strict installer (pnpm) gives the bundle only what the package
// declares, so an undeclared import resolves only by accident (hoisting) and
// fails in a strict consumer. The plain-node test sandbox never resolves the
// .tsx sources, so this reads their imports with the extension kind gate's own
// parser and checks each one against the declarations.
//
// Exempt: node builtins and the host-served virtual modules (the host supplies
// them at run time; the gate's HOST_SERVED_PACKAGES).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseModuleImports,
  basePackageOf,
  HOST_SERVED_PACKAGES,
} from "../../extension-kind-gate.mjs";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const SOURCE_RE = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function shippedSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...shippedSources(abs));
    else if (SOURCE_RE.test(name) && !name.endsWith(".d.mts") && !name.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}

function importedPackages(): Map<string, string[]> {
  const byPackage = new Map<string, string[]>();
  for (const file of shippedSources(SRC_DIR)) {
    for (const imp of parseModuleImports(readFileSync(file, "utf8"))) {
      const base = basePackageOf(imp.specifier);
      if (!base || base.startsWith("node:") || !NPM_NAME_RE.test(base)) continue;
      const files = byPackage.get(base) ?? [];
      files.push(file.slice(SRC_DIR.length));
      byPackage.set(base, files);
    }
  }
  return byPackage;
}

describe("package.json declares every package the shipped sources import", () => {
  it("no shipped source imports an undeclared package", () => {
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]);
    const undeclared: string[] = [];
    for (const [base, files] of importedPackages()) {
      if (base === pkg.name || HOST_SERVED_PACKAGES.has(base) || declared.has(base)) continue;
      undeclared.push(`${base} (${[...new Set(files)].join(", ")})`);
    }
    expect(undeclared).toEqual([]);
  });

  it("the setup page's lucide-react glyphs are a runtime dependency, as the sibling connectors declare them", () => {
    expect(importedPackages().has("lucide-react")).toBe(true);
    expect(pkg.dependencies?.["lucide-react"]).toMatch(/^\^1\.\d+\.\d+$/);
  });
});
