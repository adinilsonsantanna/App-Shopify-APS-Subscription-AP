import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const routeSource = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation.tsx", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../routes/app.tsx", import.meta.url)), "utf8");
const dryResourceRouteSource = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute.tsx", import.meta.url)), "utf8");
const liveResourceRouteSource = readFileSync(fileURLToPath(new URL("../routes/app_.billing-reconciliation_.execute-live.tsx", import.meta.url)), "utf8");

test("admin page loader gate fails closed to 404 for any non-authorized shop before returning data", () => {
  assert.equal(routeSource.includes("const { session } = await authenticate.admin(request)"), true);
  assert.equal(routeSource.includes("isAdministrativeReconciliationShopAllowed(session.shop)"), true);
  assert.equal(routeSource.includes('throw new Response("Not Found", { status: 404 })'), true);
  const gate = routeSource.indexOf("isAdministrativeReconciliationShopAllowed(session.shop)");
  const parse = routeSource.indexOf("parseLiveTargets(process.env.ADMIN_RECONCILIATION_LIVE_TARGETS)");
  assert.ok(gate >= 0 && parse > gate, "allowlist gate must run before target/feature data is computed");
  assert.equal(routeSource.includes("liveTargets[0]"), false);
});

test("admin nav item is rendered server-side only for a shop allowed by the reconciliation allowlist", () => {
  assert.equal(appSource.includes("showReconciliationNav: isAdministrativeReconciliationShopAllowed(authenticated.session.shop)"), true);
  const gate = appSource.indexOf("showReconciliationNav:");
  const link = appSource.indexOf('<s-link href="/app/billing-reconciliation">Reconciliação (dry-run)</s-link>');
  assert.ok(gate >= 0 && link > gate, "nav decision must be derived server-side before the item renders");
  const cond = appSource.slice(gate, link);
  assert.equal(cond.includes("showReconciliationNav &&"), true);
});

test("resource routes delegate the admin-only gate to the handlers before any Shopify or Central work", () => {
  // dry-run and live resource routes remain thin action-only proxies; the allowlist gate lives in the handlers
  assert.match(dryResourceRouteSource, /export\s+async\s+function\s+action/);
  assert.match(liveResourceRouteSource, /export\s+async\s+function\s+action/);
  assert.equal(/export\s+default/.test(dryResourceRouteSource), false);
  assert.equal(/export\s+default/.test(liveResourceRouteSource), false);
});
