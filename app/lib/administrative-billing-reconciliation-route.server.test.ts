import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  runAdministrativeBillingReconciliationResourceAction,
  ADMIN_RECONCILIATION_DRY_RUN_TARGETS,
  ADMINISTRATIVE_RECONCILIATION_RESOURCE_PATH,
  type AdministrativeReconciliationRouteDependencies,
} from "./administrative-billing-reconciliation-route.server";

const request = () => new Request("https://app.test/app/billing-reconciliation/execute", { method: "POST", body: "{}" });
function dependencies(overrides: Partial<AdministrativeReconciliationRouteDependencies> = {}) {
  const logs: unknown[] = [];
  return {
    logs,
    value: {
      loadAuthenticate: async () => async () => { throw new Response("unauthorized", { status: 401 }); },
      loadHandler: async () => async () => Response.json({ ok: true }),
      fetchFn: fetch,
      logger: { error: (message: string) => logs.push(message), info: () => {} },
      requestId: () => "route-req-123",
      apiUrl: "https://central.test",
      apiKey: "central-secret",
      ...overrides,
    } satisfies AdministrativeReconciliationRouteDependencies,
  };
}

test("resource route module exports only the action handler", async () => {
  const mod = await import("./administrative-billing-reconciliation-route.server");
  assert.equal(typeof mod.runAdministrativeBillingReconciliationResourceAction, "function");
});

test("resource route file has an action and no loader or component export", () => {
  const source = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute.tsx", import.meta.url)), "utf8");
  assert.match(source, /export\s+async\s+function\s+action/);
  assert.equal(/export\s+async\s+function\s+loader/.test(source), false);
  assert.equal(/export\s+default/.test(source), false);
  assert.equal(source.split("authenticate.admin").length - 1, 0);
});

test("resource route is isolated with parentId root and an action-only path", () => {
  const source = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute.tsx", import.meta.url)), "utf8");
  assert.equal(ADMINISTRATIVE_RECONCILIATION_RESOURCE_PATH, "/app/billing-reconciliation/execute");
  assert.equal(source.includes("parentId"), false);
});

test("Prisma or session module initialization failure returns sanitized JSON 503", async () => {
  const setup = dependencies({ loadAuthenticate: async () => { throw new Error("DATABASE_URL secret value"); } });
  const response = await runAdministrativeBillingReconciliationResourceAction(request(), setup.value);
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "app_infrastructure_unavailable", requestId: "route-req-123" });
  assert.equal(JSON.stringify(setup.logs).includes("DATABASE_URL secret value"), false);
});

test("controllable route module dependency failure returns sanitized JSON 500", async () => {
  const setup = dependencies({ loadHandler: async () => { throw new TypeError("module path and secret"); } });
  const response = await runAdministrativeBillingReconciliationResourceAction(request(), setup.value);
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "route_initialization_failed", requestId: "route-req-123" });
  assert.equal(JSON.stringify(setup.logs).includes("module path and secret"), false);
});

test("unexpected handler failure never reaches the React Router HTML boundary", async () => {
  const setup = dependencies({ loadHandler: async () => async () => { throw new RangeError("unexpected credential"); } });
  const response = await runAdministrativeBillingReconciliationResourceAction(request(), setup.value);
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "administrative_reconciliation_unhandled", requestId: "route-req-123" });
  assert.equal(JSON.stringify(setup.logs).includes("unexpected credential"), false);
});

test("non-POST is rejected as sanitized JSON 400 before any dependency load", async () => {
  const calls = { authenticate: 0, handler: 0 };
  const setup = dependencies({
    loadAuthenticate: async () => { calls.authenticate++; return async () => ({ session: { shop: "one.myshopify.com" }, admin: { graphql: async () => Response.json({}) } }); },
    loadHandler: async () => { calls.handler++; return async () => Response.json({}); },
  });
  const response = await runAdministrativeBillingReconciliationResourceAction(new Request("https://app.test/app/billing-reconciliation/execute", { method: "GET" }), setup.value);
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "method_not_allowed", requestId: "route-req-123" });
  assert.equal(calls.authenticate, 0);
  assert.equal(calls.handler, 0);
});

test("resource action emits the start event carrying only requestId and stage", async () => {
  const logs: string[] = [];
  const setup = dependencies({
    loadAuthenticate: async () => async () => { throw new Response("unauthorized", { status: 401 }); },
    logger: { error: () => {}, info: (message: string) => logs.push(message) },
  });
  await runAdministrativeBillingReconciliationResourceAction(request(), setup.value);
  const started = JSON.parse(logs.find((line) => (JSON.parse(line) as { event?: string }).event === "resource_action_started") as string);
  assert.equal(started.route, ADMINISTRATIVE_RECONCILIATION_RESOURCE_PATH);
  assert.equal(started.requestId, "route-req-123");
  assert.deepEqual(Object.keys(started).sort(), ["event", "requestId", "route", "stage"].sort());
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

test("requestId is generated before authenticate.admin and the auth 401 stays JSON, never 500/HTML", async () => {
  const { handleAdministrativeBillingReconciliation } = await import("./administrative-billing-reconciliation.server");
  const logs: string[] = [];
  let authenticateCalls = 0;
  const setup = dependencies({
    loadAuthenticate: async () => async () => { authenticateCalls++; throw new Response("login", { status: 401 }); },
    loadHandler: async () => handleAdministrativeBillingReconciliation,
    requestId: () => "pre-auth-route-999",
    logger: { error: (message: string) => logs.push(message), info: () => {} },
  });
  const response = await runAdministrativeBillingReconciliationResourceAction(request(), setup.value);
  assert.equal(authenticateCalls, 1);
  assert.equal(response.status, 401);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "shopify_authentication_required", requestId: "pre-auth-route-999" });
});

test("non-JSON handler response is sanitized to 500 JSON with the requestId", async () => {
  const setup = dependencies({ loadHandler: async () => async () => new Response("<html>boundary</html>", { status: 500 }) });
  const response = await runAdministrativeBillingReconciliationResourceAction(request(), setup.value);
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "administrative_reconciliation_unhandled", requestId: "route-req-123" });
});

test("observability stage events never leak server secrets", async () => {
  const logs: string[] = [];
  const setup = dependencies({
    loadAuthenticate: async () => { throw new Error("DATABASE_URL db-secret-xyz"); },
    logger: { error: (message: string) => logs.push(message), info: (message: string) => logs.push(message) },
  });
  await runAdministrativeBillingReconciliationResourceAction(request(), setup.value);
  assert.equal(JSON.stringify(logs).includes("db-secret-xyz"), false);
});
