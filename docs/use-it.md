---
slug: twenty
title: Use the Twenty integration
description: What you do day to day with Cinatra connected to your Twenty CRM.
navOrder: 3
tier: first-party
lifecycle: active
cinatraCompat: ">=1.2 <2"
integrationVersion: "0.1.2"
sourceRepo: https://github.com/cinatra-ai/twenty-connector
supportUrl: https://docs.cinatra.ai/resources/support/
marketplaceUrl: https://marketplace.cinatra.ai/extensions/twenty
---

# Use the Twenty integration

Once your Twenty workspace is connected (see the
[quick start](./quick-start.md)), Cinatra agents and workflows can operate
against your CRM as the system of record. You do not call Twenty's API directly
— you ask Cinatra to perform a CRM action, and it routes to Twenty for you.

## Reading records

Have an agent look up the records you need:

- **Find people or companies** that match a search.
- **Get one record** when you already know who or what you mean.
- **Pull the fields** an agent needs to reason about a contact or account —
  for example, before drafting a follow-up or enriching a record.

Reads are the safe default: use them to let an agent gather context from your
CRM without changing anything.

## Writing records

When you want Cinatra to change your CRM, agents can:

- **Create** a Person, a Company, or an Opportunity.
- **Update** an existing Person or Company, including your custom fields.

A write goes straight into your Twenty workspace, so treat it like any other CRM
edit: scope what the integration is allowed to write (see
[Settings & permissions](./settings-and-permissions.md)) and confirm important
changes.

## Working with Lists

Cinatra Lists map onto Twenty **Views**, so a curated set of records lives in
your CRM rather than in a Cinatra-only copy. You can:

- **Search and get** the Views that back your Lists.
- **Create** a View for a new List.
- **Add or remove members** as the List changes.

## Custom objects and fields

The integration is not limited to the built-in objects. Because it speaks
Twenty's tool catalog, your **custom objects and custom fields** are available
to read and write too — agents can work with the exact shape of data your team
has modelled in Twenty.

## Multiple workspaces

If you connected more than one Twenty workspace, each is an independent target.
Direct an agent or workflow at the specific workspace you mean, and Cinatra
resolves the right connection and token at call time.

## Typical patterns

- **Enrich on the way in** — when new data arrives, have an agent find the
  matching Company or Person and update it.
- **Keep a List current** — let a workflow add or remove View members as a
  segment changes.
- **Capture an opportunity** — turn a qualified conversation into an
  Opportunity record without leaving Cinatra.

For deeper material and the full reference, see
[Advanced & reference](./advanced-and-reference.md).
