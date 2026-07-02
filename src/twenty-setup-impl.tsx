// twenty-connector setup page implementation.
//
// User-facing setup surface for the Twenty CRM connector. Admin-only. Shadcn
// primitives ONLY per the connector's design discipline:
//   - <Main> + <PageHeader> + <PageContent> shell
//   - <Card> chrome with <CardHeader><CardTitle><CardDescription/></CardHeader><CardContent>
//   - semantic tokens only (text-foreground, text-muted-foreground, bg-surface, border-line)
//   - no emojis
//
// Connecting a Twenty workspace from the product UI is not available yet;
// the end-to-end connect flow is tracked as a follow-up (see issue #39).
// Until that lands, this page renders a plain, user-facing "not connected"
// state so an operator can read the connector's status at a glance.

import { Main, PageHeader, PageContent } from "@cinatra-ai/sdk-ui/marketplace";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card";

export async function TwentyConnectorSetupImpl() {
  return (
    <Main className="min-h-screen">
      <PageHeader
        title="Twenty CRM"
        description="Connect a Twenty CRM workspace so Cinatra agents can read and update its contacts, accounts, and lists."
      />
      <PageContent className="flex flex-col gap-6 pb-8">
        <Card className="border-line bg-surface backdrop-blur-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Connection</CardTitle>
              <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                Not available yet
              </span>
            </div>
            <CardDescription className="text-muted-foreground">
              Connecting a Twenty workspace from this screen is not available yet.
              Once it is enabled, you will add your Twenty instance URL and an API
              key here, and Cinatra will use them to reach your workspace on your
              behalf.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-foreground">
              In the meantime, a Twenty workspace can be connected by an
              administrator during environment setup. The self-service connect
              flow is being wired and will appear on this page once it is ready.
            </p>
          </CardContent>
        </Card>
      </PageContent>
    </Main>
  );
}
