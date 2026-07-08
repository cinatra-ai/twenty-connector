# Changelog

All notable changes to this project are documented here, derived from the
project's merged pull request and release-tag history.

## v0.1.5

- fix(setup): bind connector-local "use server" actions and resolve host deps lazily, so the setup page renders instead of failing with a server error on hosts where the setup-action bridge is unavailable (cinatra#1097) (#52)
- Note: supersedes 0.1.4, which was tagged before this fix and was not published to the marketplace catalog.

## v0.1.4 — 2026-07-07

- feat(dev-setup): dev-mode provisioning moves into a connector-owned `devSetup` hook conforming to the Cinatra extension devSetup contract — host IO through capability ports, soft-fail helpers that never leak raw error text (cinatra#976) (#49)
- refactor(setup): move the connector-owned trimmed form primitives out of the registry-vendored namespace (#48)
- No behavior change for installed instances. Not published to the marketplace catalog; superseded by 0.1.5.

## v0.1.3 — 2026-07-04

- feat(setup): wire the Twenty CRM connect flow — reported by @marcushorndt (#39); host-side action pairs in Cinatra
- fix(setup): render a clean user-facing not-connected state (#39) (#41)
- feat: final connection access-scoping declaration — default scope "workspace" (cinatra#954 W4) (#47)
- chore: add cinatra.vendor metadata and drop a dead committed lockfile (#42)
- chore(deps): declare cinatra.consumes for closure-gate enrollment (#43); declare cross-extension deps as semver ranges (#44)
- docs: expand README to the org standard (#26) (#27); add Integrations hub docs + publish-on-tag + README link (#30); CHANGELOG reconstructed from tag + merged-PR history (#45)
- chore: add CODEOWNERS coverage (#29); strip private tracker references from public source and workflow comments (#35, #38)
- ci: ramp the ui-gate raw-JSX block to error (#31); adopt source-leak-gate (#32, #33); re-vendor the ui-gate preset with the dynamic-import ban (#34); pin the release workflow to the gated reusable extension-release flow (release-approval wall) (#40)

## v0.1.2 — 2026-06-23

- ci: add truthful-attribution-gate in WARN (advisory) mode (#20)
- ci: adopt the reusable extension->host IoC conformance gate (org-wide rollout) (#21)
- ci: tag-driven GitHub release on v* (#22)
- ci: adopt secret-scan-gate (#23)
- release: bump @cinatra-ai/twenty-connector to v0.1.2 (#24)

## v0.1.1 — 2026-06-13

- docs(readme): 'Works with' bullets-only (fix extension-readme-gate) (#1)
- ci: adopt source-leak-gate (#2)
- ci: adopt source-leak-gate (#3)
- chore: add .gitignore and untrack accidentally committed node_modules (#4)
- Adopt the Twenty bootstrap/cutover operator tooling and its proof workflow (#5)
- ci: adopt org actions-pinned + gitignore gates; SHA-pin all remote uses: refs (#6)
- chore: keep internal planning notes untracked (#7)
- Register the Twenty CRM provider behind the crm-provider capability from a serverEntry (#8)
- chore: npm packaging hygiene — files allowlist + source-archive export-ignore (#9)
- ci: adopt the org ui-design-system gate (#10)
- chore: Configure Renovate (#11)
- test: relocate raw-mcp-exposure proof host-side (cinatra#172 Stage H1) (#13)
- Resolve the external-MCP registry read surface through a host deps slot (cinatra#172 Stage H4) (#14)
- ci(release): grant contents: write + pin reusable workflow to .github HEAD (#15)
- ci: repin reusable release workflow (immutable-safe decoration + corrected build-input provisioning) (#16)
- release: twenty-connector v0.1.1 (republish on corrected serverEntry build pipeline) (#17)
- ci: repin reusable release workflow to .github@21f807e7 (#18)
- twenty-connector: pin required dep edge to exact promoted version (#19)

## v0.1.0 — 2026-06-03

- Initial release.


