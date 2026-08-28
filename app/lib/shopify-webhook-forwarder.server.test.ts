import test from "node:test";
import assert from "node:assert/strict";
import {
  createShopifyWebhookForwarder as createProductionShopifyWebhookForwarder,
  type AuthenticatedWebhookResult,
  type WebhookForwarderDependencies,
} from "./shopify-webhook-forwarder.server";
import { processAppUninstalledWebhook } from "./app-uninstalled.server";

type TestDependencies = WebhookForwarderDependencies & { authenticateWebhook(request: Request): Promise<AuthenticatedWebhookResult> };

function createShopifyWebhookForwarder(dependencies: TestDependencies) {
  const { authenticateWebhook, ...productionDependencies } = dependencies;
  const forward = createProductionShopifyWebhookForwarder(productionDependencies);
  return async (request: Request, topic: Parameters<typeof forward>[1], authenticated?: AuthenticatedWebhookResult) =>
    forward(request, topic, authenticated ?? await authenticateWebhook(request));
}

interface CapturedLog {
  message: string;
  metadata: Record<string, unknown>;
}

function request(method = "POST", webhookId = "webhook-1", eventId?: string) {
  const headers = webhookId ? { "x-shopify-webhook-id": webhookId, ...(eventId ? { "x-shopify-event-id": eventId } : {}) } : undefined;
  return new Request("https://app.example.test/webhooks/subscription_contracts/create", {
    method,
    headers,
  });
}

function dependencies(overrides: Partial<TestDependencies> = {}) {
  const logs: CapturedLog[] = [];
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const value: TestDependencies = {
    authenticateWebhook: async () => ({
      shop: "known.myshopify.com",
      topic: "SUBSCRIPTION_CONTRACTS_CREATE",
      payload: { admin_graphql_api_id: "gid://shopify/SubscriptionContract/1", revision_id: "revision-7", status: "active" },
      admin: { graphql: async () => new Response() },
    }),
    fetchFn: (async (input, init) => {
      calls.push({ input, init });
      return new Response(null, { status: 200 });
    }) as typeof fetch,
    environment: {
      API_SUBSCRIPTION_URL: "https://central.example.test",
      API_KEY: "super-secret-api-key",
    },
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    loadContract: async () => ({ shopifyShopId: "gid://shopify/Shop/123", contract: {
      id: "gid://shopify/SubscriptionContract/1",
      status: "ACTIVE",
      nextBillingAt: "2026-09-14T12:00:00.000Z",
      currencyCode: "BRL",
      originOrder: { id: "gid://shopify/Order/1", financialStatus: "PAID", amount: "99.90", currencyCode: "BRL", processedAt: "2026-08-14T12:00:00.000Z" },
      customer: { id: "gid://shopify/Customer/1", email: "customer@example.test", name: "Customer" },
      billingPolicy: { interval: "MONTH", intervalCount: 1 },
      deliveryPolicy: { interval: "MONTH", intervalCount: 1 },
      lines: [{ id: "gid://shopify/SubscriptionLine/1", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1, currentPrice: { amount: "99.90", currencyCode: "BRL" }, sellingPlanId: "gid://shopify/SellingPlan/1" }],
    } }),
    loadBillingAttempt: async () => ({ shopifyShopId: "gid://shopify/Shop/123", billingAttempt: {
      id: "gid://shopify/SubscriptionBillingAttempt/1", idempotencyKey: "cycle-1", cycleOriginTime: "2026-09-27T16:00:00.000Z", createdAt: "2026-08-28T12:00:00.000Z", completedAt: "2026-08-28T12:00:01.000Z", state: "succeeded", contractId: "gid://shopify/SubscriptionContract/1", nextBillingAt: "2026-10-27T16:00:00.000Z", order: { id: "gid://shopify/Order/2", processedAt: "2026-08-28T12:00:01.000Z", test: true, financialStatus: "PAID", amount: "50.19", currencyCode: "BRL", subtotal: "9.00", shipping: "41.19", tax: "0.00" }, reconciliationStatus: "complete",
    } }),
    logger: {
      error: (message, metadata) => logs.push({ message, metadata }),
      info: (message, metadata) => logs.push({ message, metadata }),
    },
    ...overrides,
  };

  return { value, calls, logs };
}

async function rejectsWithStatus(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error) => error instanceof Response && error.status === status);
}

test("rejects methods other than POST with 405", async () => {
  const setup = dependencies();
  const forward = createShopifyWebhookForwarder(setup.value);
  await rejectsWithStatus(forward(request("GET"), "subscription_contracts/create"), 405);
  assert.equal(setup.calls.length, 0);
});

test("rejects a topic that does not match the route with 400", async () => {
  const setup = dependencies({
    authenticateWebhook: async () => ({
      shop: "known.myshopify.com",
      topic: "SUBSCRIPTION_CONTRACTS_UPDATE",
      payload: {},
      admin: { graphql: async () => new Response() },
    }),
  });
  const forward = createShopifyWebhookForwarder(setup.value);
  await rejectsWithStatus(forward(request(), "subscription_contracts/create"), 400);
  assert.equal(setup.calls.length, 0);
});

test("rejects a webhook without an ID with 400", async () => {
  const setup = dependencies();
  const forward = createShopifyWebhookForwarder(setup.value);
  await rejectsWithStatus(forward(request("POST", ""), "subscription_contracts/create"), 400);
  assert.equal(setup.calls.length, 0);
});

test("reports only the missing environment variable name", async (context) => {
  for (const missing of ["API_SUBSCRIPTION_URL", "API_KEY"] as const) {
    await context.test(missing, async () => {
      const environment = {
        API_SUBSCRIPTION_URL: "https://central.example.test",
        API_KEY: "super-secret-api-key",
        [missing]: undefined,
      };
      const setup = dependencies({ environment });
      const forward = createShopifyWebhookForwarder(setup.value);
      await assert.rejects(
        forward(request(), "subscription_contracts/create"),
        (error) => error instanceof Error
          && error.message === `Missing required environment variable: ${missing}`,
      );
      assert.equal(setup.calls.length, 0);
    });
  }
});

test("returns a retryable error when the Central API fails", async () => {
  const setup = dependencies({
    fetchFn: (async () => new Response(null, { status: 503 })) as typeof fetch,
  });
  const forward = createShopifyWebhookForwarder(setup.value);
  await rejectsWithStatus(forward(request(), "subscription_contracts/create"), 502);
  assert.equal(setup.logs[0]?.metadata.status, 503);
});

test("forwards a successful webhook exactly once", async () => {
  const setup = dependencies();
  const forward = createShopifyWebhookForwarder(setup.value);
  await forward(request(), "subscription_contracts/create");

  assert.equal(setup.calls.length, 1);
  assert.equal(String(setup.calls[0]?.input), "https://central.example.test/api/shopify/events");
  const forwardedBody = JSON.parse(String(setup.calls[0]?.init?.body));
  assert.deepEqual(forwardedBody, {
    shop: "known.myshopify.com",
    topic: "subscription_contracts/create",
    webhookId: "webhook-1",
    shopifyShopId: "gid://shopify/Shop/123",
    payload: { admin_graphql_api_id: "gid://shopify/SubscriptionContract/1", revision_id: "revision-7", status: "active" },
    contract: {
      id: "gid://shopify/SubscriptionContract/1",
      revisionId: "revision-7",
      status: "ACTIVE",
      nextBillingAt: "2026-09-14T12:00:00.000Z",
      currencyCode: "BRL",
      originOrder: { id: "gid://shopify/Order/1", financialStatus: "PAID", amount: "99.90", currencyCode: "BRL", processedAt: "2026-08-14T12:00:00.000Z" },
      customer: { id: "gid://shopify/Customer/1", email: "customer@example.test", name: "Customer" },
      billingPolicy: { interval: "MONTH", intervalCount: 1 }, deliveryPolicy: { interval: "MONTH", intervalCount: 1 },
      lines: [{ id: "gid://shopify/SubscriptionLine/1", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1, currentPrice: { amount: "99.90", currencyCode: "BRL" }, sellingPlanId: "gid://shopify/SellingPlan/1" }],
    },
    receivedAt: "2026-08-14T12:00:00.000Z",
  });
});

test("does not include secrets in logs", async () => {
  const setup = dependencies();
  const forward = createShopifyWebhookForwarder(setup.value);
  await forward(request(), "subscription_contracts/create");

  const serializedLogs = JSON.stringify(setup.logs);
  assert.equal(serializedLogs.includes("super-secret-api-key"), false);
  assert.equal(serializedLogs.includes("X-API-Key"), false);
});

test("enriches subscription_contracts/update", async () => {
  const setup = dependencies({ authenticateWebhook: async () => ({ shop: "known.myshopify.com", topic: "SUBSCRIPTION_CONTRACTS_UPDATE", payload: { id: 1 }, admin: { graphql: async () => new Response() } }) });
  await createShopifyWebhookForwarder(setup.value)(request(), "subscription_contracts/update");
  assert.equal(JSON.parse(String(setup.calls[0]?.init?.body)).contract.id, "gid://shopify/SubscriptionContract/1");
});

test("forwards webhook delivery and Shopify event identifiers separately", async () => {
  const setup = dependencies();
  await createShopifyWebhookForwarder(setup.value)(request("POST", "delivery-1", "event-1"), "subscription_contracts/create");
  const body = JSON.parse(String(setup.calls[0]?.init?.body));
  assert.equal(body.webhookId, "delivery-1");
  assert.equal(body.shopifyEventId, "event-1");
  assert.equal(body.shopifyShopId, "gid://shopify/Shop/123");
  assert.equal(body.contract.revisionId, "revision-7");
});

test("forwards multiple contract lines and each selling plan", async () => {
  const setup = dependencies({ loadContract: async () => ({ shopifyShopId: "gid://shopify/Shop/123", contract: {
    id: "gid://shopify/SubscriptionContract/1", status: "ACTIVE", currencyCode: "BRL",
    billingPolicy: { interval: "MONTH", intervalCount: 1 }, deliveryPolicy: { interval: "MONTH", intervalCount: 1 },
    lines: [1, 2].map((number) => ({ id: `gid://shopify/SubscriptionLine/${number}`, productId: `gid://shopify/Product/${number}`, variantId: `gid://shopify/ProductVariant/${number}`, sellingPlanId: `gid://shopify/SellingPlan/${number}`, quantity: number, currentPrice: { amount: `${number}.00`, currencyCode: "BRL" } })),
  } }) });
  await createShopifyWebhookForwarder(setup.value)(request(), "subscription_contracts/create");
  const lines = JSON.parse(String(setup.calls[0]?.init?.body)).contract.lines;
  assert.equal(lines.length, 2);
  assert.equal(lines[1].sellingPlanId, "gid://shopify/SellingPlan/2");
});

test("accepts a missing Shopify event header", async () => {
  const setup = dependencies();
  await createShopifyWebhookForwarder(setup.value)(request(), "subscription_contracts/create");
  assert.equal("shopifyEventId" in JSON.parse(String(setup.calls[0]?.init?.body)), false);
});

test("returns retryable error and does not forward when GraphQL enrichment fails", async () => {
  const setup = dependencies({ loadContract: async () => { throw new Error("response containing private data"); } });
  await rejectsWithStatus(createShopifyWebhookForwarder(setup.value)(request(), "subscription_contracts/create"), 503);
  assert.equal(setup.calls.length, 0);
  assert.equal(JSON.stringify(setup.logs).includes("private data"), false);
});

test("returns retryable error when the contract is not found", async () => {
  const setup = dependencies({ loadContract: async () => { throw new Error("Shopify contract not found"); } });
  await rejectsWithStatus(createShopifyWebhookForwarder(setup.value)(request(), "subscription_contracts/create"), 503);
  assert.equal(setup.calls.length, 0);
});

test("uses one total deadline for authentication and GraphQL", async () => {
  const budgetMs = 40;
  const setup = dependencies({
    budgetMs,
    authenticateWebhook: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { shop: "known.myshopify.com", topic: "SUBSCRIPTION_CONTRACTS_CREATE", payload: { id: 1 }, admin: { graphql: async () => new Response() } };
    },
    loadContract: async () => new Promise(() => undefined),
  });
  const startedAt = performance.now();
  await rejectsWithStatus(createShopifyWebhookForwarder(setup.value)(request(), "subscription_contracts/create"), 503);
  const elapsed = performance.now() - startedAt;
  assert.ok(elapsed >= budgetMs - 10);
  assert.ok(elapsed < budgetMs + 100, `elapsed ${elapsed}ms exceeded the shared deadline tolerance`);
  assert.equal(setup.calls.length, 0);
});

test("aborts Central API forwarding at the shared deadline", async () => {
  const budgetMs = 40;
  let signalWasAborted = false;
  const setup = dependencies({
    budgetMs,
    fetchFn: (async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => {
        signalWasAborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    })) as typeof fetch,
  });
  const startedAt = performance.now();
  await rejectsWithStatus(createShopifyWebhookForwarder(setup.value)(request(), "subscription_contracts/create"), 503);
  const elapsed = performance.now() - startedAt;
  assert.equal(signalWasAborted, true);
  assert.ok(elapsed < budgetMs + 100, `elapsed ${elapsed}ms exceeded the shared deadline tolerance`);
});

test("uninstall forwards to the Central API before deleting sessions", async () => {
  const order: string[] = [];
  const response = await processAppUninstalledWebhook(request(), {
    authenticate: async () => ({ shop: "known.myshopify.com", topic: "APP_UNINSTALLED", payload: {}, triggeredAt: "2026-08-14T12:00:00.000Z" }),
    forward: async () => {
      order.push("forward");
      return {
        shop: "known.myshopify.com",
        topic: "APP_UNINSTALLED",
        payload: {},
        session: {},
      };
    },
    deleteSessions: async () => {
      order.push("delete-sessions");
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(order, ["forward", "delete-sessions"]);
});

test("uninstall redelivery is idempotent when the authenticated session is already gone", async () => {
  let deletes = 0;
  const { processAppUninstalledWebhook } = await import("./app-uninstalled.server");
  const response = await processAppUninstalledWebhook(new Request("https://app.test/webhooks/app/uninstalled", { method: "POST" }), {
    authenticate: async () => ({ shop: "one.myshopify.com", topic: "APP_UNINSTALLED", payload: {}, triggeredAt: "2026-08-14T12:00:00.000Z" }),
    forward: async () => ({ shop: "one.myshopify.com", topic: "APP_UNINSTALLED", payload: {} }),
    deleteSessions: async () => { deletes += 1; },
  });
  assert.equal(response.status, 200);
  assert.equal(deletes, 0);
});

test("uninstall usa authenticate.webhook().triggeredAt e passa o contexto ao forwarder", async () => {
  const authenticated = { shop: "one.myshopify.com", topic: "APP_UNINSTALLED", payload: { id: 1 }, triggeredAt: "2026-08-14T12:00:00.000Z", webhookId: "delivery-1", eventId: "event-1" };
  let forwarded: unknown;
  await processAppUninstalledWebhook(request(), {
    authenticate: async () => authenticated,
    forward: async (_request, _topic, context) => { forwarded = context; return context; },
    deleteSessions: async () => undefined,
  });
  assert.equal(forwarded, authenticated);
});

test("forwarder recebe triggeredAt autenticado sem consultar header bruto", async () => {
  const setup = dependencies();
  const raw = request("POST", "delivery-header");
  raw.headers.set("x-shopify-triggered-at", "1999-01-01T00:00:00.000Z");
  await createShopifyWebhookForwarder(setup.value)(raw, "app/uninstalled", { shop: "one.myshopify.com", topic: "APP_UNINSTALLED", payload: { id: 1 }, triggeredAt: "2026-08-14T12:00:00.000Z", webhookId: "delivery-auth", eventId: "event-auth" });
  const body = JSON.parse(String(setup.calls[0]?.init?.body));
  assert.equal(body.triggeredAt, "2026-08-14T12:00:00.000Z");
  assert.equal(body.webhookId, "delivery-auth");
  assert.equal(body.shopifyEventId, "event-auth");
  assert.equal(body.shopifyShopId, "gid://shopify/Shop/1");
});

test("triggeredAt ausente retorna retryable e não encaminha uninstall", async () => {
  const setup = dependencies();
  await rejectsWithStatus(createShopifyWebhookForwarder(setup.value)(request(), "app/uninstalled", { shop: "one.myshopify.com", topic: "APP_UNINSTALLED", payload: { id: 1 } }), 503);
  assert.equal(setup.calls.length, 0);
  assert.equal(JSON.stringify(setup.logs).includes("super-secret-api-key"), false);
});

test("triggeredAt inválido retorna retryable e não usa Date.now como fallback", async () => {
  const setup = dependencies();
  await rejectsWithStatus(createShopifyWebhookForwarder(setup.value)(request(), "app/uninstalled", { shop: "one.myshopify.com", topic: "APP_UNINSTALLED", payload: { id: 1 }, triggeredAt: "invalid" }), 503);
  assert.equal(setup.calls.length, 0);
});

test("redelivery preserva webhook ID e event ID", async () => {
  const setup = dependencies();
  const authenticated = { shop: "one.myshopify.com", topic: "APP_UNINSTALLED", payload: { id: 1 }, triggeredAt: "2026-08-14T12:00:00.000Z", webhookId: "delivery-same", eventId: "event-same" };
  const forward = createShopifyWebhookForwarder(setup.value);
  await forward(request(), "app/uninstalled", authenticated);
  await forward(request(), "app/uninstalled", authenticated);
  const bodies = setup.calls.map((call) => JSON.parse(String(call.init?.body)));
  assert.equal(bodies.every((body) => body.webhookId === "delivery-same" && body.shopifyEventId === "event-same"), true);
});

test("billing success forwards Shopify total including shipping and separates cycle origin from completion", async () => {
  const setup = dependencies({ authenticateWebhook: async () => ({ shop: "known.myshopify.com", topic: "SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS", payload: { admin_graphql_api_id: "gid://shopify/SubscriptionBillingAttempt/1", admin_graphql_api_subscription_contract_id: "gid://shopify/SubscriptionContract/1" }, admin: { graphql: async () => new Response() }, triggeredAt: "2026-08-28T12:00:02.000Z" }) });
  await createShopifyWebhookForwarder(setup.value)(request(), "subscription_billing_attempts/success");
  const body = JSON.parse(String(setup.calls[0]?.init?.body));
  assert.equal(body.billingAttempt.order.amount, "50.19");
  assert.equal(body.billingAttempt.order.shipping, "41.19");
  assert.equal(body.billingAttempt.order.currencyCode, "BRL");
  assert.equal(body.billingAttempt.cycleOriginTime, "2026-09-27T16:00:00.000Z");
  assert.equal(body.billingAttempt.completedAt, "2026-08-28T12:00:01.000Z");
  assert.equal(body.triggeredAt, "2026-08-28T12:00:02.000Z");
});

test("billing enrichment failure forwards a retryable pending reconciliation without invented timestamp or secret", async () => {
  const setup = dependencies({
    authenticateWebhook: async () => ({ shop: "known.myshopify.com", topic: "SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS", payload: { admin_graphql_api_id: "gid://shopify/SubscriptionBillingAttempt/1", admin_graphql_api_subscription_contract_id: "gid://shopify/SubscriptionContract/1", idempotency_key: "cycle-1" }, admin: { graphql: async () => new Response() } }),
    loadBillingAttempt: async () => { throw new Error("token super-secret-api-key"); },
  });
  await createShopifyWebhookForwarder(setup.value)(request(), "subscription_billing_attempts/success");
  const body = JSON.parse(String(setup.calls[0]?.init?.body));
  assert.equal(body.billingAttempt.reconciliationStatus, "pending");
  assert.equal("createdAt" in body.billingAttempt, false);
  assert.equal("order" in body.billingAttempt, false);
  assert.equal(JSON.stringify(setup.logs).includes("super-secret-api-key"), false);
});
