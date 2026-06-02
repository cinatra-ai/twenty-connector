// twenty-connector setup page implementation.
//
// Admin-only. Shadcn primitives ONLY per CLAUDE.md design discipline:
//   - <Main> + <PageHeader> + <PageContent> shell
//   - <Card> chrome with <CardHeader><CardTitle><CardDescription/></CardHeader><CardContent>
//   - <FieldGroup><Field><FieldLabel><FieldDescription/></Field></FieldGroup> form primitives
//   - <StatusPill> for connection state
//   - <Button asChild> for deeplinks
//   - semantic tokens only (text-foreground, bg-surface, border-line)
//   - no emojis
//
// This scaffold ships the connector contract; the full setup flow (mint bearer
// + insert external_mcp_servers row + populate allowed_catalog_tools) is not yet
// wired.

import { Main, PageHeader, PageContent } from "@cinatra-ai/sdk-ui/marketplace";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card";

export async function TwentyConnectorSetupImpl() {
  return (
    <Main className="min-h-screen">
      <PageHeader
        title="Twenty CRM connector"
        description="Configure cinatra's connection to a Twenty CRM instance (provider for the crm-connector facade)."
      />
      <PageContent className="flex flex-col gap-6 pb-8">
        <Card className="border-line bg-surface backdrop-blur-none">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription className="text-muted-foreground">
              This scaffold ships the connector contract, the MCP primitives, and the
              two-layer enforcement schema. The full setup flow (mint API-key bearer + insert
              the external_mcp_servers row + populate the Layer B catalog allowlist) is not yet
              wired, alongside the resolver and the encrypted bearer store.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-foreground">
              The full setup flow is not yet available — bootstrap manually via the docker stack (<code>docker compose --profile twenty up</code>).
            </p>
          </CardContent>
        </Card>
      </PageContent>
    </Main>
  );
}
