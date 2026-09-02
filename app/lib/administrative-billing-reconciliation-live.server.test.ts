import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ADMINISTRATIVE_RECONCILIATION_QUERY } from "./administrative-billing-reconciliation.server";
import {
  type AdminReconciliationLiveDependencies,
  ADMIN_LIVE_CONFIRMATION_PHRASE,
  handleAdministrativeBillingReconciliationLive,
  parseLiveTargets,
  selectAuthenticatedLiveTarget,
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

function request(body: unknown = payload, url = "https://app.test/app/billing-reconciliation/execute-live") {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function makeGraphqlData() {
  return { shop: { id: "gid://shopify/Shop/1" }, subscriptionBillingAttempt: { id: liveTarget.subscriptionBillingAttemptId, originTime: liveTarget.cycleOriginTime, createdAt: "2026-08-27T17:28:44Z", completedAt: "2026-08-27T17:28:45Z", subscriptionContract: { id: liveTarget.subscriptionContractId }, state: { __typename: "SubscriptionBillingAttemptSuccessState", order: { id: liveTarget.shopifyOrderId, test: true, displayFinancialStatus: "PAID", processedAt: "2026-08-27T17:28:51.161Z", currentTotalPriceSet: { shopMoney: { amount: "50.19", currencyCode: "BRL" } }, transactions: [{ gateway: "bogus", test: true, status: "SUCCESS" }] } } } };
}

type GraphqlData = ReturnType<typeof makeGraphqlData>;
type CentralCall = { input: string | URL | Request; init?: RequestInit };

function setup(overrides: Partial<AdminReconciliationLiveDependencies> = {}) {
  let graphqlCalls = 0;
  const centralCalls: CentralCall[] = [];
  const logs: unknown[] = [];
  const data = makeGraphqlData();
  const fetchFn: typeof fetch = async (input, init) => {
    centralCalls.push({ input, init });
    return Response.json({ status: "reconciled", dryRun: false });
  };
  const logger: Pick<Console, "error" | "info"> = {
    error: (...args) => { logs.push(args); },
    info: (...args) => { logs.push(args); },
  };
  const dependencies: AdminReconciliationLiveDependencies = {
    liveEnabled: true,
    liveTargets: [liveTarget],
    liveSecret: "live-secret",
    authenticate: async () => ({ session: { shop: liveTarget.shop, accessToken: "never-forward" }, admin: { graphql: async (query: string, options: { variables: Record<string, unknown> }) => { graphqlCalls++; assert.equal(query, ADMINISTRATIVE_RECONCILIATION_QUERY); assert.equal(options.variables.attemptId, liveTarget.subscriptionBillingAttemptId); return Response.json({ data }); } } }),
    apiUrl: "https://central.test", apiKey: "central-secret", requestId: "req-test-123",
    fetchFn,
    logger,
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
  for (const confirmation of [" EXECUTAR RECONCILIAÇÃO LIVE", "EXECUTAR RECONCILIAÇÃO LIVE ", "executar reconciliação live", "EXECUTAR DRY-RUN SEGURO"]) {
    const s = setup();
    const response = await handleAdministrativeBillingReconciliationLive(request({ ...payload, confirmation }), s.dependencies);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "live_confirmation_required", requestId: "req-test-123" });
    assert.equal(s.graphqlCalls, 0);
    assert.equal(s.centralCalls.length, 0);
  }
});

test("live body requires application/json before Shopify or Central operations", async () => {
  for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    const s = setup();
    const headers: Record<string, string> = {};
    if (contentType) headers["content-type"] = contentType;
    const response = await handleAdministrativeBillingReconciliationLive(new Request("https://app.test/app/billing-reconciliation/execute-live", { method: "POST", headers, body: JSON.stringify(payload) }), s.dependencies);
    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), { error: "unsupported_content_type", requestId: "req-test-123" });
    assert.equal(s.graphqlCalls, 0);
    assert.equal(s.centralCalls.length, 0);
  }
});

test("live body rejects declared and actual payloads above 4 KiB", async () => {
  for (const body of [JSON.stringify(payload), JSON.stringify({ ...payload, padding: "x".repeat(4096) })]) {
    const s = setup();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (body === JSON.stringify(payload)) headers["content-length"] = "4097";
    const response = await handleAdministrativeBillingReconciliationLive(new Request("https://app.test/app/billing-reconciliation/execute-live", { method: "POST", headers, body }), s.dependencies);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "payload_too_large", requestId: "req-test-123" });
    assert.equal(s.centralCalls.length, 0);
  }
});

test("malformed live JSON returns sanitized JSON 400 with requestId", async () => {
  const s = setup();
  const response = await handleAdministrativeBillingReconciliationLive(new Request("https://app.test/app/billing-reconciliation/execute-live", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }), s.dependencies);
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "invalid_json", requestId: "req-test-123" });
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
    (data: GraphqlData) => { data.subscriptionBillingAttempt.state.order.test = false; },
    (data: GraphqlData) => { data.subscriptionBillingAttempt.state.order.transactions[0].gateway = "other"; },
    (data: GraphqlData) => { Reflect.deleteProperty(data.subscriptionBillingAttempt.state.order, "processedAt"); },
    (data: GraphqlData) => { data.subscriptionBillingAttempt.state.__typename = "SubscriptionBillingAttemptPendingState"; },
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
  assert.ok(init);
  const headers = new Headers(init.headers);
  assert.equal(headers.get("x-api-key"), "central-secret");
  assert.equal(headers.get("x-admin-live-key"), "live-secret");
  if (typeof init.body !== "string") assert.fail("expected JSON string body");
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

test("authenticated shop selects only its target independent of allowlist order", () => {
  const targetA = { ...liveTarget, shop: "a.myshopify.com", correlationId: "scope9-shop-a" };
  const targetB = { ...liveTarget, shop: "b.myshopify.com", correlationId: "scope9-shop-b", subscriptionBillingAttemptId: "gid://shopify/SubscriptionBillingAttempt/21" };
  assert.deepEqual(selectAuthenticatedLiveTarget("a.myshopify.com", [targetB, targetA]), targetA);
  assert.deepEqual(selectAuthenticatedLiveTarget("B.MYSHOPIFY.COM", [targetA, targetB]), targetB);
  assert.deepEqual(selectAuthenticatedLiveTarget("a.myshopify.com", [targetA, targetB]), targetA);
});

test("authenticated target selection fails closed without exact unique shop match", () => {
  const targetA = { ...liveTarget, shop: "a.myshopify.com", correlationId: "scope9-shop-a" };
  const duplicateA = { ...targetA, correlationId: "scope9-shop-a-duplicate", shopifyOrderId: "gid://shopify/Order/31" };
  for (const shop of ["unknown.myshopify.com", "a.myshopify.com.evil.test", "evil-a.myshopify.com", " a.myshopify.com", ""]) {
    assert.equal(selectAuthenticatedLiveTarget(shop, [targetA]), null);
  }
  assert.equal(selectAuthenticatedLiveTarget("a.myshopify.com", [targetA, duplicateA]), null);
  assert.equal(selectAuthenticatedLiveTarget("a.myshopify.com", []), null);
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

test("outbound Central body has exactly 16 keys and never includes confirmation", async () => {
  const s = setup();
  await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  const init = s.centralCalls[0].init;
  assert.ok(init);
  if (typeof init.body !== "string") assert.fail("expected JSON string body");
  const body = JSON.parse(init.body);
  assert.equal(Object.keys(body).length, 16);
  assert.equal("confirmation" in body, false);
  for (const value of Object.values(body)) assert.notEqual(typeof value, "undefined");
});

test("pre-Central log emits key names, count and deterministic SHA-256 fingerprint without values", async () => {
  const s = setup();
  await handleAdministrativeBillingReconciliationLive(request(), s.dependencies);
  const raw = JSON.stringify(s.logs);
  const expectedKeys = ["amount", "attemptedAt", "completedAt", "correlationId", "currencyCode", "cycleOriginTime", "dryRun", "gateway", "orderProcessedAt", "shopDomain", "shopId", "status", "subscriptionBillingAttemptId", "subscriptionContractId", "test", "shopifyOrderId"].sort();
  const expectedFingerprint = createHash("sha256").update(JSON.stringify(expectedKeys)).digest("hex");
  const outbound = s.logs.map((args) => (args as unknown[]).find((arg): arg is string => typeof arg === "string" && arg.includes("central_live_outbound_keys"))).find((value): value is string => typeof value === "string");
  assert.ok(outbound, "central_live_outbound_keys log missing");
  const parsed = JSON.parse(outbound) as Record<string, unknown>;
  assert.equal(parsed.event, "central_live_outbound_keys");
  assert.equal(parsed.keyCount, 16);
  assert.equal(parsed.fingerprint, expectedFingerprint);
  assert.equal(parsed.keyNames, expectedKeys.join(","));
  assert.equal(parsed.correlationId, "scope9-live-cycle");
  assert.equal(parsed.requestId, "req-test-123");
  assert.equal(raw.includes("50.19"), false);
  assert.equal(raw.includes("gid://shopify/Order/30"), false);
  assert.equal(raw.includes("EXECUTAR"), false);
  assert.equal(raw.includes("central-secret"), false);
  assert.equal(raw.includes("live-secret"), false);
});

test("post-Central log includes sanitized centralRequestId when present and omits it otherwise", async () => {
  const withId = setup({ fetchFn: async () => Response.json({ status: "reconciled", requestId: "central-req-42" }) });
  await handleAdministrativeBillingReconciliationLive(request(), withId.dependencies);
  const entryId = JSON.stringify(withId.logs);
  assert.equal(entryId.includes("central_live_response"), true);
  assert.equal(entryId.includes("central-req-42"), true);

  const withoutId = setup();
  await handleAdministrativeBillingReconciliationLive(request(), withoutId.dependencies);
  const entryNoId = JSON.stringify(withoutId.logs);
  assert.equal(entryNoId.includes("central_live_response"), true);
  assert.equal(entryNoId.includes("centralRequestId"), false);
});
