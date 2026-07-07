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
// Shadcn-style primitives ONLY per the connector's design discipline: the
// registry-vendored card stays in ./components/ui; the connector-OWNED trimmed
// form primitives (custom exports, dependency-light) live in ./ui so the host's
// vendored-primitive provenance gate doesn't mistake them for registry copies
// (both dirs are ui-design-system-gate carve-outs):
//   - <Main> + <PageHeader> + <PageContent> shell
//   - <Card> chrome, <Button> / <Badge> / <Input> / <Field*> primitives
//   - semantic tokens only (text-foreground, bg-surface, border-line); no emojis

import { Main, PageHeader, PageContent } from "@cinatra-ai/sdk-ui/marketplace";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./components/ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { FieldGroup, Field, FieldLabel, FieldDescription } from "./ui/field";
import { getTwentyDeps } from "./deps";
// Connector-local "use server" actions (cinatra#1097): the forms bind these
// compiler-minted references — never the deps-slot instances, which carry no
// server-reference metadata of their own (see ./actions for the full story).
import {
  saveTwentyConnectionAction,
  disconnectTwentyConnectionAction,
} from "./actions";
import { TWENTY_WORKSPACE_ROW_ID } from "./twenty-mcp-call";

type SearchParams = Record<string, string | string[] | undefined>;

function pickParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function TwentyConnectorSetupImpl(props?: {
  searchParams?: Promise<SearchParams>;
}) {
  const deps = getTwentyDeps();
  const viewer = await deps.resolveViewerContext();
  const row = deps.getServerById(TWENTY_WORKSPACE_ROW_ID);
  const connected = Boolean(row?.enabled && row?.nangoConnectionId);
  const instanceUrl = row ? row.serverUrl.replace(/\/mcp$/i, "") : null;
  const connectionServiceReady = deps.isConnectionServiceReady();
  const instanceIsPrivate = instanceUrl ? deps.isPrivateUrl(instanceUrl) : false;

  const resolvedSearchParams = (await props?.searchParams) ?? {};
  const saved = pickParam(resolvedSearchParams.saved);
  const deleted = pickParam(resolvedSearchParams.deleted);
  const errorMessage = pickParam(resolvedSearchParams.error);

  return (
    <Main className="min-h-screen">
      <PageHeader
        title="Twenty CRM"
        description="Connect a Twenty CRM workspace so Cinatra agents can read its contacts, accounts, and lists."
      />
      <PageContent className="flex flex-col gap-6 pb-8">
        <Card className="border-line bg-surface backdrop-blur-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Connection</CardTitle>
              <Badge variant={connected ? "outline" : "secondary"} className="uppercase">
                {connected ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <CardDescription className="text-muted-foreground">
              Cinatra stores your Twenty API key securely in the connection
              service and uses it to reach your workspace on your behalf. The key
              is entered here once and is never shown again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {saved ? (
              <div className="rounded-control border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                Twenty workspace connected.
              </div>
            ) : null}
            {deleted ? (
              <div className="rounded-control border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                Twenty workspace disconnected.
              </div>
            ) : null}
            {errorMessage ? (
              <div className="rounded-control border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {errorMessage}
              </div>
            ) : null}

            {!viewer.isAdmin ? (
              <p className="rounded-panel border border-dashed border-line bg-surface-muted px-5 py-5 text-sm text-muted-foreground">
                {connected
                  ? `Connected to ${instanceUrl}. Only an administrator can change this connection.`
                  : "A Twenty workspace has not been connected yet. Ask an administrator to connect one on this page."}
              </p>
            ) : (
              <>
                {connected ? (
                  <section className="flex flex-col gap-3">
                    <div className="rounded-panel border border-line bg-surface px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-semibold text-foreground">
                            Current workspace
                          </h3>
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {instanceUrl}
                          </p>
                          {instanceIsPrivate ? (
                            <p className="mt-1 text-xs text-warning">
                              This instance URL is private — reachable by Cinatra
                              server-side, but not by external LLM providers.
                            </p>
                          ) : null}
                        </div>
                        <form action={disconnectTwentyConnectionAction}>
                          <Button type="submit" variant="destructive" size="sm">
                            Disconnect
                          </Button>
                        </form>
                      </div>
                    </div>
                  </section>
                ) : null}

                <section className="flex flex-col gap-4">
                  <h3 className="text-lg font-semibold text-foreground">
                    {connected ? "Update connection" : "Connect a workspace"}
                  </h3>
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
                    <div className="flex justify-end">
                      <Button type="submit" disabled={!connectionServiceReady}>
                        {connected ? "Update connection" : "Connect Twenty"}
                      </Button>
                    </div>
                  </form>
                </section>
              </>
            )}
          </CardContent>
        </Card>
      </PageContent>
    </Main>
  );
}
