import assert from "node:assert/strict";
import test from "node:test";
import { buildBillingReconciliationSafeUrl } from "./billing-reconciliation-safe-url";

test("safe URL construction preserves allowed params and removes others", () => {
  const result = buildBillingReconciliationSafeUrl(
    "https://example.com",
    "/app/billing-reconciliation",
    "?shop=test.myshopify.com&host=test&embedded=1&other=param&id_token=secret&hash=123#fragment"
  );
  const url = new URL(result);
  
  assert.equal(url.searchParams.has("shop"), true);
  assert.equal(url.searchParams.get("shop"), "test.myshopify.com");
  assert.equal(url.searchParams.has("host"), true);
  assert.equal(url.searchParams.has("embedded"), true);
  assert.equal(url.searchParams.has("other"), false);
  assert.equal(url.searchParams.has("id_token"), false);
  assert.equal(url.hash, "");
  assert.equal(result, "https://example.com/app/billing-reconciliation?shop=test.myshopify.com&host=test&embedded=1");
});

test("safe URL construction handles duplicate allowed params deterministically (last wins)", () => {
  const result = buildBillingReconciliationSafeUrl(
    "https://example.com",
    "/app/billing-reconciliation",
    "?shop=first&shop=second"
  );
  const url = new URL(result);
  assert.equal(url.searchParams.get("shop"), "second");
});

test("safe URL construction works without query params", () => {
  const result = buildBillingReconciliationSafeUrl(
    "https://example.com",
    "/app/billing-reconciliation",
    ""
  );
  assert.equal(result, "https://example.com/app/billing-reconciliation");
});
