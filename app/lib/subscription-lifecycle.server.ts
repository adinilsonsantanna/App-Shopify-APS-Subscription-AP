import { timingSafeEqual } from "node:crypto";

export type LifecycleAction = "pause" | "resume" | "cancel";
export type SubscriptionActor = "CUSTOMER" | "MERCHANT" | "PARTNER";
type AdminClient = { graphql(query: string, options: { variables: Record<string, unknown>; signal?: AbortSignal }): Promise<Response> };

export interface LifecycleDependencies {
  apiKey?: string;
  timeoutMs?: number;
  getAdmin(shop: string): Promise<{ admin: AdminClient; session?: { shop: string } }>;
}

const OPERATIONS: Record<LifecycleAction, { field: string; operation: string }> = {
  pause: { field: "subscriptionContractPause", operation: "PauseSubscriptionContract" },
  resume: { field: "subscriptionContractActivate", operation: "ActivateSubscriptionContract" },
  cancel: { field: "subscriptionContractCancel", operation: "CancelSubscriptionContract" },
};
const TARGET_STATUS: Record<LifecycleAction, string> = { pause: "PAUSED", resume: "ACTIVE", cancel: "CANCELLED" };

function secretMatches(received: string, expected?: string) {
  if (!expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function jsonError(status: number, code: string, message: string) {
  return Response.json({ success: false, error: { code, message } }, { status });
}

export async function handleSubscriptionLifecycle(request: Request, dependencies: LifecycleDependencies): Promise<Response> {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed", "Method not allowed");
  if (!secretMatches(request.headers.get("x-api-key") || "", dependencies.apiKey)) return jsonError(403, "forbidden", "Forbidden");

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return jsonError(400, "invalid_json", "Invalid JSON body"); }

  const shop = typeof body.shop === "string" ? body.shop.trim().toLowerCase() : "";
  const contractId = typeof body.contractId === "string" ? body.contractId.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() as LifecycleAction : "" as LifecycleAction;
  const actor = typeof body.actor === "string" ? body.actor.trim().toUpperCase() as SubscriptionActor : "" as SubscriptionActor;
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(shop)) return jsonError(400, "invalid_shop", "Invalid Shopify shop domain");
  if (!/^gid:\/\/shopify\/SubscriptionContract\/[A-Za-z0-9_-]+$/.test(contractId)) return jsonError(400, "invalid_contract", "Invalid Shopify contract ID");
  if (!Object.hasOwn(OPERATIONS, action)) return jsonError(400, "invalid_action", "Invalid lifecycle action");
  if (!["CUSTOMER", "MERCHANT", "PARTNER"].includes(actor)) return jsonError(400, "invalid_actor", "Invalid subscription actor");
  if (!requestId || requestId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(requestId)) return jsonError(400, "invalid_request_id", "Invalid request ID");

  let authenticated: Awaited<ReturnType<LifecycleDependencies["getAdmin"]>>;
  try { authenticated = await dependencies.getAdmin(shop); }
  catch { return jsonError(503, "shopify_session_unavailable", "Shopify session unavailable"); }
  if (!authenticated.session) return jsonError(404, "offline_session_not_found", "Offline Shopify session not found");
  if (authenticated.session.shop.toLowerCase() !== shop) return jsonError(403, "session_shop_mismatch", "Shopify session does not match shop");

  const operation = OPERATIONS[action];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8_000);
  try {
    const stateResponse = await authenticated.admin.graphql(`#graphql
      query LifecycleContractStatus($subscriptionContractId: ID!) {
        subscriptionContract(id: $subscriptionContractId) { id status }
      }`, { variables: { subscriptionContractId: contractId }, signal: controller.signal });
    const stateResult = await stateResponse.json() as { errors?: unknown[]; data?: { subscriptionContract?: { id?: string; status?: string } | null } };
    if (!stateResponse.ok || stateResult.errors?.length) return jsonError(502, "shopify_graphql_error", "Shopify GraphQL request failed");
    if (!stateResult.data?.subscriptionContract?.id || !stateResult.data.subscriptionContract.status) return jsonError(404, "contract_not_found", "Subscription contract not found");
    if (stateResult.data.subscriptionContract.status === TARGET_STATUS[action]) return Response.json({ success: true, duplicate: true, requestId, action, contractId, status: TARGET_STATUS[action] });
    const response = await authenticated.admin.graphql(`#graphql
      mutation ${operation.operation}($subscriptionContractId: ID!, $actor: SubscriptionActor) {
        ${operation.field}(subscriptionContractId: $subscriptionContractId, actor: $actor) {
          contract { id status }
          userErrors { field message }
        }
      }`, { variables: { subscriptionContractId: contractId, actor }, signal: controller.signal });
    const result = await response.json() as { errors?: unknown[]; data?: Record<string, { contract?: { id?: string; status?: string }; userErrors?: Array<{ field?: string[]; message?: string }> }> };
    if (!response.ok || (result.errors?.length ?? 0) > 0) return jsonError(502, "shopify_graphql_error", "Shopify GraphQL request failed");
    const payload = result.data?.[operation.field];
    if (payload?.userErrors?.length) return Response.json({ success: false, error: { code: "shopify_user_error", message: "Shopify rejected lifecycle action", details: payload.userErrors.map((e) => ({ field: e.field, message: String(e.message || "").slice(0, 250) })) } }, { status: 422 });
    if (!payload?.contract?.id || !payload.contract.status) return jsonError(502, "invalid_shopify_response", "Shopify did not confirm lifecycle action");
    return Response.json({ success: true, requestId, action, contractId: payload.contract.id, status: payload.contract.status });
  } catch (error) {
    if (controller.signal.aborted) return jsonError(504, "shopify_timeout", "Shopify lifecycle request timed out");
    return jsonError(502, "shopify_unavailable", "Shopify lifecycle request failed");
  } finally { clearTimeout(timer); }
}
