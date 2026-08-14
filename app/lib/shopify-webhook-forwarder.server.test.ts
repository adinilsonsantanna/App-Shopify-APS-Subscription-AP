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
      payload: { status: "active" },
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
    payload: { status: "active" },
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
