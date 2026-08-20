import { timingSafeEqual } from "node:crypto";
type AdminClient = { graphql(query: string, options: { variables: Record<string, unknown>; signal?: AbortSignal }): Promise<Response> };
export type RetryOperationDependencies = { apiKey?: string; timeoutMs?: number; getAdmin(shop: string): Promise<{ admin: AdminClient; session?: { shop: string } }> };
const jsonError = (status: number, error: string) => Response.json({ success: false, error }, { status });
function secretMatches(received: string, expected?: string) { if (!expected) return false; const a = Buffer.from(received), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); }
export async function handleRetryOperation(request: Request, dependencies: RetryOperationDependencies) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  if (!secretMatches(request.headers.get("x-api-key") || "", dependencies.apiKey)) return jsonError(403, "forbidden");
  let body: Record<string, any>; try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
  const shop = String(body.shop || "").toLowerCase(), contractId = String(body.contractId || ""), operation = String(body.operation || ""), idempotencyKey = String(body.idempotencyKey || "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(shop) || !/^gid:\/\/shopify\/SubscriptionContract\/[A-Za-z0-9_-]+$/.test(contractId)) return jsonError(400, "invalid_target");
  if (!["inventory", "charge"].includes(operation) || !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey) || request.headers.get("idempotency-key") !== idempotencyKey) return jsonError(400, "invalid_operation");
  let authenticated; try { authenticated = await dependencies.getAdmin(shop); } catch { return jsonError(503, "shopify_session_unavailable"); }
  if (!authenticated.session || authenticated.session.shop.toLowerCase() !== shop) return jsonError(403, "session_shop_mismatch");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8_000);
  try {
    if (operation === "inventory") {
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!lines.length || lines.some((line: any) => !/^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/.test(String(line.variantId || "")) || !Number.isInteger(line.quantity) || line.quantity < 1)) return jsonError(400, "invalid_lines");
      const response = await authenticated.admin.graphql(`#graphql
        query RetryInventory($ids: [ID!]!, $quantityNames: [String!]!) { nodes(ids: $ids) { ... on ProductVariant { id inventoryPolicy inventoryItem { tracked inventoryLevels(first: 250) { nodes { quantities(names: $quantityNames) { name quantity } } } } } } }`, { variables: { ids: lines.map((line: any) => line.variantId), quantityNames: ["available"] }, signal: controller.signal });
      const payload = await response.json() as any; if (!response.ok || payload.errors?.length) return jsonError(502, "shopify_graphql_error");
      const byId = new Map((payload.data?.nodes || []).filter(Boolean).map((node: any) => [node.id, node]));
      const checks = lines.map((line: any) => { const variant: any = byId.get(line.variantId); if (!variant) return { variantId: line.variantId, required: line.quantity, available: 0, blocked: true, reason: "variant_removed" }; if (!variant.inventoryItem?.tracked || variant.inventoryPolicy === "CONTINUE") return { variantId: line.variantId, required: line.quantity, available: null, blocked: false, reason: !variant.inventoryItem?.tracked ? "not_tracked" : "continue" }; const available = (variant.inventoryItem.inventoryLevels?.nodes || []).reduce((sum: number, level: any) => sum + Number(level.quantities?.find((q: any) => q.name === "available")?.quantity || 0), 0); return { variantId: line.variantId, required: line.quantity, available, blocked: available < line.quantity, reason: available < line.quantity ? "insufficient" : "available" }; });
      return Response.json({ success: true, available: checks.every((item: any) => !item.blocked), checks, blocked: checks.filter((item: any) => item.blocked) });
    }
    const response = await authenticated.admin.graphql(`#graphql
      mutation RetryCharge($contractId: ID!, $input: SubscriptionBillingAttemptInput!) { subscriptionBillingAttemptCreate(subscriptionContractId: $contractId, subscriptionBillingAttemptInput: $input) { subscriptionBillingAttempt { id ready errorMessage order { id } } userErrors { field message } } }`, { variables: { contractId, input: { idempotencyKey, originTime: body.billingCycleAt } }, signal: controller.signal });
    const payload = await response.json() as any; if (!response.ok || payload.errors?.length) return jsonError(502, "shopify_graphql_error"); const result = payload.data?.subscriptionBillingAttemptCreate;
    if (result?.userErrors?.length) return Response.json({ success: false, errorCode: "shopify_user_error", errorMessage: result.userErrors.map((e: any) => e.message).join("; ") }, { status: 422 });
    const attempt = result?.subscriptionBillingAttempt; if (!attempt?.id) return jsonError(502, "invalid_shopify_response");
    return Response.json({ success: true, billingAttemptId: attempt.id, status: attempt.ready ? (attempt.order?.id ? "succeeded" : attempt.errorMessage ? "failed" : "pending") : "pending", errorMessage: attempt.errorMessage });
  } catch { return controller.signal.aborted ? jsonError(504, "shopify_timeout") : jsonError(502, "shopify_unavailable"); } finally { clearTimeout(timer); }
}
