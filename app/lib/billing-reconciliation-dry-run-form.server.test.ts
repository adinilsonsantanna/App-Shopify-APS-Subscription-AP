import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const componentSource = readFileSync(fileURLToPath(new URL("../components/billing-reconciliation-dry-run-form.tsx", import.meta.url)), "utf8");
const routeSource = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation.tsx", import.meta.url)), "utf8");
const submitSource = readFileSync(fileURLToPath(new URL("./billing-reconciliation-dry-run.ts", import.meta.url)), "utf8");

test("route stays a root-level page (parentId=root) and does not reload the authentication layout", () => {
  assert.equal(routeSource.includes("parentId"), false);
  assert.equal(routeSource.includes("<Outlet "), false);
  assert.equal(routeSource.includes("authenticate.admin"), true);
  assert.equal(routeSource.split("authenticate.admin").length - 1, 1);
});

test("route wraps the form with an embedded AppProvider using the loader apiKey", () => {
  assert.equal(routeSource.includes('import { AppProvider } from "@shopify/shopify-app-react-router/react";'), true);
  assert.equal(routeSource.includes("AppProvider embedded apiKey={data.apiKey}"), true);
  const open = routeSource.indexOf("<AppProvider");
  const close = routeSource.lastIndexOf("</AppProvider>");
  assert.equal(open >= 0 && close > open, true);
  assert.equal(routeSource.slice(open, close).includes("BillingReconciliationDryRunForm"), true);
});

test("form no longer injects or appends any script", () => {
  for (const forbidden of [
    "document.createElement('script')",
    'document.createElement("script")',
    ".appendChild(",
    "app-bridge.js",
  ]) {
    assert.equal(componentSource.includes(forbidden), false);
  }
});

test("form no longer reads the window.shopify global or uses a BridgeGlobal alias", () => {
  for (const forbidden of [
    "window.shopify",
    "window as",
    "globalThis",
    "BridgeGlobal",
    "script[data-api-key]",
  ]) {
    assert.equal(componentSource.includes(forbidden), false);
  }
});

test("no hook is called outside top-level component scope (no probe, effect, timer or poll)", () => {
  for (const forbidden of [
    "probeAppBridgeReady",
    "useAppBridgeScriptStatus",
    "useEffect(",
    "setTimeout(",
    "Math.ceil(",
    "APP_BRIDGE_TIMEOUT_MS",
    "APP_BRIDGE_POLL_INTERVAL_MS",
  ]) {
    assert.equal(componentSource.includes(forbidden), false);
  }
});

test("no rules-of-hooks suppression is used anywhere", () => {
  for (const forbidden of ["eslint-disable", "rules-of-hooks"]) {
    assert.equal(componentSource.includes(forbidden), false);
  }
});

test("form obtains the session token exclusively through useAppBridge().idToken() called once at the top", () => {
  assert.equal(componentSource.includes('import { useAppBridge } from "@shopify/app-bridge-react";'), true);
  assert.equal(componentSource.includes("const shopify = useAppBridge();"), true);
  assert.equal(componentSource.split("useAppBridge(").length - 1, 1);
  assert.equal(componentSource.includes("shopify.idToken()"), true);
  assert.equal(componentSource.includes("window.shopify.idToken"), false);
});

test("App Bridge failure surfaces a sanitized error and the POST always flows through the submit module", () => {
  assert.equal(componentSource.includes("DRY_RUN_ERRORS.appBridgeUnavailable"), true);
  assert.equal(componentSource.includes("submitBillingReconciliationDryRun"), true);
  assert.equal(componentSource.includes("disabled={!confirmed || running}"), true);
});

test("client contract keeps dryRun true and never references the false path", () => {
  for (const source of [componentSource, routeSource]) {
    assert.equal(source.includes("dryRun: false"), false);
  }
  assert.equal(submitSource.includes("dryRun: false"), false);
  assert.equal(submitSource.includes("dryRun: true"), true);
});

test("form posts to a URL constructed by the shared safe URL helper, not window.location.href", () => {
  assert.equal(
    componentSource.includes(
      'import { buildBillingReconciliationSafeUrl } from "../lib/billing-reconciliation-safe-url";',
    ),
    true,
  );
  assert.equal(componentSource.includes("buildBillingReconciliationSafeUrl("), true);
  assert.equal(componentSource.includes("fetch(safeUrlString, init)"), true);
  assert.equal(componentSource.includes("window.location.href"), false);
});

test("non-2xx result surfaces HTTP status, sanitized body.error and body.requestId without dumping payload", () => {
  assert.equal(componentSource.includes("HTTP {result.status}"), true);
  assert.equal(componentSource.includes("bodyError"), true);
  assert.equal(componentSource.includes("bodyRequestId"), true);
  assert.equal(componentSource.includes("JSON.stringify(result.body"), true);
});

test("client form and route never carry server secrets; only the public apiKey env is read", () => {
  for (const source of [componentSource, routeSource]) {
    assert.equal(source.includes("SHOPIFY_API_SECRET"), false);
    assert.equal(source.includes("API_SUBSCRIPTION_URL"), false);
    assert.equal(source.includes("Authorization"), false);
  }
  assert.equal(componentSource.includes("process.env"), false);
  assert.equal(routeSource.includes("process.env.SHOPIFY_API_KEY"), true);
});
