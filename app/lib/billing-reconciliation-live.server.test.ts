import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_ERRORS, runWithInFlightLock, submitBillingReconciliationLive, type BillingReconciliationLiveDependencies } from "./billing-reconciliation-live";

const target = { subscriptionContractId: "gid://shopify/SubscriptionContract/10", subscriptionBillingAttemptId: "gid://shopify/SubscriptionBillingAttempt/20", shopifyOrderId: "gid://shopify/Order/30", cycleOriginTime: "2026-09-27T16:00:00Z", correlationId: "scope9-live-cycle" };

function setup(overrides: Partial<BillingReconciliationLiveDependencies> = {}, options: { response?: Response | (() => Promise<Response>) } = {}) {
  const sent: RequestInit[] = [];
  const finalResponse = options.response ?? Response.json({ status: "reconciled" });
  const deps: BillingReconciliationLiveDependencies = {
    tokenProvider: async () => "token-abc",
    sendRequest: async (init) => { sent.push(init); return typeof finalResponse === "function" ? finalResponse() : finalResponse; },
    url: "https://app.test/app/billing-reconciliation/execute-live",
    target,
    confirmation: "EXECUTAR RECONCILIAÇÃO LIVE",
    ...overrides,
  };
  return { deps, sent };
}

test("live submit sends exactly one request with confirmation and no dryRun flag", async () => {
  const s = setup();
  const outcome = await submitBillingReconciliationLive(s.deps);
  assert.equal(outcome.ok, true);
  assert.equal(s.sent.length, 1);
  const body = JSON.parse(s.sent[0].body as string);
  assert.equal(body.confirmation, "EXECUTAR RECONCILIAÇÃO LIVE");
  assert.equal("dryRun" in body, false);
  assert.equal(body.subscriptionBillingAttemptId, target.subscriptionBillingAttemptId);
});

test("synchronous in-flight lock rejects a second same-tick submission", async () => {
  let releaseToken!: (value: string) => void;
  const token = new Promise<string>((resolve) => { releaseToken = resolve; });
  let tokenCalls = 0;
  const s = setup({ tokenProvider: async () => { tokenCalls += 1; return token; } });
  const lock = { current: false };
  const first = runWithInFlightLock(lock, () => submitBillingReconciliationLive(s.deps));
  const second = runWithInFlightLock(lock, () => submitBillingReconciliationLive(s.deps));
  assert.equal(lock.current, true);
  assert.equal(tokenCalls, 1);
  assert.equal(await second, undefined);
  assert.equal(s.sent.length, 0);
  releaseToken("token-abc");
  assert.equal((await first)?.ok, true);
  assert.equal(s.sent.length, 1);
  assert.equal(lock.current, false);
});

test("live submit sends bearer token and same-origin credentials", async () => {
  const s = setup();
  await submitBillingReconciliationLive(s.deps);
  assert.equal(s.sent[0].credentials, "same-origin");
  assert.equal((s.sent[0].headers as Record<string, string>).authorization, "Bearer token-abc");
});

test("token provider failure surfaces sanitized App Bridge error with zero requests", async () => {
  const s = setup({ tokenProvider: async () => { throw new Error("bridge unavailable"); } });
  const outcome = await submitBillingReconciliationLive(s.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, LIVE_ERRORS.appBridgeUnavailable);
  assert.equal(s.sent.length, 0);
});

test("network failure surfaces request_failed with zero parsed attempts", async () => {
  const s = setup({ sendRequest: async () => { throw new TypeError("network down"); } });
  const outcome = await submitBillingReconciliationLive(s.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, LIVE_ERRORS.requestFailed);
});

test("non-2xx response surfaces status, body and reconciliation error", async () => {
  const s = setup({}, { response: Response.json({ error: "target_not_authorized", requestId: "r1" }, { status: 403 }) });
  const outcome = await submitBillingReconciliationLive(s.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 403);
  assert.equal(outcome.error, LIVE_ERRORS.reconciliationFailed);
  assert.deepEqual(outcome.body, { error: "target_not_authorized", requestId: "r1" });
});

test("non-JSON error response is sanitized to null body", async () => {
  const s = setup({}, { response: new Response("<html>oops</html>", { status: 500 }) });
  const outcome = await submitBillingReconciliationLive(s.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 500);
  assert.equal(outcome.body, null);
});
