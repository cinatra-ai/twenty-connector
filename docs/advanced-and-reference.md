---
slug: twenty
title: Twenty advanced and reference
description: Deeper material and canonical reference links for the Twenty integration.
navOrder: 6
tier: first-party
lifecycle: active
cinatraCompat: ">=1.2 <2"
integrationVersion: "0.1.2"
sourceRepo: https://github.com/cinatra-ai/twenty-connector
supportUrl: https://docs.cinatra.ai/resources/support/
marketplaceUrl: https://marketplace.cinatra.ai/extensions/twenty
---

# Twenty advanced and reference

This page collects the deeper material and links out to the canonical Cinatra
reference. It does not duplicate cross-cutting documentation — it points to it.

## How the integration works

The Twenty integration registers itself as the `twenty` provider behind
Cinatra's provider-agnostic CRM facade. Any Cinatra workflow that performs a CRM
action calls the facade, and the facade routes the action to your connected
Twenty workspace — no host-side code names Twenty directly. This is what lets a
single workflow target Twenty today and another CRM tomorrow without rewriting
the workflow.

The connector communicates with Twenty over Twenty's MCP `execute_tool`
protocol. At call time it resolves the right workspace and its access token from
Cinatra's external connection registry, so credentials are never baked into a
workflow and multiple workspaces stay isolated.

## Object and Lists mapping

- **People and Companies** map to Twenty's catalog tools for creating, updating,
  finding, and fetching a single record.
- **Opportunities and custom objects/fields** are reachable through the same
  catalog, so the data shape your team modelled in Twenty is what Cinatra works
  with.
- **Cinatra Lists** map onto Twenty **Views**: searching and getting Views,
  creating a View, and adding or removing members.

## Multi-workspace behaviour

Each connection is an independent workspace with its own base URL and API key.
The integration resolves the correct connection per action, so two workspaces
never share state and a token from one is never used against the other.

## Compatibility and versioning

The integration documents the released version it ships with in the page footer
(`integrationVersion`) and the Cinatra compatibility range (`cinatraCompat`).
Keep your Twenty workspace on a supported, up-to-date release that exposes the
MCP `execute_tool` tool catalog. This hub always reflects the latest released
version of the integration.

## Reference links

- **Cinatra Guides** — cross-cutting how-to material:
  [Guides](https://docs.cinatra.ai/guides/).
- **Cinatra References** — the platform and connector reference:
  [References](https://docs.cinatra.ai/references/).
- **Authoring connectors** — how connector extensions like this one are built:
  [Authoring connector extensions](https://docs.cinatra.ai/references/platform/extension-kinds/authoring-connector-extensions/).
- **The integration docs contract** — the contract this hub follows:
  [The integration docs contract](https://docs.cinatra.ai/references/platform/integration-docs-contract/).
- **Install & manage extensions** — the shared lifecycle for every extension:
  [Install & manage any marketplace extension](https://docs.cinatra.ai/integrations/install-and-manage-marketplace-extensions/).
- **Twenty** — the upstream open source CRM:
  [twenty.com](https://twenty.com/).

## Source and support

- Source repository and releases:
  [cinatra-ai/twenty-connector](https://github.com/cinatra-ai/twenty-connector).
- Get help: [Cinatra support](https://docs.cinatra.ai/resources/support/).
