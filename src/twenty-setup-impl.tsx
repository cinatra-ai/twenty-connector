import "server-only";

// twenty-connector setup page implementation.
//
// User-facing connect surface for the Twenty CRM connector. Connecting the
// instance-global Twenty workspace is an ADMIN action: the pasted API key is
// held ONLY by the host connect action (deps.saveTwentyConnectionAction), which
// guards the URL, live-probes the key, imports it into the connection service
// (Nango), and writes the external-MCP workspace row. The connector never sees
// the key and reimplements no auth — it renders the form + the current state
// against the host deps slot (`getTwentyDeps()`).
//
// Transient connect/disconnect/error feedback (twenty-connector#51, epic
// cinatra-ai/cinatra#1107 S9): the host actions redirect back here with
// ?saved=1 / ?deleted=1 / ?error=<msg>. The static code->message map lives in
// ./setup-flash and drives the canonical sdk-ui <SearchParamToast> island
// mounted below.
//
// Tabbed setup page (twenty-connector#57, epic cinatra-ai/cinatra#1101, the
// connector-setup-tabs rollout): per the extended connector setup-page design
// (design/specs/app-connectors.html §II), this single-connection connector now
// composes the shared `@cinatra-ai/sdk-ui` setup-page shell + Tabs primitive
// instead of hand-rolling `Main` + `PageHeader` + a bare Card:
//
//   • ConnectorSetupPage    — header + content in ONE centered Wide column
//     (max-w-3xl · 768px); `divider={false}` — the tab row owns the section
//     rule beneath the header.
//   • Tabs + TabsListRow    — the design-system underline tablist; TabsListRow
//     draws the etched paired-line section rule to the RIGHT of the last tab.
//   • ConnectorSetupColumns — the two-column Setup body (wider left = the
//     connect/update form; narrower 236px right = the Connection status
//     card).
//   • ConnectionStatusBadge — the shared connected/disconnected chip language
//     (§I connector cards + filter, §II setup-page status card).
//     It is drawn with the Check action by the client island
//     ./twenty-connection-status (its transient Checking state is client
//     state).
//
// Tab order: Setup first (this connector has exactly one connection and no
// other custom config tab), then the reserved Help tab LAST — read-only setup
// how-to, no form, no Save. No `tabs.tsx` is vendored into this extension; the
// primitive is imported straight from `@cinatra-ai/sdk-ui/tabs` (same
// no-copy contract every bundled-react connector setup page follows).
//
// Shared form primitives come from the host design module.

import { Suspense } from "react";
import { Unplug } from "lucide-react";

import { ConnectorSetupPage } from "@cinatra-ai/sdk-ui/connector-setup-page";
import { ConnectorSetupColumns } from "@cinatra-ai/sdk-ui/connector-setup-columns";
// The joined plug is the design system's first-party mark (the Connected
// badge's glyph); it ships from its own sdk-ui subpath, never re-drawn here.
import { PlugConnected } from "@cinatra-ai/sdk-ui/icons";
import { Tabs, TabsContent, TabsListRow, TabsTrigger } from "@cinatra-ai/sdk-ui/tabs";
import { SearchParamToast } from "@cinatra-ai/sdk-ui/search-param-toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Input,
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
} from "@cinatra-ai/design-primitives";
import { getTwentyDeps } from "./deps";
// Connector-local "use server" actions (cinatra#1097): the forms bind these
// compiler-minted references — never the deps-slot instances, which carry no
// server-reference metadata of their own (see ./actions for the full story).
import {
  saveTwentyConnectionAction,
  disconnectTwentyConnectionAction,
} from "./actions";
import { TWENTY_SETUP_FLASH_TOASTS } from "./setup-flash";
import { TWENTY_WORKSPACE_ROW_ID } from "./twenty-mcp-call";
import { isTwentyWorkspaceConnected } from "./connection-check";
import { TwentyConnectionStatus } from "./twenty-connection-status";

type SearchParams = Record<string, string | string[] | undefined>;

export async function TwentyConnectorSetupImpl(props?: {
  searchParams?: Promise<SearchParams>;
}) {
  void props; // outcome params are read client-side by <SearchParamToast>, not here.
  const deps = getTwentyDeps();
  const viewer = await deps.resolveViewerContext();
  const row = deps.getServerById(TWENTY_WORKSPACE_ROW_ID);
  const connected = isTwentyWorkspaceConnected(row);
  const instanceUrl = row ? row.serverUrl.replace(/\/mcp$/i, "") : null;
  const connectionServiceReady = deps.isConnectionServiceReady();
  const instanceIsPrivate = instanceUrl ? deps.isPrivateUrl(instanceUrl) : false;

  return (
    <ConnectorSetupPage
      title="Twenty CRM"
      description="Connect a Twenty CRM workspace so Cinatra agents can read its contacts, accounts, and lists."
      divider={false}
      className="flex flex-col gap-6 pb-8"
    >
      {/* Codes-only flash island (replaces the retired saved/deleted/error
          banner divs). The static code->message map lives in ./setup-flash;
          a crafted ?error=<text> is never toasted verbatim — see that
          module's header note. */}
      <Suspense fallback={null}>
        <SearchParamToast toasts={TWENTY_SETUP_FLASH_TOASTS} />
      </Suspense>

      <Tabs defaultValue="setup" className="w-full">
        <TabsListRow aria-label="Twenty CRM connector setup">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          {/* Help is RESERVED and ALWAYS LAST. */}
          <TabsTrigger value="help">Help</TabsTrigger>
        </TabsListRow>

        {/* SETUP — the single-connection two-column body. Stays Wide. */}
        <TabsContent
          value="setup"
          forceMount
          className="mt-6 data-[state=inactive]:hidden"
        >
          <ConnectorSetupColumns
            conformanceId="connector-setup"
            state="ready"
            fields={
              !viewer.isAdmin ? (
                <p className="rounded-panel border border-dashed border-line bg-surface-muted px-5 py-5 text-sm text-muted-foreground">
                  {connected
                    ? `Connected to ${instanceUrl}. Only an administrator can change this connection.`
                    : "A Twenty workspace has not been connected yet. Ask an administrator to connect one on this page."}
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {!connectionServiceReady ? (
                    <div className="rounded-control border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                      The connection service is not configured yet, so the key
                      cannot be stored. An administrator must run
                      {" "}
                      <code className="font-mono">cinatra setup nango</code> first.
                    </div>
                  ) : null}
                  <form action={saveTwentyConnectionAction} className="grid gap-4">
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="instanceUrl">Twenty instance URL</FieldLabel>
                        <Input
                          id="instanceUrl"
                          name="instanceUrl"
                          type="url"
                          placeholder="https://crm.example.com"
                          defaultValue={instanceUrl ?? ""}
                          required
                        />
                        <FieldDescription>
                          The base URL of your Twenty instance (Cinatra derives the
                          REST and MCP endpoints from it).
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="apiKey">Twenty API key</FieldLabel>
                        <Input
                          id="apiKey"
                          name="apiKey"
                          type="password"
                          placeholder={connected ? "Enter a new key to replace the stored one" : "Paste your Twenty API key"}
                          autoComplete="off"
                          required
                        />
                        <FieldDescription>
                          Generate an API key in Twenty under Settings → APIs &amp;
                          Webhooks. Cinatra verifies the key against your instance
                          before saving it.
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                    {/* Actions side by side (spec section II "One connection"): the
                        icon-led Connect (joined plug) beside the destructive
                        Disconnect (unplug), which stays disabled until the
                        workspace is connected. Disconnect only opens the host
                        AlertDialog; its red confirm, beside Cancel, alone
                        submits the disconnect action. The dialog content is
                        portaled out of this form, so its form is not nested
                        here and never posts the typed key. */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Button type="submit" disabled={!connectionServiceReady}>
                        <PlugConnected aria-hidden="true" />
                        {connected ? "Update connection" : "Connect Twenty"}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="destructive" disabled={!connected}>
                            <Unplug aria-hidden="true" />
                            Disconnect
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Disconnect connector?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Disconnect this connector and remove its saved
                              configuration? It will stop working until you
                              connect it again.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <form action={disconnectTwentyConnectionAction}>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <Button type="submit" variant="destructive">
                                <Unplug aria-hidden="true" />
                                Disconnect
                              </Button>
                            </AlertDialogFooter>
                          </form>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </form>
                </div>
              )
            }
            aside={
              /* Connection status card (spec section II): heading over a divider,
                 the shared connected/disconnected badge language with the Check
                 action beneath it (the client island: pressing Check shows the
                 transient Checking badge until the probe re-reads the
                 workspace row), and (once connected) the current workspace
                 URL. No key handling. */
              <div className="rounded-panel border border-line bg-surface p-4">
                <div className="border-b border-line pb-2.5 text-sm font-bold text-foreground">
                  Connection status
                </div>
                <div className="mt-3.5">
                  <TwentyConnectionStatus initialStatus={connected ? "connected" : "disconnected"} />
                </div>
                {connected ? (
                  <div className="mt-3 min-w-0">
                    <p className="truncate text-xs text-muted-foreground">{instanceUrl}</p>
                    {instanceIsPrivate ? (
                      <p className="mt-1 text-xs text-warning">
                        This instance URL is private — reachable by Cinatra
                        server-side, but not by external LLM providers.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            }
          />
        </TabsContent>

        {/* HELP — reserved, always LAST, read-only (no form, no Save). Narrow. */}
        <TabsContent
          value="help"
          forceMount
          className="mt-6 flex max-w-xl flex-col gap-5 data-[state=inactive]:hidden"
        >
          <p className="text-sm leading-6 text-muted-foreground">
            Cinatra reads your Twenty CRM workspace's contacts, accounts, and
            lists through this connection so agents can look up, create, and
            update CRM records on your behalf. It does not read anything until
            a workspace is connected below.
          </p>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">Prerequisite</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Generate an API key in your Twenty instance under Settings →
              APIs &amp; Webhooks. You will also need the instance's base URL
              (for example <code className="font-mono">https://crm.example.com</code>).
            </p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">Connect your workspace</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              On the Setup tab, an administrator pastes the instance URL and
              API key and saves. Cinatra verifies the key against the instance
              before storing it in the connection service — the key is never
              shown again after saving. Use Disconnect to remove the
              connection; the connector stops working until it is connected
              again.
            </p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">One workspace, instance-wide</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              This connector holds a single, instance-global Twenty workspace
              connection — not a per-user connection. Only an administrator
              can connect, update, or disconnect it; everyone else sees its
              current status here.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </ConnectorSetupPage>
  );
}
