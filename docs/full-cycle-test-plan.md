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
