---
slug: twenty
title: Twenty settings and permissions
description: Configure the Twenty connection and understand its permissions and trust model.
navOrder: 4
tier: first-party
lifecycle: active
cinatraCompat: ">=1.2 <2"
integrationVersion: "0.1.2"
sourceRepo: https://github.com/cinatra-ai/twenty-connector
supportUrl: https://docs.cinatra.ai/resources/support/
marketplaceUrl: https://marketplace.cinatra.ai/extensions/twenty
---

# Twenty settings and permissions

This page covers how the Twenty integration is configured, what permissions it
requires, and its trust model — what it can access, how that access is granted,
and how it is governed.

## Connection settings

Each connected Twenty workspace is one connection, defined by two values:

- **Base URL** — the URL of your self-hosted Twenty workspace (for example
  `https://crm.example.com`). This is where the integration sends every request.
- **API key** — the Twenty API token Cinatra uses to authenticate. Cinatra
  stores the token securely; you can replace it at any time by updating the
  connection (for example, after rotating the key in Twenty).

You can configure more than one connection. Each Twenty workspace is independent
— a separate base URL and API key — and is targeted independently.

## Who can install and configure

Installing the integration, creating connections, and changing them are
**administrator** actions in Cinatra, governed by the extension-management
permission in your instance. See
[Permissions](https://docs.cinatra.ai/guides/admin/permissions/) for how
Cinatra's permission model is administered.

## What the integration can access

The integration's reach into Twenty is exactly the reach of the **API key** you
give it. The key inherits the permissions of the role it was created under in
Twenty, so:

- To let Cinatra **read** records, the key's role needs read access to those
  objects.
- To let Cinatra **write** records, the key's role needs write access to those
  objects.
- To limit the integration, **scope the Twenty role** the API key uses — grant
  the narrowest set of object permissions that lets your workflows do their job,
  and nothing more.

Within Cinatra, the integration declares the host capabilities it needs at
install time, and Cinatra governs those through the same permission and access
model as the rest of the platform. An installed extension only gets the access
you grant it, and that access is auditable.

## Compatibility

- **Cinatra:** this integration is compatible with the Cinatra versions stated
  in the page footer (`cinatraCompat`).
- **Twenty:** the integration targets a current self-hosted Twenty workspace
  that exposes Twenty's MCP `execute_tool` tool catalog. Keep your Twenty
  workspace on a supported, up-to-date release.

## Trust model

- **Your key, your scope.** Cinatra acts in Twenty as the API key allows —
  nothing more. You decide that scope when you create the key's role in Twenty.
- **Your workspace, your endpoint.** Requests go only to the base URL you
  configured, over its connection. The integration does not reach any workspace
  you have not connected.
- **Secure storage.** The API key is stored securely by Cinatra and is never
  exposed back to readers or logs.
- **Auditable.** Both Cinatra's grant of capabilities to the extension and the
  CRM changes it makes are visible — review them as you would any system that
  writes to your CRM.

Grant the narrowest access that works, rotate the API key periodically, and
review what the integration is allowed to do before you enable a workflow that
writes to your CRM.
