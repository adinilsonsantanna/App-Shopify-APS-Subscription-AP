import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { createRecurringOrderIdempotently } from "../lib/recurring-order-idempotency.server";
import { unauthenticated } from "../shopify.server";

const INTERNAL_API_KEY = process.env.API_KEY || "";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const status = message.includes("already in progress") ? 409 : message.includes("Invalid") || message.includes("conflict") ? 400 : 500;
  return Response.json({ error: message }, { status });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (process.env.ENABLE_LEGACY_SUBSCRIPTION_FLOW !== "true") return Response.json({ error: "Legacy subscription flow is disabled" }, { status: 410 });
  if (request.method !== "POST") return Response.json({ error: "Method Not Allowed" }, { status: 405 });
  if (!INTERNAL_API_KEY || request.headers.get("x-api-key") !== INTERNAL_API_KEY) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const idempotencyKey = request.headers.get("idempotency-key") || "";
    const match = /^stripe-invoice:(in_[A-Za-z0-9_-]+)$/.exec(idempotencyKey);
    if (!match) throw new Error("Invalid Idempotency-Key");
    const body = await request.json() as { shop?: unknown; order?: unknown };
    const shop = String(body.shop || "").trim();
    if (!shop) throw new Error("Invalid shop");
    if (!body.order || typeof body.order !== "object" || Array.isArray(body.order)) throw new Error("Invalid order input");

    const { admin, session } = await unauthenticated.admin(shop);
    if (!session || session.shop !== shop) return Response.json({ error: "Offline Shopify session not found for shop" }, { status: 401 });
    const order = await createRecurringOrderIdempotently({ idempotencyKey, shop, invoiceId: match[1], order: body.order as Record<string, any> }, { store: prisma.recurringOrderRequest, admin });
    return Response.json({ success: true, order });
  } catch (error) {
    return errorResponse(error);
  }
};
