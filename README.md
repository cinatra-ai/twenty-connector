# @cinatra-ai/twenty-connector

Twenty CRM provider for cinatra. Implements the `CrmConnector` interface from `@cinatra-ai/sdk-extensions` and registers itself into the SDK-hosted CRM provider registry (resolved by the `@cinatra-ai/crm-connector` facade). Exposes 2 provider-specific MCP primitives (`twenty_status`, `twenty_instances_list`).

## Works with

- `@cinatra-ai/sdk-extensions` (CRM contract + provider registry)
- `@cinatra-ai/crm-connector` (the facade that resolves this provider)
- Self-hosted Twenty (`twentycrm/twenty:v2.7.3`, via the docker stack in `docker-compose.yml --profile twenty`)

## Capabilities

- ✓ `crm_*` write primitives map to Twenty MCP `execute_tool` catalog tools (`create_company`, `create_person`, etc.) through the Layer B proxy
- ✓ Encrypted API-key bearer storage (no `client_credentials` upstream)
- ✓ `inLists` Twenty View pattern for cinatra Lists
- ✓ Multi-instance support via cinatra's connector-instance surface
