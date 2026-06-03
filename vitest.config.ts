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
    include: ["src/**/*.test.ts"],
    // The raw-mcp-exposure test imports @/lib/* and requires DB mocking
    // that this package's vitest config does not provide. Excluded for
    // now (status quo: this test was never actually running pre-this-PR).
    exclude: [
      "**/node_modules/**",
      "src/__tests__/raw-mcp-exposure.test.ts",
    ],
  },
});
