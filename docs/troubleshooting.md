---
slug: twenty
title: Twenty troubleshooting
description: Diagnose and fix common problems connecting Cinatra to your Twenty CRM.
navOrder: 5
tier: first-party
lifecycle: active
cinatraCompat: ">=1.2 <2"
integrationVersion: "0.1.2"
sourceRepo: https://github.com/cinatra-ai/twenty-connector
supportUrl: https://docs.cinatra.ai/resources/support/
marketplaceUrl: https://marketplace.cinatra.ai/extensions/twenty
---

# Twenty troubleshooting

Each problem below gives the symptom, the cause, the fix, how to confirm it, and
where to go if the fix does not work.

## No Twenty workspace is connected

- **Symptom:** A CRM action fails immediately with a configuration error
  (`TwentyConfigError`), saying no enabled Twenty workspace is registered.
- **Cause:** No Twenty connection has been created yet, or the connection you
  expected is disabled.
- **Fix:** Create or re-enable the connection — add your Twenty base URL and API
  key (see the [quick start](./quick-start.md), Step 3).
- **Diagnostics:** Confirm a connection for your workspace is registered, is
  enabled, and points at the base URL you intend (see the
  [quick start](./quick-start.md), Step 3, for where connections are registered).
- **Escalation:** [Contact support](https://docs.cinatra.ai/resources/support/)
  if a connection appears configured but still reports as missing.

## Authentication fails (401)

- **Symptom:** Actions fail with an MCP error reporting HTTP 401
  (`TwentyMcpError`), or "unauthorized" from Twenty.
- **Cause:** The API key is missing, wrong, expired, or revoked in Twenty.
- **Fix:** Create a fresh API key in Twenty (**Settings → APIs & Webhooks →
  API keys**) and update the connection in Cinatra with the new token.
- **Diagnostics:** Confirm the key still exists and is active in Twenty, and
  that the connection in Cinatra uses the current value.
- **Escalation:** If a brand-new key still returns 401, [contact
  support](https://docs.cinatra.ai/resources/support/).

## Cannot reach the Twenty workspace

- **Symptom:** Requests time out or fail to connect; no 401, just no response.
- **Cause:** A wrong base URL, or your Twenty workspace is unreachable from
  Cinatra (down, behind a firewall, or DNS/TLS issue).
- **Fix:** Verify the base URL is exactly your workspace URL and is reachable
  from where Cinatra runs; correct the URL or open network access, then retry.
- **Diagnostics:** Confirm the Twenty workspace loads in a browser, and that the
  base URL has the right scheme and host. Check for a trailing-path or
  typo mistake in the configured URL.
- **Escalation:** If the workspace is reachable in a browser but not from
  Cinatra, [contact support](https://docs.cinatra.ai/resources/support/) with
  the base URL and the time of the failure.

## A record action is denied or finds nothing

- **Symptom:** A read returns no records you expected, or a create/update is
  rejected as not permitted.
- **Cause:** The API key's role in Twenty lacks read or write permission on the
  object you are touching.
- **Fix:** Grant the key's role the needed object permission in Twenty (see
  [Settings & permissions](./settings-and-permissions.md)), or use a key on a
  role that already has it.
- **Diagnostics:** Check the role attached to the API key in Twenty and confirm
  it can read or write that object; reproduce the same action directly in Twenty
  as that role.
- **Escalation:** If the role clearly has the permission but the action still
  fails, [contact support](https://docs.cinatra.ai/resources/support/).

## The wrong workspace is being used

- **Symptom:** Actions land in a different Twenty workspace than you intended.
- **Cause:** With multiple connections configured, the action targeted a
  different connection than expected.
- **Fix:** Direct the agent or workflow at the specific workspace you mean, and
  confirm each connection's base URL is correct.
- **Diagnostics:** Review the configured connections and which one the action
  resolved to; verify the base URLs are not mixed up.
- **Escalation:** [Contact support](https://docs.cinatra.ai/resources/support/)
  if connection resolution does not match your configuration.

## Still stuck

If none of the above resolves your problem, gather the action you ran, the exact
error message, and the time it happened, and reach out via
[Cinatra support](https://docs.cinatra.ai/resources/support/).
