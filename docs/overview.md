---
slug: twenty
title: Twenty integration overview
description: Connect Cinatra to your self-hosted Twenty CRM so agents read and write your records.
navOrder: 1
tier: first-party
lifecycle: active
cinatraCompat: ">=1.2 <2"
integrationVersion: "0.1.2"
sourceRepo: https://github.com/cinatra-ai/twenty-connector
supportUrl: https://docs.cinatra.ai/resources/support/
marketplaceUrl: https://marketplace.cinatra.ai/extensions/twenty
---

# Twenty integration overview

The Twenty integration connects Cinatra to [Twenty](https://twenty.com/), the
open source CRM, so your Cinatra agents can read and write the records in your
Twenty workspace — People, Companies, Opportunities, and your custom objects —
against the CRM that is already your system of record. Instead of asking your
team to copy data into Cinatra, the integration lets agents work directly inside
the CRM you already run.

It is a **first-party** integration: built, supported, and shipped by the
Cinatra team as a marketplace extension. Under the hood it registers itself as
the `twenty` provider behind Cinatra's provider-agnostic CRM facade, so any
Cinatra workflow that performs a CRM action routes to your Twenty workspace
without naming Twenty directly. The connector talks to Twenty over Twenty's MCP
`execute_tool` protocol, resolving your workspace and its access token from
Cinatra's external connection registry at call time.

## What you can do with it

Once connected, your agents and workflows can:

- **Find and read records** — look up People and Companies, fetch a single
  record, and search across your workspace.
- **Create and update records** — add or edit People, Companies, and
  Opportunities, including values for your custom fields.
- **Work with Lists** — back a Cinatra List with a Twenty View: search, get,
  create, and add or remove members.
- **Run against multiple workspaces** — connect more than one Twenty instance
  and target each independently.

## Who it is for

This integration is for teams who run a **self-hosted Twenty workspace** and
want Cinatra agents to operate against it as the CRM of record. You connect your
own Twenty instance; Cinatra does not host Twenty for you.

## Where to go next

- New here? Start with the [quick start](./quick-start.md) — it walks you
  through the whole setup without leaving the page.
- Already connected? See [Use it](./use-it.md) for day-to-day usage.
- Need the permissions and trust model? See
  [Settings & permissions](./settings-and-permissions.md).
- Hitting a problem? See [Troubleshooting](./troubleshooting.md).
