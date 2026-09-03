import { createHash } from "node:crypto";
import { ADMINISTRATIVE_RECONCILIATION_QUERY } from "./administrative-billing-reconciliation.server";
import { ADMIN_LIVE_CONFIRMATION_PHRASE } from "./billing-reconciliation-live";

type Admin = { graphql(query: string, options: { variables: Record<string, unknown> }): Promise<Response> };
type Authenticated = { admin: Admin; session: { shop: string } };

export type AdminReconciliationLiveTarget = {
  shop: string;
  subscriptionContractId: string;
  subscriptionBillingAttemptId: string;
  shopifyOrderId: string;
  cycleOriginTime: string;
  correlationId: string;
};

export type AdminReconciliationLiveDependencies = {
  liveEnabled: boolean;
  liveTargets: AdminReconciliationLiveTarget[];
  liveSecret: string;
  authenticate(request: Request): Promise<Authenticated>;
  fetchFn: typeof fetch;
  apiUrl?: string;
  apiKey?: string;
  logger: Pick<Console, "error" | "info">;
  requestId: string;
};

export const ADMIN_LIVE_RECONCILIATION_PATH = "/app/billing-reconciliation/execute-live";
export { ADMIN_LIVE_CONFIRMATION_PHRASE };
export const ADMIN_LIVE_RECONCILIATION_RESOURCE_PATH = ADMIN_LIVE_RECONCILIATION_PATH;

const gid = (value: unknown, resource: string) => typeof value === "string" && new RegExp(`^gid://shopify/${resource}/[1-9][0-9]*$`).test(value);
const string = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_request_body"); return value as Record<string, unknown>; }
function jsonError(status: number, error: string, requestId: string) { return Response.json({ error, requestId }, { status }); }
const MAX_LIVE_BODY_BYTES = 4 * 1024;
class LiveBodyError extends Error { constructor(readonly code: string, readonly status = 400) { super(code); } }
async function readLiveJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new LiveBodyError("unsupported_content_type", 415);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_LIVE_BODY_BYTES)) throw new LiveBodyError("payload_too_large", 413);
  if (!request.body) throw new LiveBodyError("invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let reading = true;
  while (reading) {
    const { done, value } = await reader.read();
    if (done) {
      reading = false;
      continue;
    }
    size += value.byteLength;
    if (size > MAX_LIVE_BODY_BYTES) {
      await reader.cancel();
      throw new LiveBodyError("payload_too_large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
  catch { throw new LiveBodyError("invalid_json"); }
}
function logFailure(dependencies: AdminReconciliationLiveDependencies, event: string, error: unknown, shop?: string) {
  dependencies.logger.error(JSON.stringify({ event, route: ADMIN_LIVE_RECONCILIATION_PATH, requestId: dependencies.requestId, errorClass: error instanceof Error ? (error.name || "UnknownError") : "UnknownError", ...(shop ? { shop } : {}) }));
}
function logInfo(dependencies: AdminReconciliationLiveDependencies, event: string, stage: string, extra: Record<string, unknown> = {}) {
  dependencies.logger.info(JSON.stringify({ event, route: ADMIN_LIVE_RECONCILIATION_PATH, requestId: dependencies.requestId, stage, ...extra }));
}

export function parseLiveTargets(raw: string | undefined): AdminReconciliationLiveTarget[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const targets: AdminReconciliationLiveTarget[] = [];
  const allowedKeys = ["shop", "subscriptionContractId", "subscriptionBillingAttemptId", "shopifyOrderId", "cycleOriginTime", "correlationId"].sort();
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const t = item as Record<string, unknown>;
    if (JSON.stringify(Object.keys(t).sort()) !== JSON.stringify(allowedKeys)) return [];
    if (typeof t.shop !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(t.shop) || !gid(t.subscriptionContractId, "SubscriptionContract") || !gid(t.subscriptionBillingAttemptId, "SubscriptionBillingAttempt") || !gid(t.shopifyOrderId, "Order") || typeof t.cycleOriginTime !== "string" || Number.isNaN(Date.parse(t.cycleOriginTime)) || typeof t.correlationId !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(t.correlationId)) return [];
    targets.push({ shop: t.shop.toLowerCase(), subscriptionContractId: t.subscriptionContractId as string, subscriptionBillingAttemptId: t.subscriptionBillingAttemptId as string, shopifyOrderId: t.shopifyOrderId as string, cycleOriginTime: t.cycleOriginTime, correlationId: t.correlationId });
  }
  return new Set(targets.map((target) => target.shop)).size === targets.length ? targets : [];
}

export function selectAuthenticatedLiveTarget(
  shopDomain: unknown,
  targets: AdminReconciliationLiveTarget[],
): AdminReconciliationLiveTarget | null {
  if (typeof shopDomain !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain)) return null;
  const normalizedShop = shopDomain.toLowerCase();
  const matches = targets.filter((target) => target.shop === normalizedShop);
  return matches.length === 1 ? matches[0] : null;
}

export async function handleAdministrativeBillingReconciliationLive(request: Request, dependencies: AdminReconciliationLiveDependencies) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed", dependencies.requestId);

  if (!dependencies.liveEnabled) return jsonError(503, "live_disabled", dependencies.requestId);

  let authenticated: Authenticated;
  try {
    logInfo(dependencies, "live_authentication_started", "authenticating");
    authenticated = await dependencies.authenticate(request);
    logInfo(dependencies, "live_authentication_completed", "authenticated");
  } catch (error) {
    if (error instanceof Response) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 401;
      return jsonError(status, "shopify_authentication_required", dependencies.requestId);
    }
    logFailure(dependencies, "live_authentication_failed", error);
    return jsonError(503, "shopify_authentication_unavailable", dependencies.requestId);
  }
  const shop = authenticated.session.shop.toLowerCase();

  let input: Record<string, unknown>;
  try { input = await readLiveJsonBody(request); }
  catch (error) { return error instanceof LiveBodyError ? jsonError(error.status, error.code, dependencies.requestId) : jsonError(400, "invalid_json", dependencies.requestId); }
  const allowedInputKeys = ["subscriptionContractId", "subscriptionBillingAttemptId", "shopifyOrderId", "cycleOriginTime", "correlationId", "confirmation"].sort();
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(allowedInputKeys)) return jsonError(400, "unexpected_field", dependencies.requestId);

  const confirmation = input.confirmation;
  if (confirmation !== ADMIN_LIVE_CONFIRMATION_PHRASE) {
    return jsonError(400, "live_confirmation_required", dependencies.requestId);
  }

  if (!dependencies.liveTargets || dependencies.liveTargets.length === 0) return jsonError(503, "live_target_not_authorized", dependencies.requestId);
  const authorized = dependencies.liveTargets.find((t) => t.shop === shop);
  if (!authorized) return jsonError(403, "shop_not_authorized", dependencies.requestId);

  const attemptId = input.subscriptionBillingAttemptId, contractId = input.subscriptionContractId, orderId = input.shopifyOrderId, cycle = input.cycleOriginTime, correlationId = input.correlationId;
  if (!gid(attemptId, "SubscriptionBillingAttempt") || !gid(contractId, "SubscriptionContract") || !gid(orderId, "Order") || typeof cycle !== "string" || Number.isNaN(Date.parse(cycle)) || typeof correlationId !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(correlationId)) {
    return jsonError(400, "invalid_target", dependencies.requestId);
  }
  if (attemptId !== authorized.subscriptionBillingAttemptId || contractId !== authorized.subscriptionContractId || orderId !== authorized.shopifyOrderId || cycle !== authorized.cycleOriginTime || correlationId !== authorized.correlationId) {
    return jsonError(403, "target_not_authorized", dependencies.requestId);
  }

  if (!dependencies.apiUrl) return jsonError(503, "api_subscription_url_missing", dependencies.requestId);
  if (!dependencies.apiKey) return jsonError(503, "api_key_missing", dependencies.requestId);
  if (!dependencies.liveSecret) return jsonError(503, "live_secret_missing", dependencies.requestId);

  try {
    logInfo(dependencies, "live_shopify_read_started", "reading_shopify", { shop });
    const response = await authenticated.admin.graphql(ADMINISTRATIVE_RECONCILIATION_QUERY, { variables: { attemptId } });
    const body = object(await response.json());
    if (!response.ok || (Array.isArray(body.errors) && body.errors.length > 0)) return jsonError(502, "shopify_query_failed", dependencies.requestId);
    const data = object(body.data), shopNode = object(data.shop), attempt = object(data.subscriptionBillingAttempt), contract = object(attempt.subscriptionContract), state = object(attempt.state), order = object(state.order), money = object(object(order.currentTotalPriceSet).shopMoney);
    if (!gid(shopNode.id, "Shop") || state.__typename !== "SubscriptionBillingAttemptSuccessState" || attempt.id !== attemptId || contract.id !== contractId || order.id !== orderId || attempt.originTime !== cycle || order.test !== true || order.displayFinancialStatus !== "PAID") return jsonError(409, "shopify_identity_mismatch", dependencies.requestId);
    const transactions = Array.isArray(order.transactions) ? order.transactions : [];
    if (!transactions.some((transaction: unknown) => {
      if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) return false;
      const record = transaction as Record<string, unknown>;
      return record.gateway === "bogus" && record.test === true && record.status === "SUCCESS";
    })) return jsonError(409, "shopify_test_gateway_mismatch", dependencies.requestId);
    const completedAt = string(attempt.completedAt), orderProcessedAt = string(order.processedAt), amount = string(money.amount), currencyCode = string(money.currencyCode);
    if (!completedAt || !orderProcessedAt || !amount || !currencyCode) return jsonError(409, "shopify_reconciliation_incomplete", dependencies.requestId);
    logInfo(dependencies, "live_shopify_read_completed", "shopify_read_done", { shop });

    const apiUrl = dependencies.apiUrl.replace(/\/$/, "");
    logInfo(dependencies, "central_live_started", "calling_central", { shop });
    const outbound = {
      shopDomain: shop,
      shopId: shopNode.id,
      subscriptionContractId: contract.id,
      subscriptionBillingAttemptId: attempt.id,
      shopifyOrderId: order.id,
      cycleOriginTime: attempt.originTime,
      status: "succeeded",
      amount,
      currencyCode,
      attemptedAt: completedAt,
      completedAt,
      orderProcessedAt,
      test: true,
      gateway: "bogus",
      correlationId,
      dryRun: false,
    };
    const outboundKeys = Object.keys(outbound).sort();
    const fingerprint = createHash("sha256").update(JSON.stringify(outboundKeys)).digest("hex");
    logInfo(dependencies, "central_live_outbound_keys", "pre_central", {
      keyCount: outboundKeys.length,
      keyNames: outboundKeys.join(","),
      fingerprint,
      correlationId,
    });
    const central = await dependencies.fetchFn(`${apiUrl}/api/administrative-reconciliation/billing-attempt/live`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": dependencies.apiKey,
        "x-admin-live-key": dependencies.liveSecret,
      },
      body: JSON.stringify(outbound),
    });
    logInfo(dependencies, "central_live_completed", "central_done", { shop, status: central.status });
    let result: unknown;
    try { result = await central.json(); } catch {
      logFailure(dependencies, "central_live_invalid_json", new Error("central non-json response"));
      if (!central.ok) return jsonError(502, "central_api_error", dependencies.requestId);
      return jsonError(502, "central_api_invalid_response", dependencies.requestId);
    }
    const centralRequestId = (() => {
      if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
      const value = (result as Record<string, unknown>).requestId;
      return typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : undefined;
    })();
    logInfo(dependencies, "central_live_response", "central_response", {
      status: central.status,
      correlationId,
      ...(centralRequestId ? { centralRequestId } : {}),
    });
    if (!central.ok) {
      const err = object(result);
      return Response.json({ error: typeof err.error === "string" ? err.error : "central_api_error", requestId: dependencies.requestId }, { status: central.status >= 400 && central.status < 600 ? central.status : 502 });
    }
    return Response.json(result, { status: central.status });
  } catch (error) {
    logFailure(dependencies, "live_resource_action_failed", error, shop);
    return jsonError(502, "administrative_reconciliation_live_failed", dependencies.requestId);
  }
}
