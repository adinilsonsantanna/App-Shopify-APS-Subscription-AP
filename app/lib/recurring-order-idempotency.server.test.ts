import assert from "node:assert/strict";
import test from "node:test";
import { createRecurringOrderIdempotently, type RecurringOrderStore, type ShopifyAdminLike } from "./recurring-order-idempotency.server";

function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }); }

function context() {
  const records = new Map<string, any>();
  let now = new Date("2026-08-17T12:00:00.000Z");
  let shopifyOrder: { id: string; name: string } | undefined;
  let creates = 0;
  let failAfterCreate = false;
  let failPersist = false;
  let holdCreate: Promise<void> | undefined;
  const store: RecurringOrderStore = {
    async create({ data }) { if (records.has(data.idempotencyKey)) throw { code: "P2002" }; records.set(data.idempotencyKey, { ...data }); return { ...data }; },
    async findUnique({ where }) { return records.get(where.idempotencyKey) ?? null; },
    async updateMany({ where, data }) { const item = records.get(String(where.idempotencyKey)); const limit = (where.leaseExpiresAt as { lte: Date }).lte; if (!item || item.status !== where.status || item.leaseExpiresAt > limit) return { count: 0 }; Object.assign(item, data); return { count: 1 }; },
    async update({ where, data }) { if (failPersist) { failPersist = false; throw new Error("database unavailable"); } const item = records.get(where.idempotencyKey); Object.assign(item, data); return item; },
  };
  const admin: ShopifyAdminLike = {
    async graphql(query, options) {
      if (query.includes("FindRecurringOrder")) return response({ data: { orders: { nodes: shopifyOrder ? [shopifyOrder] : [] } } });
      creates += 1;
      await holdCreate;
      const tags = (options.variables.order as { tags: string[] }).tags;
      assert.ok(tags.includes("aps-stripe-invoice-in_test"));
      shopifyOrder = { id: "gid://shopify/Order/1", name: "#1001" };
      if (failAfterCreate) { failAfterCreate = false; throw new Error("upstream timeout"); }
      return response({ data: { orderCreate: { userErrors: [], order: shopifyOrder } } });
    },
  };
  const input = { idempotencyKey: "stripe-invoice:in_test", shop: "known.myshopify.com", invoiceId: "in_test", order: { lineItems: [{ quantity: 1 }] } };
  const run = () => createRecurringOrderIdempotently(input, { store, admin, now: () => new Date(now), leaseMs: 1_000 });
  return { run, records, creates: () => creates, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, failAfterCreate: () => { failAfterCreate = true; }, failPersist: () => { failPersist = true; }, hold: (promise: Promise<void>) => { holdCreate = promise; } };
}

test("two concurrent requests create one Shopify order", async () => {
  const value = context();
  let release!: () => void;
  value.hold(new Promise<void>((resolve) => { release = resolve; }));
  const first = value.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = value.run();
  release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(value.creates(), 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
});

test("timeout after Shopify creation is recovered by tag without duplicate", async () => {
  const value = context();
  value.failAfterCreate();
  await assert.rejects(value.run(), /timeout/);
  value.advance(1_001);
  const recovered = await value.run();
  assert.equal(recovered.id, "gid://shopify/Order/1");
  assert.equal(recovered.recovered, true);
  assert.equal(value.creates(), 1);
});

test("database failure after Shopify response recovers without duplicate", async () => {
  const value = context();
  value.failPersist();
  await assert.rejects(value.run(), /database unavailable/);
  value.advance(1_001);
  const recovered = await value.run();
  assert.equal(recovered.id, "gid://shopify/Order/1");
  assert.equal(value.creates(), 1);
});

test("completed Idempotency-Key returns the persisted result without Shopify", async () => {
  const value = context();
  await value.run();
  const repeated = await value.run();
  assert.equal(repeated.id, "gid://shopify/Order/1");
  assert.equal(value.creates(), 1);
});
