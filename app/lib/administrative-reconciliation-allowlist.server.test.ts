import assert from "node:assert/strict";
import test from "node:test";
import { ADMINISTRATIVE_RECONCILIATION_ALLOWED_SHOP, isAdministrativeReconciliationShopAllowed, normalizeShopDomain } from "./administrative-reconciliation-allowlist.server";

test("APS Test Store is the single allowed shop", () => {
  assert.equal(ADMINISTRATIVE_RECONCILIATION_ALLOWED_SHOP, "aps-test-store-hx3rwtgw.myshopify.com");
  assert.equal(isAdministrativeReconciliationShopAllowed(ADMINISTRATIVE_RECONCILIATION_ALLOWED_SHOP), true);
});

test("matches are case-insensitive and tolerate surrounding whitespace", () => {
  assert.equal(isAdministrativeReconciliationShopAllowed("APS-TEST-STORE-HX3RWTGW.MYSHOPIFY.COM"), true);
  assert.equal(isAdministrativeReconciliationShopAllowed("  aps-test-store-hx3rwtgw.myshopify.com  "), true);
  assert.equal(isAdministrativeReconciliationShopAllowed("Aps-Test-Store-Hx3rwtgw.Myshopify.com"), true);
});

test("fail-closed for empty, non-string and malformed domains", () => {
  assert.equal(isAdministrativeReconciliationShopAllowed(""), false);
  assert.equal(isAdministrativeReconciliationShopAllowed(null), false);
  assert.equal(isAdministrativeReconciliationShopAllowed(undefined), false);
  assert.equal(isAdministrativeReconciliationShopAllowed(123), false);
  assert.equal(isAdministrativeReconciliationShopAllowed("not-a-shop"), false);
  assert.equal(isAdministrativeReconciliationShopAllowed("shop.example.com"), false);
});

test("lookalike, prefixed and suffixed domains never match", () => {
  for (const shop of [
    "aps-test-store.myshopify.com",
    "aps-test-store-hx3rwtgw2.myshopify.com",
    "xaps-test-store-hx3rwtgw.myshopify.com",
    "aps-test-store-hx3rwtgw.myshopify.com.evil.com",
    "aps-test-store-hx3rwtgw.myshopify.com.attacker.test",
    "evilaps-test-store-hx3rwtgw.myshopify.com",
    "APS-TEST-STORE-HX3RWTGW.MYSHOPIFY.COM.",
    "notaps-test-store-hx3rwtgw.myshopify.com",
  ]) {
    assert.equal(isAdministrativeReconciliationShopAllowed(shop), false, `shop ${shop}`);
  }
});

test("other real stores and Betterlife are never allowed", () => {
  assert.equal(isAdministrativeReconciliationShopAllowed("one.myshopify.com"), false);
  assert.equal(isAdministrativeReconciliationShopAllowed("betterlife.myshopify.com"), false);
  assert.equal(isAdministrativeReconciliationShopAllowed("betterlife.store"), false);
});

test("normalizeShopDomain returns canonical lowercase shop or null", () => {
  assert.equal(normalizeShopDomain("  APS-TEST-STORE-HX3RWTGW.MYSHOPIFY.COM  "), "aps-test-store-hx3rwtgw.myshopify.com");
  assert.equal(normalizeShopDomain("evil.com"), null);
  assert.equal(normalizeShopDomain(undefined), null);
});
