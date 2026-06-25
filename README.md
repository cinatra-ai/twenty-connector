# Twenty CRM

Twenty CRM connector for cinatra. Implements the `CrmConnector` interface and registers itself as the `twenty` provider behind the `crm-connector` facade, so all provider-agnostic `crm_*` operations (contacts, accounts, lists) route to a self-hosted Twenty workspace without any host-side code needing to name this package directly. The connector communicates with Twenty over the MCP `execute_tool` protocol, resolving the workspace server row and upstream bearer from the host's external MCP registry at call time. The setup page UI and API-key storage are scaffolded but not yet fully wired; bootstrap the workspace row manually or via the host's dev auto-setup hook. For local development, run `pnpm test` to execute unit tests and `pnpm lint` to check sources. Common failures: a `TwentyConfigError` means no enabled workspace row is registered in the external MCP registry; a `TwentyMcpError` with HTTP 401 means the bearer is missing or expired.

## Works with

- `@cinatra-ai/crm-connector` (the facade extension that resolves this provider)
- Self-hosted Twenty workspace registered as an external MCP server in cinatra's external MCP registry

## Capabilities

- `crm_*` contact and account operations map to Twenty MCP `execute_tool` catalog tools (`create_person`, `create_company`, `update_person`, `update_company`, `find_people`, `find_companies`, `find_one_person`, `find_one_company`)
- `inLists` Twenty View pattern for cinatra Lists: search, get, create, add member, remove member via `get_views` and `create_view`
- Multi-instance support via cinatra's connector-instance surface
- `twenty_status` and `twenty_instances_list` provider-specific MCP primitives (registered; handlers are stubs pending full wiring)
