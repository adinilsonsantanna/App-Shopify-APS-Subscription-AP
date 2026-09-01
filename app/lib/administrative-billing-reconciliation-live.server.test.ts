import assert from "node:assert/strict";
import test from "node:test";
import { ADMINISTRATIVE_RECONCILIATION_QUERY } from "./administrative-billing-reconciliation.server";
import {
  ADMIN_LIVE_CONFIRMATION_PHRASE,
  handleAdministrativeBillingReconciliationLive,
  parseLiveTargets,
} from "./administrative-billing-reconciliation-live.server";

const liveTarget = {
  shop: "one.myshopify.com",
  subscriptionContractId: "gid://shopify/SubscriptionContract/10",
  subscriptionBillingAttemptId: "gid://shopify/SubscriptionBillingAttempt/20",
  shopifyOrderId: "gid://shopify/Order/30",
  cycleOriginTime: "2026-09-27T16:00:00Z",
  correlationId: "scope9-live-cycle",
};

const payload = {
  // no shop field here: shop must come from the authenticated session, never the body
  subscriptionContractId: liveTarget.subscriptionContractId,
  subscriptionBillingAttemptId: liveTarget.subscriptionBillingAttemptId,
  shopifyOrderId: liveTarget.shopifyOrderId,
  cycleOriginTime: liveTarget.cycleOriginTime,
  correlationId: liveTarget.correlationId,
  confirmation: ADMIN_LIVE_CONFIRMATION_PHRASE,
};

function request(body: any = payload, url = "https://app.test/app/billing-reconciliation/execute-live") {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function setup(overrides: Record<string, any> = {}) {
  let graphqlCalls = 0; const centralCalls: any[] = [], logs: any[] = [];
  const data = { shop: { id: "gid://shopify/Shop/1" }, subscriptionBillingAttempt: { id: liveTarget.subscriptionBillingAttemptId, originTime: liveTarget.cycleOriginTime, createdAt: "2026-08-27T17:28:44Z", completedAt: "2026-08-27T17:28:45Z", subscriptionContract: { id: liveTarget.subscriptionContractId }, state: { __typename: "SubscriptionBillingAttemptSuccessState", order: { id: liveTarget.shopifyOrderId, test: true, displayFinancialStatus: "PAID", processedAt: "2026-08-27T17:28:51.161Z", currentTotalPriceSet: { shopMoney: { amount: "50.19", currencyCode: "BRL" } }, transactions: [{ gateway: "bogus", test: true, status: "SUCCESS" }] } } } };
  const dependencies: any = {
    liveEnabled: true,
    liveTargets: [liveTarget],
    liveSecret: "live-secret",
    authenticate: async () => ({ session: { shop: liveTarget.shop, accessToken: "never-forward" }, admin: { graphql: async (q: string, o: any) => { graphqlCalls++; assert.ok(o.variables.attemptId === liveTarget.subscriptionBillingAttemptId); return Response.json({ data }); } } }),
    apiUrl: "https://central.test", apiKey: "central-secret", requestId: "req-test-123",
    fetchFn: async (url: any, init: any) => { centralCalls.push({ url, init }); return Response.json({ status: "reconciled", dryRun: false }); },
    logger: { error: (...args: any[]) => logs.push(args), info: (msg: string) => logs.push(msg) },
    ...overrides,
  };
  return { dependencies, data, centralCalls, logs, get graphqlCalls() { return graphqlCalls; } };
}

test("feature gate OFF blocks live before any authentication or Central call", async () => {
  const s = setup({ liveEnabled: false });
  const response = await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "live_disabled", requestId: "req-test-123" });
  assert.equal(s.graphqlCalls, 0);
  assert.equal(s.centralCalls.length, 0);
});

test("auth failure performs no GraphQL or Central call", async () => {
  const s = setup({ authenticate: async () => { throw new Response("unauthorized", { status: 401 }); } });
  const response = await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  assert.equal(response.status, 401);
  assert.equal(s.graphqlCalls, 0);
  assert.equal(s.centralCalls.length, 0);
});

test("non-authorized shop is rejected with no Central call", async () => {
  const s = setup({ liveTargets: [{ ...liveTarget, shop: "two.myshopify.com" }] });
  const response = await handleAdministrativeBillingReconciliationLive(new Request("https://app.test/app/billing-reconciliation/execute-live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), s.dependencies);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "shop_not_authorized", requestId: "req-test-123" });
  assert.equal(s.graphqlCalls, 0);
  assert.equal(s.centralCalls.length, 0);
});

test("missing live targets blocks with no Central call", async () => {
  const s = setup({ liveTargets: [] });
  const response = await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  assert.equal(response.status, 503);
  assert.equal(s.graphqlCalls, 0);
  assert.equal(s.centralCalls.length, 0);
});

test("different target than allowlist is rejected with no Central call", async () => {
  for (const field of ["subscriptionContractId", "subscriptionBillingAttemptId", "shopifyOrderId", "cycleOriginTime", "correlationId"] as const) {
    const s = setup();
    const body = { ...payload, [field]: field === "cycleOriginTime" ? "2026-10-27T16:00:00Z" : field === "correlationId" ? "scope9-other-cycle" : `${payload[field as "subscriptionContractId"]}1` };
    const response = await handleAdministrativeBillingReconciliationLive(request(body), s.dependencies);
    assert.equal(response.status, 403);
    assert.equal(s.graphqlCalls, 0);
    assert.equal(s.centralCalls.length, 0);
  }
});

test("incorrect confirmation is rejected with no Central call", async () => {
  const s = setup();
  const response = await handleAdministrativeBillingReconciliationLive(request({ ...payload, confirmation: "EXECUTAR DRY-RUN SEGURO" }), s.dependencies);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "live_confirmation_required", requestId: "req-test-123" });
  assert.equal(s.graphqlCalls, 0);
  assert.equal(s.centralCalls.length, 0);
});

test("invalid target format is rejected with no GraphQL or Central call", async () => {
  const s = setup();
  const response = await handleAdministrativeBillingReconciliationLive(request({ ...payload, subscriptionBillingAttemptId: "bogus" }), s.dependencies);
  assert.equal(response.status, 400);
  assert.equal(s.graphqlCalls, 0);
  assert.equal(s.centralCalls.length, 0);
});

test("Shopify read mismatch precondition fails closed with no Central call", async () => {
  for (const mutate of [
    (d: any) => { d.subscriptionBillingAttempt.state.order.test = false; },
    (d: any) => { d.subscriptionBillingAttempt.state.order.transactions[0].gateway = "other"; },
    (d: any) => { Reflect.deleteProperty(d.subscriptionBillingAttempt.state.order, "processedAt"); },
    (d: any) => { d.subscriptionBillingAttempt.state.__typename = "SubscriptionBillingAttemptPendingState"; },
  ]) {
    const s = setup();
    mutate(s.data);
    const response = await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
    assert.equal(response.status, 409);
    assert.equal(s.centralCalls.length, 0);
  }
});

test("valid live emits exactly one Central call with dryRun false and live secret header", async () => {
  const s = setup();
  const response = await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  assert.equal(response.status, 200);
  assert.equal(s.graphqlCalls, 1);
  assert.equal(s.centralCalls.length, 1);
  const init = s.centralCalls[0].init;
  assert.equal(init.headers["x-api-key"], "central-secret");
  assert.equal(init.headers["x-admin-live-key"], "live-secret");
  const body = JSON.parse(init.body);
  assert.equal(body.dryRun, false);
  assert.equal(body.shopDomain, liveTarget.shop);
  assert.equal(body.amount, "50.19");
  assert.equal(body.currencyCode, "BRL");
  assert.equal(body.attemptedAt, "2026-08-27T17:28:45Z");
  assert.equal(body.completedAt, "2026-08-27T17:28:45Z");
  assert.equal(body.orderProcessedAt, "2026-08-27T17:28:51.161Z");
  assert.equal(body.correlationId, liveTarget.correlationId);
});

test("browser cannot set dryRun; unexpected fields fail closed", async () => {
  for (const dryRun of [true, false]) {
    const s = setup();
    const response = await handleAdministrativeBillingReconciliationLive(request({ ...payload, dryRun }), s.dependencies);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "unexpected_field", requestId: "req-test-123" });
    assert.equal(s.graphqlCalls, 0);
    assert.equal(s.centralCalls.length, 0);
  }
});

test("live allowlist parser rejects malformed, extra-key and duplicate-shop targets", () => {
  assert.deepEqual(parseLiveTargets("not-json"), []);
  assert.deepEqual(parseLiveTargets(JSON.stringify([{ ...liveTarget, shopifyOrderId: "bad" }])), []);
  assert.deepEqual(parseLiveTargets(JSON.stringify([{ ...liveTarget, extra: true }])), []);
  assert.deepEqual(parseLiveTargets(JSON.stringify([liveTarget, { ...liveTarget, correlationId: "scope9-other" }])), []);
  assert.deepEqual(parseLiveTargets(JSON.stringify([liveTarget])), [liveTarget]);
});

test("authentication stages are observable without secrets", async () => {
  const s = setup();
  await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  const serialized = JSON.stringify(s.logs);
  assert.equal(serialized.includes("live_authentication_started"), true);
  assert.equal(serialized.includes("live_authentication_completed"), true);
});

test("query is statically read-only and has no financial mutation surface", () => {
  assert.match(ADMINISTRATIVE_RECONCILIATION_QUERY, /^#graphql\s*query/);
  for (const forbidden of ["subscriptionBillingAttemptCreate", "orderCreate", "mutation", "stripe", "email", "webhook"]) {
    assert.equal(ADMINISTRATIVE_RECONCILIATION_QUERY.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});

test("secrets and tokens never appear in logs or the response", async () => {
  const s = setup();
  const response = await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  const serialized = JSON.stringify({ logs: s.logs, response: await response.json() });
  assert.equal(serialized.includes("never-forward"), false);
  assert.equal(serialized.includes("central-secret"), false);
  assert.equal(serialized.includes("live-secret"), false);
});

test("non-2xx Central JSON error preserves the error code and requestId", async () => {
  const s = setup({ fetchFn: async () => Response.json({ error: "reconciliation_payload_conflict", requestId: "central-req" }, { status: 409 }) });
  const response = await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "reconciliation_payload_conflict", requestId: "req-test-123" });
});

test("non-JSON Central error is sanitized to a JSON 502 with requestId", async () => {
  const s = setup({ fetchFn: async () => new Response("<html>error page with secret</html>", { status: 502, headers: { "content-type": "text/html" } }) });
  const response = await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "central_api_error", requestId: "req-test-123" });
  assert.equal(JSON.stringify(s.logs).includes("secret"), false);
});

test("missing live secret blocks before Central call", async () => {
  const s = setup({ liveSecret: "" });
  const response = await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "live_secret_missing", requestId: "req-test-123" });
  assert.equal(s.centralCalls.length, 0);
});
