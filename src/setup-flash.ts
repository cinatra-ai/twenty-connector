// -----------------------------------------------------------------------------
// twenty-connector setup-page codes-only flash protocol
// (twenty-connector#51, epic cinatra-ai/cinatra#1107 S9).
//
// The setup page's connect/disconnect forms bind the connector-local
// "use server" actions (./actions.ts), which forward to the HOST
// implementations (cinatra src/app/campaigns/actions.ts:
// saveTwentyConnectionAction / disconnectTwentyConnectionAction). Those host
// actions own the redirect: on success they append `?saved=1` / `?deleted=1`;
// on failure `?error=<message>`. The <SearchParamToast> island mounted in
// twenty-setup-impl.tsx reads those params ONCE and maps them to a STATIC
// message here — it never toasts URL-derived text.
//
// `saved` / `deleted` are stable boolean flags. `error` is, as of this
// writing, still FREE TEXT on the host side (the host action has not yet
// adopted the sdk-extensions `flashHref` codes-only builder — that alignment
// is the epic's S2, a separate cinatra-repo issue/PR). Toasting that text
// verbatim would reflect a URL-controlled string into the page — a crafted
// `?error=<anything>` link — which is exactly what the codes-only protocol
// exists to prevent. Until the host emits a stable code, the `error` entry
// below has NO `value` (SearchParamToast fires it on any non-empty value) and
// shows one generic, server-authored message; the actual query text is never
// read into the toast. When S2 lands a stable Twenty error code, this entry
// should narrow to per-code messages the same way src/app/setup/setup-flash.ts
// does on the host.
// -----------------------------------------------------------------------------

import type { SearchParamToastConfig } from "@cinatra-ai/sdk-ui/search-param-toast";

export const TWENTY_SETUP_FLASH_TOASTS: SearchParamToastConfig[] = [
  {
    param: "saved",
    value: "1",
    message: "Twenty workspace connected.",
    variant: "success",
  },
  {
    param: "deleted",
    value: "1",
    message: "Twenty workspace disconnected.",
    variant: "warning",
  },
  {
    // No `value`: matches ANY non-empty ?error=..., and never reflects it —
    // see the module note above.
    param: "error",
    message:
      "Unable to save the Twenty connection. Check the instance URL and API key, then try again.",
    variant: "error",
  },
];
