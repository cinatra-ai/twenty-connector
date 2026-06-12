import { defineConfig } from "vitest/config";
import * as path from "node:path";

const repoRoot = path.join(__dirname, "../../..");
const serverOnlyStub = path.join(repoRoot, "tests/__stubs__/server-only.ts");

export default defineConfig({
  resolve: {
    alias: [
      { find: "server-only", replacement: serverOnlyStub },
    ],
  },
  test: {
    environment: "node",
    // scripts/twenty-bootstrap carries the Twenty bootstrap/cutover operator
    // tooling; its guard tests are plain-node (vitest + pg only) and run
    // standalone in .github/workflows/twenty-bootstrap-proof.yml, which
    // installs pg ephemerally (NOT a declared devDependency — the cinatra
    // monorepo lockfile must keep matching this package.json).
    include: ["src/**/*.test.ts", "scripts/**/__tests__/**/*.test.mjs"],
    // (The raw-mcp-exposure proof that used to be excluded here — it imports
    // @/lib/* and could never resolve it from this package sandbox — moved
    // HOST-SIDE in cinatra#172 Stage H1: cinatra core
    // src/lib/external-mcp/__tests__/raw-mcp-exposure.test.ts, where it
    // actually runs under the root vitest include.)
    exclude: ["**/node_modules/**"],
  },
});
