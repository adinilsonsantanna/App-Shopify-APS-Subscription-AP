# APS Subscription full-cycle test plan (Shopify App)

The authoritative scenario matrix, safety gates, correlation IDs, rollback rules, and live-test backlog live in the API Central repository at `docs/full-cycle-test-plan.md`. This App repository owns the Shopify boundary evidence:

| Boundary | Automated suite | Expected contract |
|---|---|---|
| Authenticated webhooks | `shopify-webhook-forwarder.server.test.ts` | Separate webhook/event IDs, enriched contract/lines, shared deadline, retryable upstream failure, no secret logs |
| Inventory and billing | `retry-operation.server.test.ts` | Tenant session match, 401 without key, aggregated inventory, stable idempotency key, normalized attempt/order/money envelope |
| Lifecycle | `subscription-lifecycle.server.test.ts` | Pause/resume/cancel with valid actor, reconciliation and safe timeout |
| Initial/recurring order identity | `recurring-order-idempotency.server.test.ts` | Stable tenant-scoped identity and no duplicate order |
| Uninstall | `shopify-webhook-forwarder.server.test.ts` | Forward before session deletion; redelivery without session is idempotent |

Commands are `npm test`, `npm run test:integration`, `npm run test:contract`, `npm run test:full-cycle`, and `npm run test:live:dry-run`. The live runner is disabled by default, refuses Betterlife, requires an explicit development-store allowlist and test gateway, prints its plan, and never mutates external state.

Live Shopify assertions remain pending until a disposable development store and explicit authorization are supplied. No ordinary CI job may enable them.

## Exact App evidence

| Scenario | Exact automated test name | File | Script | Layer | Evidence | Status |
|---|---|---|---|---|---|---|
| 1-3 Correlated boundary | `authenticated production adapters preserve one correlation envelope from webhook to recurring order` | `app/lib/full-cycle-boundary.server.test.ts` | `test:full-cycle` | authenticated adapter/controller | same shop, contract, cycle idempotency key, attempt, order and money | AUTOMATED |
| 2 Events | `forwards webhook delivery and Shopify event identifiers separately`; `uses one total deadline for authentication and GraphQL` | `app/lib/shopify-webhook-forwarder.server.test.ts` | `test:contract` | webhook adapter | distinct IDs and retryable deadline | AUTOMATED |
| 4 Inventory | `exact inventory is sufficient`; `removed variant blocks`; `untracked and CONTINUE do not block`; `aggregates duplicate variant quantities` | `app/lib/retry-operation.server.test.ts` | `test:integration` | Admin GraphQL adapter | policy outcomes and summed quantities | AUTOMATED |
| 5-6 Billing | `failed charge returns normalized Shopify error`; `reconciles a pending attempt by id and idempotency key`; `timeout uses standard uncertain envelope` | `app/lib/retry-operation.server.test.ts` | `test:full-cycle` | Admin GraphQL adapter | failed/UNCERTAIN/reconciled envelopes | AUTOMATED |
| 7 Lifecycle | `executes pause, resume and cancel with actor`; `already applied action is reconciled without repeating the mutation` | `app/lib/subscription-lifecycle.server.test.ts` | `test:full-cycle` | controller/adapter | three actions and idempotent reconciliation | AUTOMATED |
| 9 Security | `internal endpoint without x-api-key returns 401`; `internal endpoint rejects a wrong key and accepts the Central API key without logging it` | `app/lib/retry-operation.server.test.ts` | `test:integration` | controller/auth | 401/403/200, session shop and secret-free observations | AUTOMATED |
| 10 Concurrency | `two concurrent requests create one Shopify order`; `database failure after Shopify response recovers without duplicate` | `app/lib/recurring-order-idempotency.server.test.ts` | `test:integration` | repository/adapter | one order and recoverable persisted identity | AUTOMATED |
| 12 Uninstall | `uninstall forwards to the Central API before deleting sessions`; `uninstall redelivery is idempotent when the authenticated session is already gone` | `app/lib/shopify-webhook-forwarder.server.test.ts` | `test:contract` | webhook/session | ordered cleanup and safe redelivery | AUTOMATED |
| Shared request/response | `App request and response conform to the canonical API v1 contract` | `app/lib/subscription-cycle-contract.server.test.ts` | `test:contract` | cross-repository contract | imports API canonical v1 validator; incompatible fields/enums fail | AUTOMATED |
| Live platform proof | Signed Shopify/test-gateway flow and cleanup | future live evidence artifact | guarded live executor | platform | disposable-shop IDs and correlation-only cleanup | LIVE_PENDING |

The App live-safety tests import the canonical policy directly from the adjacent API repository. This intentionally fails fast if the paired checkout or canonical contract disappears; it avoids independently copied schemas/policies drifting between PRs.
