import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  runAdministrativeBillingReconciliationLiveResourceAction,
  ADMIN_LIVE_RECONCILIATION_RESOURCE_PATH,
  type AdministrativeReconciliationLiveRouteDependencies,
} from "./administrative-billing-reconciliation-live-route.server";

const request = () => new Request("https://app.test/app/billing-reconciliation/execute-live", { method: "POST", body: "{}" });
function dependencies(overrides: Partial<AdministrativeReconciliationLiveRouteDependencies> = {}) {
  const logs: unknown[] = [];
  return {
    logs,
    value: {
      loadAuthenticate: async () => async () => { throw new Response("unauthorized", { status: 401 }); },
      loadHandler: async () => async () => Response.json({ ok: true }),
      fetchFn: fetch,
      logger: { error: (message: string) => logs.push(message), info: () => {} },
      requestId: () => "route-live-123",
      apiUrl: "https://central.test",
      apiKey: "central-secret",
      liveSecret: "live-secret",
      liveEnabled: true,
      liveTargets: [],
      ...overrides,
    } satisfies AdministrativeReconciliationLiveRouteDependencies,
  };
}

test("live resource route file has an action and no loader or component export", () => {
  const source = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute-live.tsx", import.meta.url)), "utf8");
  assert.match(source, /export\s+async\s+function\s+action/);
  assert.equal(/export\s+async\s+function\s+loader/.test(source), false);
  assert.equal(/export\s+default/.test(source), false);
});

test("live resource route is isolated with a distinct action-only path from dry-run", () => {
  const source = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute-live.tsx", import.meta.url)), "utf8");
  assert.equal(ADMIN_LIVE_RECONCILIATION_RESOURCE_PATH, "/app/billing-reconciliation/execute-live");
  assert.notEqual(ADMIN_LIVE_RECONCILIATION_RESOURCE_PATH, "/app/billing-reconciliation/execute");
  assert.equal(source.includes("parentId"), false);
});

test("live route keeps the dry-run path untouched and distinct", () => {
  const drySource = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute.tsx", import.meta.url)), "utf8");
  const liveSource = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute-live.tsx", import.meta.url)), "utf8");
  assert.equal(drySource.includes("execute-live"), false);
  assert.equal(liveSource.includes("/execute\""), false);
});

test("live route load failure returns sanitized JSON 503 with requestId, never leaking secrets", async () => {
  const setup = dependencies({ loadAuthenticate: async () => { throw new Error("DATABASE_URL live-secret value"); } });
  const response = await runAdministrativeBillingReconciliationLiveResourceAction(request(), setup.value);
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "app_infrastructure_unavailable", requestId: "route-live-123" });
  assert.equal(JSON.stringify(setup.logs).includes("live-secret"), false);
});

test("live route handler load failure returns sanitized JSON 500", async () => {
  const setup = dependencies({ loadHandler: async () => { throw new TypeError("module path and secret"); } });
  const response = await runAdministrativeBillingReconciliationLiveResourceAction(request(), setup.value);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "route_initialization_failed", requestId: "route-live-123" });
  assert.equal(JSON.stringify(setup.logs).includes("secret"), false);
});

test("unexpected live handler failure never reaches the React Router HTML boundary", async () => {
  const setup = dependencies({ loadHandler: async () => async () => { throw new RangeError("unexpected credential"); } });
  const response = await runAdministrativeBillingReconciliationLiveResourceAction(request(), setup.value);
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "administrative_reconciliation_live_unhandled", requestId: "route-live-123" });
  assert.equal(JSON.stringify(setup.logs).includes("unexpected credential"), false);
});

test("non-POST on live route is rejected before any dependency load", async () => {
  const calls = { authenticate: 0, handler: 0 };
  const setup = dependencies({
    loadAuthenticate: async () => { calls.authenticate++; return async () => ({ session: { shop: "one.myshopify.com" }, admin: { graphql: async () => Response.json({}) } }); },
    loadHandler: async () => { calls.handler++; return async () => Response.json({}); },
  });
  const response = await runAdministrativeBillingReconciliationLiveResourceAction(new Request("https://app.test/app/billing-reconciliation/execute-live", { method: "GET" }), setup.value);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "method_not_allowed", requestId: "route-live-123" });
  assert.equal(calls.authenticate, 0);
  assert.equal(calls.handler, 0);
});

test("live route emits the start event carrying only requestId and stage", async () => {
  const logs: string[] = [];
  const setup = dependencies({
    loadAuthenticate: async () => async () => { throw new Response("unauthorized", { status: 401 }); },
    logger: { error: () => {}, info: (message: string) => logs.push(message) },
  });
  await runAdministrativeBillingReconciliationLiveResourceAction(request(), setup.value);
  const started = JSON.parse(logs.find((line) => (JSON.parse(line) as { event?: string }).event === "live_resource_action_started") as string);
  assert.equal(started.route, ADMIN_LIVE_RECONCILIATION_RESOURCE_PATH);
  assert.equal(started.requestId, "route-live-123");
  assert.deepEqual(Object.keys(started).sort(), ["event", "requestId", "route", "stage"].sort());
});

test("live requestId is generated before authenticate.admin and auth 401 stays JSON", async () => {
  const logs: string[] = [];
  let authenticateCalls = 0;
  const setup = dependencies({
    liveEnabled: true,
    loadAuthenticate: async () => async () => { authenticateCalls++; throw new Response("login", { status: 401 }); },
    loadHandler: async () => async (incomingRequest, handlerDependencies) => {
      try {
        await handlerDependencies.authenticate(incomingRequest);
        return Response.json({ ok: true });
      } catch (error) {
        if (error instanceof Response) return Response.json({ error: "shopify_authentication_required", requestId: handlerDependencies.requestId }, { status: error.status });
        throw error;
      }
    },
    requestId: () => "pre-auth-live-999",
    logger: { error: (message: string) => logs.push(message), info: () => {} },
  });
  const response = await runAdministrativeBillingReconciliationLiveResourceAction(request(), setup.value);
  assert.equal(authenticateCalls, 1);
  assert.equal(response.status, 401);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "shopify_authentication_required", requestId: "pre-auth-live-999" });
});

test("non-JSON live handler response is sanitized to 500 JSON with the requestId", async () => {
  const setup = dependencies({ loadHandler: async () => async () => new Response("<html>boundary</html>", { status: 500 }) });
  const response = await runAdministrativeBillingReconciliationLiveResourceAction(request(), setup.value);
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "administrative_reconciliation_live_unhandled", requestId: "route-live-123" });
});
