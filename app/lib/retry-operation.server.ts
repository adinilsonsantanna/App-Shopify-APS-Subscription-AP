import { timingSafeEqual } from "node:crypto";
type AdminClient = { graphql(query: string, options: { variables: Record<string, unknown>; signal?: AbortSignal }): Promise<Response> };
export type RetryOperationDependencies = { apiKey?: string; timeoutMs?: number; getAdmin(shop: string): Promise<{ admin: AdminClient; session?: { shop: string } }> };
type Envelope = { success: boolean; errorCode: string | null; errorMessage: string | null; uncertain: boolean; billingAttemptId: string | null; orderId: string | null; amount: string | null; currencyCode: string | null; status?: string; available?: boolean; checks?: unknown[]; blocked?: unknown[] };
const envelope = (values: Partial<Envelope> = {}): Envelope => ({ success: false, errorCode: null, errorMessage: null, uncertain: false, billingAttemptId: null, orderId: null, amount: null, currencyCode: null, ...values });
const jsonError = (status: number, errorCode: string, errorMessage = errorCode, uncertain = false) => Response.json(envelope({ errorCode, errorMessage, uncertain }), { status });
function secretMatches(received: string, expected?: string) { if (!expected) return false; const a = Buffer.from(received), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); }
function validIso(value: unknown) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)); }
function attemptEnvelope(attempt: any): Envelope {
  const money = attempt?.order?.currentTotalPriceSet?.shopMoney;
  if (!attempt?.id) return envelope({ errorCode: "invalid_shopify_response", errorMessage: "Shopify did not return a billing attempt", uncertain: true });
  const status = !attempt.ready ? "pending" : attempt.order?.id ? "succeeded" : attempt.errorCode || attempt.errorMessage ? "failed" : "pending";
  return envelope({ success: status !== "failed", status, uncertain: status === "pending", billingAttemptId: attempt.id, orderId: attempt.order?.id ?? null, amount: money?.amount ?? null, currencyCode: money?.currencyCode ?? null, errorCode: attempt.errorCode ?? null, errorMessage: attempt.errorMessage ?? null });
}

export async function handleRetryOperation(request: Request, dependencies: RetryOperationDependencies) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  if (!request.headers.get("x-api-key")) return jsonError(401, "unauthorized");
  if (!secretMatches(request.headers.get("x-api-key") || "", dependencies.apiKey)) return jsonError(403, "forbidden");
  let body: Record<string, any>; try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
  const shop = String(body.shop || "").toLowerCase(), contractId = String(body.contractId || ""), operation = String(body.operation || ""), idempotencyKey = String(body.idempotencyKey || "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(shop) || !/^gid:\/\/shopify\/SubscriptionContract\/[A-Za-z0-9_-]+$/.test(contractId)) return jsonError(400, "invalid_target");
  if (!["inventory", "charge", "reconcile"].includes(operation) || !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey) || request.headers.get("idempotency-key") !== idempotencyKey) return jsonError(400, "invalid_operation");
  if ((operation === "charge" || (operation === "reconcile" && !body.billingAttemptId)) && !validIso(body.billingCycleAt)) return jsonError(400, "invalid_billing_cycle_at");
  if (operation === "reconcile" && body.billingAttemptId && !/^gid:\/\/shopify\/SubscriptionBillingAttempt\/[A-Za-z0-9_-]+$/.test(String(body.billingAttemptId))) return jsonError(400, "invalid_billing_attempt_id");
  let authenticated; try { authenticated = await dependencies.getAdmin(shop); } catch { return jsonError(503, "shopify_session_unavailable", "Shopify session unavailable", true); }
  if (!authenticated.session || authenticated.session.shop.toLowerCase() !== shop) return jsonError(403, "session_shop_mismatch");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8_000);
  try {
    if (operation === "inventory") {
      const rawLines = Array.isArray(body.lines) ? body.lines : [];
      if (!rawLines.length || rawLines.some((line: any) => !/^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/.test(String(line.variantId || "")) || !Number.isInteger(line.quantity) || line.quantity < 1)) return jsonError(400, "invalid_lines");
      const totals = new Map<string, number>(); for (const line of rawLines) totals.set(line.variantId, (totals.get(line.variantId) || 0) + line.quantity);
      const lines = [...totals].map(([variantId, quantity]) => ({ variantId, quantity }));
      const response = await authenticated.admin.graphql(`#graphql
        query RetryInventory($ids: [ID!]!, $quantityNames: [String!]!) { nodes(ids: $ids) { ... on ProductVariant { id inventoryPolicy inventoryItem { tracked inventoryLevels(first: 250) { nodes { quantities(names: $quantityNames) { name quantity } } } } } } }`, { variables: { ids: lines.map(line => line.variantId), quantityNames: ["available"] }, signal: controller.signal });
      const payload = await response.json() as any; if (!response.ok || payload.errors?.length) return jsonError(502, "shopify_graphql_error", "Shopify inventory query failed", true);
      const byId = new Map((payload.data?.nodes || []).filter(Boolean).map((node: any) => [node.id, node]));
      const checks = lines.map(line => { const variant: any = byId.get(line.variantId); if (!variant) return { variantId: line.variantId, required: line.quantity, available: 0, blocked: true, reason: "variant_removed" }; if (!variant.inventoryItem?.tracked || variant.inventoryPolicy === "CONTINUE") return { variantId: line.variantId, required: line.quantity, available: null, blocked: false, reason: !variant.inventoryItem?.tracked ? "not_tracked" : "continue" }; const available = (variant.inventoryItem.inventoryLevels?.nodes || []).reduce((sum: number, level: any) => sum + Number(level.quantities?.find((q: any) => q.name === "available")?.quantity || 0), 0); return { variantId: line.variantId, required: line.quantity, available, blocked: available < line.quantity, reason: available < line.quantity ? "insufficient" : "available" }; });
      return Response.json(envelope({ success: true, available: checks.every(item => !item.blocked), checks, blocked: checks.filter(item => item.blocked) }));
    }
    if (operation === "reconcile" && body.billingAttemptId) {
      const response = await authenticated.admin.graphql(`#graphql
        query ReconcileBillingAttempt($id: ID!) { subscriptionBillingAttempt(id: $id) { id idempotencyKey ready errorCode errorMessage order { id currentTotalPriceSet { shopMoney { amount currencyCode } } } } }`, { variables: { id: body.billingAttemptId }, signal: controller.signal });
      const payload = await response.json() as any; if (!response.ok || payload.errors?.length) return jsonError(502, "shopify_graphql_error", "Shopify reconciliation query failed", true);
      const attempt = payload.data?.subscriptionBillingAttempt; if (attempt?.idempotencyKey !== idempotencyKey) return jsonError(409, "idempotency_mismatch", "Billing attempt does not match the idempotency key");
      return Response.json(attemptEnvelope(attempt));
    }
    const response = await authenticated.admin.graphql(`#graphql
      mutation RetryCharge($contractId: ID!, $input: SubscriptionBillingAttemptInput!) { subscriptionBillingAttemptCreate(subscriptionContractId: $contractId, subscriptionBillingAttemptInput: $input) { subscriptionBillingAttempt { id ready errorCode errorMessage order { id currentTotalPriceSet { shopMoney { amount currencyCode } } } } userErrors { field message } } }`, { variables: { contractId, input: { idempotencyKey, originTime: body.billingCycleAt } }, signal: controller.signal });
    const payload = await response.json() as any; if (!response.ok || payload.errors?.length) return jsonError(502, "shopify_graphql_error", "Shopify billing mutation failed", true); const result = payload.data?.subscriptionBillingAttemptCreate;
    if (result?.userErrors?.length) return jsonError(422, "shopify_user_error", result.userErrors.map((e: any) => e.message).join("; "));
    return Response.json(attemptEnvelope(result?.subscriptionBillingAttempt));
  } catch { return controller.signal.aborted ? jsonError(504, "shopify_timeout", "Shopify request timed out", true) : jsonError(502, "shopify_unavailable", "Shopify request failed", true); } finally { clearTimeout(timer); }
}
