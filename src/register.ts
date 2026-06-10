// The twenty connector's `register(ctx)` server entry.
//
// Transport-registration cutover: the host no longer imports `registerTwentyProvider` — this entry
// registers the Twenty `CrmConnector` impl behind the `crm-provider`
// capability at activation. The host's CRM bridge
// (src/lib/register-crm-providers.ts) feeds the SDK provider registry's
// external resolver from this capability, so `lookupCrmProvider("twenty")`
// resolves without the host naming this package.
//
// SDK imports here are TYPE-ONLY (host-peer value-import gate): the provider
// impl travels as DATA through `ctx.capabilities`.

import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";
import { twentyConnector } from "./twenty-connector";

const PACKAGE_NAME = "@cinatra-ai/twenty-connector";

export function register(ctx: ExtensionHostContext): void {
  ctx.capabilities.registerProvider("crm-provider", {
    packageName: PACKAGE_NAME,
    impl: twentyConnector,
  });
}
