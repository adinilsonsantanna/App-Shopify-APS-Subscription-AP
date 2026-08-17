import crypto from "node:crypto";

export const FIND_RECURRING_ORDER = `#graphql
  query FindRecurringOrder($query: String!) {
    orders(first: 1, query: $query) {
      nodes { id name }
    }
  }
`;

export const CREATE_RECURRING_ORDER = `#graphql
  mutation CreateRecurringOrder($order: OrderCreateOrderInput!) {
    orderCreate(order: $order) {
      userErrors { field message }
      order { id name }
    }
  }
`;

type RequestRecord = { idempotencyKey: string; shop: string; invoiceId: string; payloadHash: string; status: string; shopifyOrderId: string | null; leaseExpiresAt: Date };
export interface RecurringOrderStore {
  create(args: { data: RequestRecord }): Promise<RequestRecord>;
  findUnique(args: { where: { idempotencyKey: string } }): Promise<RequestRecord | null>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  update(args: { where: { idempotencyKey: string }; data: Record<string, unknown> }): Promise<RequestRecord>;
}
export interface ShopifyAdminLike { graphql(query: string, options: { variables: Record<string, unknown> }): Promise<Response> }
export interface RecurringOrderDependencies { store: RecurringOrderStore; admin: ShopifyAdminLike; now?: () => Date; leaseMs?: number }

function tagForInvoice(invoiceId: string) {
  if (!/^in_[A-Za-z0-9_-]+$/.test(invoiceId)) throw new Error("Invalid Stripe invoice ID");
  return `aps-stripe-invoice-${invoiceId}`;
}

async function json(response: Response) {
  const value = await response.json() as any;
  if (!response.ok || value.errors?.length) throw new Error("Shopify GraphQL request failed");
  return value;
}

export async function createRecurringOrderIdempotently(input: { idempotencyKey: string; shop: string; invoiceId: string; order: Record<string, any> }, dependencies: RecurringOrderDependencies) {
  const expectedKey = `stripe-invoice:${input.invoiceId}`;
  if (input.idempotencyKey !== expectedKey) throw new Error("Invalid Idempotency-Key");
  const now = dependencies.now?.() ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + (dependencies.leaseMs ?? 60_000));
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify({ shop: input.shop, invoiceId: input.invoiceId, order: input.order })).digest("hex");
  let ownsClaim = false;
  let record: RequestRecord | null = null;
  try {
    record = await dependencies.store.create({ data: { idempotencyKey: expectedKey, shop: input.shop, invoiceId: input.invoiceId, payloadHash, status: "processing", shopifyOrderId: null, leaseExpiresAt } });
    ownsClaim = true;
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    record = await dependencies.store.findUnique({ where: { idempotencyKey: expectedKey } });
  }
  if (!record) throw new Error("Idempotency claim disappeared");
  if (record.shop !== input.shop || record.invoiceId !== input.invoiceId || record.payloadHash !== payloadHash) throw new Error("Idempotency-Key payload conflict");
  if (record.status === "completed" && record.shopifyOrderId) return { id: record.shopifyOrderId, recovered: true };
  if (!ownsClaim) {
    const takeover = await dependencies.store.updateMany({ where: { idempotencyKey: expectedKey, status: "processing", leaseExpiresAt: { lte: now } }, data: { leaseExpiresAt } });
    if (takeover.count !== 1) throw new Error("Recurring order request is already in progress");
  }

  const tag = tagForInvoice(input.invoiceId);
  const recoveredBody = await json(await dependencies.admin.graphql(FIND_RECURRING_ORDER, { variables: { query: `tag:'${tag}'` } }));
  const recovered = recoveredBody.data?.orders?.nodes?.[0];
  if (recovered?.id) {
    await dependencies.store.update({ where: { idempotencyKey: expectedKey }, data: { status: "completed", shopifyOrderId: recovered.id } });
    return { ...recovered, recovered: true };
  }

  const tags = Array.isArray(input.order.tags) ? input.order.tags : typeof input.order.tags === "string" ? input.order.tags.split(",").map((value: string) => value.trim()).filter(Boolean) : [];
  const order = { ...input.order, tags: [...new Set([...tags, tag])] };
  const createdBody = await json(await dependencies.admin.graphql(CREATE_RECURRING_ORDER, { variables: { order } }));
  const userErrors = createdBody.data?.orderCreate?.userErrors ?? [];
  if (userErrors.length) throw new Error(`Shopify orderCreate error: ${JSON.stringify(userErrors)}`);
  const created = createdBody.data?.orderCreate?.order;
  if (!created?.id) throw new Error("Shopify did not return an order ID");
  await dependencies.store.update({ where: { idempotencyKey: expectedKey }, data: { status: "completed", shopifyOrderId: created.id } });
  return { ...created, recovered: false };
}
