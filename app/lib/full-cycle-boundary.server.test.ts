import assert from "node:assert/strict";
import test from "node:test";
import { createShopifyWebhookForwarder } from "./shopify-webhook-forwarder.server";
import { handleRetryOperation } from "./retry-operation.server";

test("authenticated production adapters preserve one correlation envelope from webhook to recurring order", async () => {
  const correlationId = "scope9:shop-a:cycle-2026-08", contractId = "gid://shopify/SubscriptionContract/9";
  let forwarded: any;
  const forward = createShopifyWebhookForwarder({
    fetchFn: async (_url, init) => { forwarded = JSON.parse(String(init?.body)); return Response.json({ processed: true }); },
    environment: { API_SUBSCRIPTION_URL: "https://central.example.test", API_KEY: "internal-secret" },
    now: () => new Date("2026-08-31T12:00:00.000Z"),
    loadContract: async () => ({ shopifyShopId: "gid://shopify/Shop/9", contract: { id: contractId, status: "ACTIVE", nextBillingAt: "2026-08-31T12:00:00.000Z", currencyCode: "BRL", originOrder: { id: "gid://shopify/Order/initial", amount: "99.90", currencyCode: "BRL", financialStatus: "PAID" }, customer: { id: "gid://shopify/Customer/9", email: "customer@example.test" }, billingPolicy: { interval: "MONTH", intervalCount: 1 }, deliveryPolicy: { interval: "MONTH", intervalCount: 1 }, lines: [{ id: "gid://shopify/SubscriptionLine/9", productId: "gid://shopify/Product/9", variantId: "gid://shopify/ProductVariant/9", sellingPlanId: "gid://shopify/SellingPlan/9", quantity: 2, currentPrice: { amount: "49.95", currencyCode: "BRL" } }] } }),
    logger: { info() {}, error() {} },
  });
  const request = new Request("https://app.example.test/webhook", { method: "POST" });
  await forward(request, "subscription_contracts/create", { shop: "shop-a.myshopify.com", topic: "SUBSCRIPTION_CONTRACTS_CREATE", payload: { admin_graphql_api_id: contractId, revision_id: "revision-1" }, webhookId: `${correlationId}:webhook:first`, eventId: `${correlationId}:event:first`, triggeredAt: "2026-08-31T12:00:00.000Z", admin: { graphql: async () => Response.json({}) } });
  assert.equal(forwarded.contract.id, contractId);
  assert.equal(forwarded.contract.lines[0].sellingPlanId, "gid://shopify/SellingPlan/9");
  assert.notEqual(forwarded.webhookId, forwarded.shopifyEventId);

  const idempotencyKey = `${correlationId}:payment:0`;
  const response = await handleRetryOperation(new Request("https://app.example.test/api/shopify/retry-operation", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "internal-secret", "idempotency-key": idempotencyKey }, body: JSON.stringify({ shop: forwarded.shop, contractId, operation: "charge", billingCycleAt: forwarded.contract.nextBillingAt, idempotencyKey }) }), {
    apiKey: "internal-secret",
    getAdmin: async shop => ({ session: { shop }, admin: { graphql: async (_query, options) => { assert.deepEqual(options.variables, { contractId, input: { idempotencyKey, originTime: "2026-08-31T12:00:00.000Z", billingCycleSelector: { date: "2026-08-31T12:00:00.000Z" } } }); return Response.json({ data: { subscriptionBillingAttemptCreate: { subscriptionBillingAttempt: { id: "gid://shopify/SubscriptionBillingAttempt/9", ready: true, order: { id: "gid://shopify/Order/recurring", currentTotalPriceSet: { shopMoney: { amount: "99.90", currencyCode: "BRL" } } }, userErrors: [] }, userErrors: [] } } }); } } }),
  });
  const result = await response.json() as any;
  assert.deepEqual({ status: response.status, success: result.success, attempt: result.billingAttemptId, order: result.orderId, amount: result.amount, currency: result.currencyCode }, { status: 200, success: true, attempt: "gid://shopify/SubscriptionBillingAttempt/9", order: "gid://shopify/Order/recurring", amount: "99.90", currency: "BRL" });
});
