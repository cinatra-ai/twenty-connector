# Changelog

All notable changes to this project are documented here, derived from the
project's merged pull request and release-tag history.

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

## Unreleased

- docs(readme): expand README to the org standard (#26) (#27)
- chore: add CODEOWNERS coverage (#29)
- docs: add Integrations hub docs + publish-on-tag + README link (#30)
- ci(ui-gate): ramp raw-JSX block to error (#31)
- ci: adopt source-leak-gate (#32)
- ci: adopt source-leak-gate (#33)
- ci(ui-gate): re-vendor preset with Block-C (dynamic-import ban) + bump pin to v0.1.1 (#34)
- chore: strip private engineering-tracker refs from public source (#35)
- chore: strip private tracker references from workflow comments (#38)
- ci(release): pin reusable-extension-release to gated v0.1.1 (release-approval wall) (#40)
- fix(twenty-connector): user-facing setup empty state (#39) (#41)
- chore: add cinatra.vendor metadata and drop dead committed lockfile (#42)
- chore(deps): declare cinatra.consumes for closure-gate enrollment (#43)
- chore(deps): declare cross-extension deps as semver ranges (#44)

