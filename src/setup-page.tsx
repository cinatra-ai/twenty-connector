// Thin server-component entry for the twenty-connector setup page.
// Host mounts this at `/connectors/cinatra-ai/twenty-connector/setup` via
// `src/lib/connector-setup-pages.ts`.

import { TwentyConnectorSetupImpl } from "./twenty-setup-impl";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function TwentyConnectorSetupPage(props?: {
  searchParams?: Promise<SearchParams>;
}) {
  return <TwentyConnectorSetupImpl searchParams={props?.searchParams} />;
}
