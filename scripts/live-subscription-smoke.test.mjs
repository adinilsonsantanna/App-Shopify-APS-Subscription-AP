import assert from "node:assert/strict";
import test from "node:test";
import { planLiveSmoke } from "./live-subscription-smoke.mjs";

test("App uses the canonical API live-safety policy and remains blocked in ordinary CI", () => { const plan = planLiveSmoke({ CI: "true", ENABLE_LIVE_SUBSCRIPTION_TESTS: "true", LIVE_SUBSCRIPTION_TEST_SHOP: "betterlife.myshopify.com", LIVE_SUBSCRIPTION_TEST_GATEWAY: "stripe-test" }, () => "app"); assert.equal(plan.mode, "dry-run"); assert.ok(plan.blockers.includes("ordinary_ci_forbidden")); assert.ok(plan.blockers.includes("betterlife_forbidden")); assert.ok(plan.blockers.includes("shop_not_allowlisted")); assert.ok(plan.blockers.includes("step_confirmation_required")); });
test("cleanup manifest is correlation-scoped and never broad", () => { const plan = planLiveSmoke({}, () => "app"); assert.equal(plan.resources.length, 5); assert.ok(plan.resources.every(item => Object.keys(item.cleanupWhere).join() === "correlationId" && item.cleanupWhere.correlationId === plan.correlationId)); });
