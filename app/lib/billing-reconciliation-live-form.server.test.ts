import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const componentSource = readFileSync(fileURLToPath(new URL("../components/billing-reconciliation-live-form.tsx", import.meta.url)), "utf8");
const routeSource = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation.tsx", import.meta.url)), "utf8");
const submitSource = readFileSync(fileURLToPath(new URL("./billing-reconciliation-live.ts", import.meta.url)), "utf8");
const liveResourceRouteSource = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute-live.tsx", import.meta.url)), "utf8");
const dryResourceRouteSource = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute.tsx", import.meta.url)), "utf8");

test("live UI is a clearly separated section with its own confirmation phrase", () => {
  assert.equal(componentSource.includes("Reconciliação live"), true);
  assert.equal(componentSource.includes("ADMIN_LIVE_CONFIRMATION_PHRASE"), true);
  assert.equal(componentSource.includes("DRY-RUN SEGURO"), false);
});

test("live UI documents that it modifies internal DB and makes no external mutation", () => {
  for (const expected of [
    "modifica o banco interno",
    "cria cobrança",
    "executa mutation Shopify",
    "executa mutation Stripe",
    "cria pedido",
  ]) {
    assert.equal(componentSource.includes(expected), true);
  }
});

test("live button is unavailable (disabled/not rendered) unless the feature gate is ON", () => {
  assert.equal(componentSource.includes("if (!liveEnabled) {"), true);
  assert.equal(componentSource.includes("A execução live está desligada"), true);
});

test("live UI posts only to the dedicated live resource route path", () => {
  assert.equal(componentSource.includes('"/app/billing-reconciliation/execute-live"'), true);
  assert.equal(componentSource.includes('"/app/billing-reconciliation/execute"'), false);
});

test("live UI requires a distinct textual confirmation and blocks double-click/running", () => {
  assert.equal(componentSource.includes("ADMIN_LIVE_CONFIRMATION_PHRASE"), true);
  assert.equal(componentSource.includes("disabled={!confirmed || running}"), true);
  assert.equal(componentSource.includes("if (!confirmed || running || !target) return;"), true);
});

test("live UI performs exactly one fetch and never retries", () => {
  assert.equal(componentSource.includes("fetch(safeUrlString, init)"), true);
  for (const forbidden of ["setTimeout(", "retry", "for (", "while ("]) {
    assert.equal(componentSource.includes(forbidden), false);
  }
});

test("live submit module never sends dryRun from the browser", () => {
  assert.equal(submitSource.includes("dryRun"), false);
  assert.equal(submitSource.includes("confirmation"), true);
  assert.equal(submitSource.includes("dryRun: false"), false);
  assert.equal(submitSource.includes("dryRun: true"), false);
});

test("live resource route is action-only and distinct from dry-run route", () => {
  assert.match(liveResourceRouteSource, /export\s+async\s+function\s+action/);
  assert.equal(/export\s+async\s+function\s+loader/.test(liveResourceRouteSource), false);
  assert.equal(/export\s+default/.test(liveResourceRouteSource), false);
  assert.equal(dryResourceRouteSource.includes("execute-live"), false);
});

test("dry-run UI route is unchanged and live stays separate in the shared UI route", () => {
  assert.equal(routeSource.includes("BillingReconciliationDryRunForm"), true);
  assert.equal(routeSource.includes("BillingReconciliationLiveForm"), true);
});
