import assert from "node:assert/strict";
import test from "node:test";
import { handleSubscriptionLifecycle } from "./subscription-lifecycle.server";

const valid = { shop: "known.myshopify.com", contractId: "gid://shopify/SubscriptionContract/1", action: "pause", actor: "CUSTOMER", requestId: "request-1" };
function request(body: unknown = valid, key = "secret") { return new Request("https://app.test/api/shopify/subscription-lifecycle", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key }, body: JSON.stringify(body) }); }
function dependencies(result: unknown = { data: { subscriptionContractPause: { contract: { id: valid.contractId, status: "PAUSED" }, userErrors: [] } } }) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  return { calls, value: { apiKey: "secret", getAdmin: async () => ({ session: { shop: valid.shop }, admin: { graphql: async (query: string, options: { variables: Record<string, unknown> }) => { calls.push({ query, variables: options.variables }); return Response.json(result); } } }) } };
}

test("requires a valid API key", async () => { const deps = dependencies(); assert.equal((await handleSubscriptionLifecycle(request(valid, "wrong"), deps.value)).status, 403); assert.equal(deps.calls.length, 0); });
test("validates shop, contract and request ID", async () => { for (const body of [{ ...valid, shop: "evil.example.com" }, { ...valid, contractId: "sub_123" }, { ...valid, requestId: "" }]) assert.equal((await handleSubscriptionLifecycle(request(body), dependencies().value)).status, 400); });
test("returns controlled error when offline session is absent", async () => { const response = await handleSubscriptionLifecycle(request(), { apiKey: "secret", getAdmin: async () => ({ admin: {} as never }) }); assert.equal(response.status, 404); });
test("executes pause, resume and cancel with actor", async () => {
  for (const [action, field, status] of [["pause", "subscriptionContractPause", "PAUSED"], ["resume", "subscriptionContractActivate", "ACTIVE"], ["cancel", "subscriptionContractCancel", "CANCELLED"]] as const) {
    const deps = dependencies({ data: { [field]: { contract: { id: valid.contractId, status }, userErrors: [] } } });
    const response = await handleSubscriptionLifecycle(request({ ...valid, action, actor: "MERCHANT" }), deps.value);
    assert.equal(response.status, 200); assert.match(deps.calls[0].query, new RegExp(field)); assert.equal(deps.calls[0].variables.actor, "MERCHANT");
  }
});
test("never reports success for Shopify userErrors", async () => { const deps = dependencies({ data: { subscriptionContractPause: { contract: null, userErrors: [{ field: ["subscriptionContractId"], message: "Invalid" }] } } }); const response = await handleSubscriptionLifecycle(request(), deps.value); assert.equal(response.status, 422); assert.equal((await response.json() as { success: boolean }).success, false); });
test("normalizes GraphQL and timeout failures without exposing tokens", async () => { const graph = dependencies({ errors: [{ message: "private upstream detail" }] }); assert.equal((await handleSubscriptionLifecycle(request(), graph.value)).status, 502); const timeout = await handleSubscriptionLifecycle(request(), { apiKey: "secret", timeoutMs: 5, getAdmin: async () => ({ session: { shop: valid.shop }, admin: { graphql: (_q, options) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("secret-token")))) } }) }); assert.equal(timeout.status, 504); assert.equal(JSON.stringify(await timeout.json()).includes("secret-token"), false); });
