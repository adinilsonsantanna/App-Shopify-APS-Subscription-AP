import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DRY_RUN_ERRORS, submitBillingReconciliationDryRun, type BillingReconciliationDryRunDependencies } from "./billing-reconciliation-dry-run";

const targets = {
  subscriptionBillingAttemptId: "gid://shopify/SubscriptionBillingAttempt/433329242475",
  subscriptionContractId: "gid://shopify/SubscriptionContract/166901350763",
  shopifyOrderId: "gid://shopify/Order/11536855662955",
  cycleOriginTime: "2026-09-27T16:00:00Z",
  correlationId: "scope9-live-20260826144821-a2c3d40d",
} as const;

interface SetupOptions {
  token?: string;
  tokenError?: Error;
  requestError?: Error;
  response?: Response;
}

function setup(options: SetupOptions = {}) {
  const tokenCalls: string[] = [];
  const requestInits: RequestInit[] = [];
  const token = options.token ?? "r-ok-token";
  const dependencies: BillingReconciliationDryRunDependencies = {
    tokenProvider: async () => {
      tokenCalls.push(token);
      if (options.tokenError) throw options.tokenError;
      return token;
    },
    sendRequest: async (init: RequestInit) => {
      requestInits.push(init);
      if (options.requestError) throw options.requestError;
      return options.response ?? Response.json({ status: "dry_run" });
    },
    url: "/app/billing-reconciliation",
    targets,
  };
  return { dependencies, tokenCalls, requestInits };
}

test("official idToken is called exactly once and one POST follows a valid token", async () => {
  const s = setup();
  const outcome = await submitBillingReconciliationDryRun(s.dependencies);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.error, undefined);
  assert.equal(s.tokenCalls.length, 1);
  assert.equal(s.requestInits.length, 1);
});

test("Authorization header uses the exact token returned by idToken", async () => {
  const s = setup({ token: "tkn-abc-123" });
  const outcome = await submitBillingReconciliationDryRun(s.dependencies);
  assert.equal(outcome.ok, true);
  const headers = s.requestInits[0].headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer tkn-abc-123");
  assert.equal(headers["content-type"], "application/json");
});

test("POST body always contains dryRun true and all fixed targets", async () => {
  const s = setup();
  const outcome = await submitBillingReconciliationDryRun(s.dependencies);
  assert.equal(outcome.ok, true);
  const body = JSON.parse(String(s.requestInits[0].body));
  assert.equal(body.dryRun, true);
  assert.equal(body.subscriptionBillingAttemptId, targets.subscriptionBillingAttemptId);
  assert.equal(body.subscriptionContractId, targets.subscriptionContractId);
  assert.equal(body.shopifyOrderId, targets.shopifyOrderId);
  assert.equal(body.cycleOriginTime, targets.cycleOriginTime);
  assert.equal(body.correlationId, targets.correlationId);
});

test("no POST is sent and no secret leaks when idToken fails", async () => {
  const s = setup({ tokenError: new Error("app bridge token failure tkn-secret-leak") });
  const outcome = await submitBillingReconciliationDryRun(s.dependencies);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, DRY_RUN_ERRORS.appBridgeUnavailable);
  assert.equal(s.requestInits.length, 0);
  assert.equal(JSON.stringify(outcome).includes("tkn-secret-leak"), false);
  assert.equal(JSON.stringify(outcome).includes("r-ok-token"), false);
});

test("idToken is not retried when the request fails", async () => {
  const s = setup({ requestError: new Error("network down central-secret") });
  const outcome = await submitBillingReconciliationDryRun(s.dependencies);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, DRY_RUN_ERRORS.requestFailed);
  assert.equal(s.tokenCalls.length, 1);
  assert.equal(s.requestInits.length, 1);
  assert.equal(JSON.stringify(outcome).includes("central-secret"), false);
  assert.equal(JSON.stringify(outcome).includes("Bearer"), false);
});

test("server rejection is a sanitized outcome that preserves the HTTP status", async () => {
  const s = setup({ response: Response.json({ error: "dry_run_required" }, { status: 400 }) });
  const outcome = await submitBillingReconciliationDryRun(s.dependencies);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, DRY_RUN_ERRORS.reconciliationFailed);
  assert.equal(outcome.status, 400);
  assert.equal(JSON.stringify(outcome).includes("r-ok-token"), false);
});

test("client module can never emit dryRun false", async () => {
  const source = readFileSync(fileURLToPath(new URL("./billing-reconciliation-dry-run.ts", import.meta.url)), "utf8");
  assert.equal(source.includes("dryRun: false"), false);
  assert.equal(source.includes("dryRun: true"), true);
});