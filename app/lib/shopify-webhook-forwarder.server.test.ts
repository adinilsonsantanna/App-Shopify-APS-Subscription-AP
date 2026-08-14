import test from "node:test";
import assert from "node:assert/strict";
import {
  createShopifyWebhookForwarder,
  type WebhookForwarderDependencies,
} from "./shopify-webhook-forwarder.server";
import { processAppUninstalledWebhook } from "./app-uninstalled.server";

interface CapturedLog {
  message: string;
  metadata: Record<string, unknown>;
}

function request(method = "POST", webhookId = "webhook-1") {
  const headers = webhookId ? { "x-shopify-webhook-id": webhookId } : undefined;
  return new Request("https://app.example.test/webhooks/subscription_contracts/create", {
    method,
    headers,
  });
}

function dependencies(overrides: Partial<WebhookForwarderDependencies> = {}) {
  const logs: CapturedLog[] = [];
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const value: WebhookForwarderDependencies = {
    authenticateWebhook: async () => ({
      shop: "known.myshopify.com",
      topic: "SUBSCRIPTION_CONTRACTS_CREATE",
      payload: { admin_graphql_api_id: "gid://shopify/SubscriptionContract/1", status: "active" },
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
    loadContract: async () => ({
      id: "gid://shopify/SubscriptionContract/1",
      status: "ACTIVE",
      nextBillingAt: "2026-09-14T12:00:00.000Z",
      currencyCode: "BRL",
      originOrder: { id: "gid://shopify/Order/1", financialStatus: "PAID", amount: "99.90", currencyCode: "BRL", processedAt: "2026-08-14T12:00:00.000Z" },
      customer: { id: "gid://shopify/Customer/1", email: "customer@example.test", name: "Customer" },
      billingPolicy: { interval: "MONTH", intervalCount: 1 },
      deliveryPolicy: { interval: "MONTH", intervalCount: 1 },
      lines: [{ id: "gid://shopify/SubscriptionLine/1", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1, currentPrice: { amount: "99.90", currencyCode: "BRL" }, sellingPlanId: "gid://shopify/SellingPlan/1" }],
    }),
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
    payload: { admin_graphql_api_id: "gid://shopify/SubscriptionContract/1", status: "active" },
    contract: {
      id: "gid://shopify/SubscriptionContract/1",
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
