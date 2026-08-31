import assert from "node:assert/strict";
import test from "node:test";

function buildSafeUrl(location: { pathname: string; origin: string; search: string }) {
    const safeUrl = new URL(location.pathname, location.origin);
    const params = new URLSearchParams(location.search);
    const allowed = ["shop", "host", "embedded"];
    for (const [key, value] of params.entries()) {
        if (allowed.includes(key)) {
            safeUrl.searchParams.append(key, value);
        }
    }
    return safeUrl.toString();
}

test("safe URL construction preserves allowed params and removes others", () => {
    const location = {
        pathname: "/app/billing-reconciliation",
        origin: "https://example.com",
        search: "?shop=test.myshopify.com&host=test&embedded=1&other=param&id_token=secret",
    };
    
    const result = buildSafeUrl(location);
    const url = new URL(result);
    
    assert.equal(url.searchParams.has("shop"), true);
    assert.equal(url.searchParams.has("host"), true);
    assert.equal(url.searchParams.has("embedded"), true);
    assert.equal(url.searchParams.has("other"), false);
    assert.equal(url.searchParams.has("id_token"), false);
    assert.equal(result, "https://example.com/app/billing-reconciliation?shop=test.myshopify.com&host=test&embedded=1");
});

test("safe URL construction works without query params", () => {
    const location = {
        pathname: "/app/billing-reconciliation",
        origin: "https://example.com",
        search: "",
    };
    
    const result = buildSafeUrl(location);
    assert.equal(result, "https://example.com/app/billing-reconciliation");
});
