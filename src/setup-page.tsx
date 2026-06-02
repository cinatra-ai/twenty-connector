// Thin server-component entry for the twenty-connector setup page.
// Host mounts this at `/connectors/cinatra-ai/twenty-connector/setup` via
// `src/lib/connector-setup-pages.ts`.

import { TwentyConnectorSetupImpl } from "./twenty-setup-impl";

export default async function TwentyConnectorSetupPage() {
  return <TwentyConnectorSetupImpl />;
}
