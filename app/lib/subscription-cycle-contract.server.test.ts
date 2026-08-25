import assert from "node:assert/strict";
import test from "node:test";
import { SUBSCRIPTION_CYCLE_CONTRACT_VERSION, validateContractStatus, validateRetryRequest, validateRetryResponse } from "../contracts/subscription-cycle.v1.generated";
import { handleRetryOperation } from "./retry-operation.server";

test("App request and response conform to the canonical API v1 contract", async () => {
  assert.equal(SUBSCRIPTION_CYCLE_CONTRACT_VERSION, "aps.subscription-cycle.v1");
  const body = { shop: "one.myshopify.com", contractId: "gid://shopify/SubscriptionContract/1", operation: "charge", idempotencyKey: "scope9:contract:1", billingCycleAt: "2026-08-31T12:00:00.000Z" };
  assert.equal(validateRetryRequest(body), true);
  const response = await handleRetryOperation(new Request("https://app.test/api/shopify/retry-operation", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "secret", "idempotency-key": body.idempotencyKey }, body: JSON.stringify(body) }), { apiKey: "secret", getAdmin: async shop => ({ session: { shop }, admin: { graphql: async () => Response.json({ data: { subscriptionBillingAttemptCreate: { subscriptionBillingAttempt: { id: "gid://shopify/SubscriptionBillingAttempt/1", ready: true, order: { id: "gid://shopify/Order/1", currentTotalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "BRL" } } }, userErrors: [] } } } }) } }) });
  assert.equal(validateContractStatus(response.status), true);
  assert.equal(validateRetryResponse(await response.json()), true);
});

test("canonical status contract covers missing wrong correct keys conflicts throttling failures and timeout", () => { for (const status of [400, 401, 403, 409, 429, 500, 502, 503, 504]) assert.equal(validateContractStatus(status), true); });
