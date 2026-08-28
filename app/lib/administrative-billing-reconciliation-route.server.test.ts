import assert from "node:assert/strict";
import test from "node:test";
import { runAdministrativeBillingReconciliationAction, ADMIN_RECONCILIATION_DRY_RUN_TARGETS, type AdministrativeReconciliationRouteDependencies } from "./administrative-billing-reconciliation-route.server";

const request = () => new Request("https://app.test/app/billing-reconciliation", { method: "POST", body: "{}" });
function dependencies(overrides: Partial<AdministrativeReconciliationRouteDependencies> = {}) {
  const logs: unknown[] = [];
  return {
    logs,
    value: {
      loadAuthenticate: async () => async () => { throw new Response("unauthorized", { status: 401 }); },
      loadHandler: async () => async () => Response.json({ ok: true }),
      fetchFn: fetch,
      logger: { error: (message: string) => logs.push(message) },
      requestId: () => "route-req-123",
      apiUrl: "https://central.test",
      apiKey: "central-secret",
      ...overrides,
    } satisfies AdministrativeReconciliationRouteDependencies,
  };
}

test("Prisma or session module initialization failure returns sanitized JSON 503", async () => {
  const setup = dependencies({ loadAuthenticate: async () => { throw new Error("DATABASE_URL secret value"); } });
  const response = await runAdministrativeBillingReconciliationAction(request(), setup.value);
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "app_infrastructure_unavailable", requestId: "route-req-123" });
  assert.equal(JSON.stringify(setup.logs).includes("DATABASE_URL secret value"), false);
});

test("controllable route module dependency failure returns sanitized JSON 500", async () => {
  const setup = dependencies({ loadHandler: async () => { throw new TypeError("module path and secret"); } });
  const response = await runAdministrativeBillingReconciliationAction(request(), setup.value);
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "route_initialization_failed", requestId: "route-req-123" });
  assert.equal(JSON.stringify(setup.logs).includes("module path and secret"), false);
});

test("unexpected handler failure never reaches the React Router HTML boundary", async () => {
  const setup = dependencies({ loadHandler: async () => async () => { throw new RangeError("unexpected credential"); } });
  const response = await runAdministrativeBillingReconciliationAction(request(), setup.value);
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "administrative_reconciliation_unhandled", requestId: "route-req-123" });
  assert.equal(JSON.stringify(setup.logs).includes("unexpected credential"), false);
});

test("default route allowlist pins the authorized dry-run targets", () => {
  assert.deepEqual(ADMIN_RECONCILIATION_DRY_RUN_TARGETS, {
    subscriptionBillingAttemptId: "gid://shopify/SubscriptionBillingAttempt/433329242475",
    subscriptionContractId: "gid://shopify/SubscriptionContract/166901350763",
    shopifyOrderId: "gid://shopify/Order/11536855662955",
    cycleOriginTime: "2026-09-27T16:00:00Z",
    correlationId: "scope9-live-20260826144821-a2c3d40d",
  });
});
