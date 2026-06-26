---
slug: twenty
title: Twenty quick start
description: Connect Cinatra to your Twenty workspace and confirm it works, end to end.
navOrder: 2
tier: first-party
lifecycle: active
cinatraCompat: ">=1.2 <2"
integrationVersion: "0.1.2"
sourceRepo: https://github.com/cinatra-ai/twenty-connector
supportUrl: https://docs.cinatra.ai/resources/support/
marketplaceUrl: https://marketplace.cinatra.ai/extensions/twenty
---

# Twenty quick start

This page takes you from nothing to a working Cinatra-to-Twenty connection,
end to end. You can finish setup here without leaving the page.

## Before you start

You need:

- A running, reachable **self-hosted Twenty workspace** (its base URL, for
  example `https://crm.example.com`).
- An **administrator** account in your Cinatra instance — installing and
  connecting an extension is an admin action.
- The ability to create an **API key** in your Twenty workspace.

## Step 1 — Get a Twenty API key

In Twenty, an API key is what lets Cinatra act in your workspace.

1. Open your Twenty workspace as an admin.
2. Go to **Settings → APIs & Webhooks → API keys**.
3. Create a new API key, give it a name you will recognise (for example
   `cinatra`), and copy the generated token. Twenty shows the token once — store
   it somewhere safe for the next step.

The API key inherits the permissions of the role it is created under. Use a role
that can read and write the objects you want Cinatra to manage (see
[Settings & permissions](./settings-and-permissions.md)).

## Step 2 — Install the integration in Cinatra

1. In your Cinatra instance, open the Marketplace at
   `/configuration/marketplace`.
2. Find **Twenty CRM** (it carries the **Built by Cinatra** label).
3. Install it. Cinatra fetches the extension at its published version and
   registers it with your instance.

For the general install, update, and removal flow that applies to every
extension, see
[Install & manage any marketplace extension](https://docs.cinatra.ai/integrations/install-and-manage-marketplace-extensions/).

## Step 3 — Connect your Twenty workspace

Connecting a workspace means registering it — its **base URL** and the **API
key** from Step 1 — so the connector can reach it. The connector reads the
workspace and its access token from the host's external connection registry at
call time, so the connection lives there.

Provide two values for the connection:

1. **Base URL** — the URL of your Twenty workspace (for example
   `https://crm.example.com`).
2. **API key** — the token you created in Step 1.

> [!NOTE]
> The in-product setup screen for entering these values is still being wired up.
> Until it lands, register the workspace connection through the host's documented
> workspace-bootstrap path (an administrator step); the connector then resolves
> it automatically at call time. Your Cinatra administrator can confirm the
> current way to add a connection for your instance.

If you run more than one Twenty workspace, register each one — every connection
is independent.

## Step 4 — Confirm it works

Verify the connection end to end before you rely on it:

1. Ask a Cinatra agent (or run a workflow) to **find a person** that you know
   exists in your Twenty workspace.
2. Confirm the agent returns that record's details.
3. As a write check, have the agent **create a test company**, then open Twenty
   and confirm the new Company appears.

When both succeed, the integration is connected and working. If a step fails,
see [Troubleshooting](./troubleshooting.md) for the symptom-by-symptom fix.

## You are done

Your Cinatra instance can now read and write your Twenty CRM. Next:

- See [Use it](./use-it.md) for what you can do day to day.
- See [Settings & permissions](./settings-and-permissions.md) to tune what the
  integration is allowed to touch.
