type Admin = { graphql(query: string, options: { variables: Record<string, unknown> }): Promise<Response> };
type Authenticated = { admin: Admin; session: { shop: string } };
export type AdminReconciliationDependencies = { authenticate(request: Request): Promise<Authenticated>; fetchFn: typeof fetch; apiUrl?: string; apiKey?: string; logger: { error(message: string, metadata?: Record<string, unknown>): void } };

export const ADMINISTRATIVE_RECONCILIATION_QUERY = `#graphql
query AdministrativeBillingReconciliation($attemptId: ID!) {
  shop { id }
  subscriptionBillingAttempt(id: $attemptId) {
    id originTime createdAt completedAt
    subscriptionContract { id }
    state {
      __typename
      ... on SubscriptionBillingAttemptSuccessState {
        order {
          id test displayFinancialStatus processedAt
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          transactions(first: 10) { gateway test status }
        }
      }
    }
  }
}`;
const gid = (value: unknown, resource: string) => typeof value === "string" && new RegExp(`^gid://shopify/${resource}/[1-9][0-9]*$`).test(value);
const string = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
function object(value: unknown): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_shopify_response"); return value as Record<string, any>; }

export async function handleAdministrativeBillingReconciliation(request: Request, dependencies: AdminReconciliationDependencies) {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  let authenticated: Authenticated;
  try { authenticated = await dependencies.authenticate(request); } catch { return Response.json({ error: "shopify_authentication_required" }, { status: 401 }); }
  let input: Record<string, unknown>;
  try { input = object(await request.json()); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const attemptId = input.subscriptionBillingAttemptId, expectedContractId = input.subscriptionContractId, expectedOrderId = input.shopifyOrderId, expectedCycle = input.cycleOriginTime, correlationId = input.correlationId;
  if (!gid(attemptId, "SubscriptionBillingAttempt") || !gid(expectedContractId, "SubscriptionContract") || !gid(expectedOrderId, "Order") || typeof expectedCycle !== "string" || Number.isNaN(Date.parse(expectedCycle)) || typeof correlationId !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(correlationId) || typeof input.dryRun !== "boolean") return Response.json({ error: "invalid_target" }, { status: 400 });
  try {
    const response = await authenticated.admin.graphql(ADMINISTRATIVE_RECONCILIATION_QUERY, { variables: { attemptId } });
    const body = object(await response.json()); if (!response.ok || body.errors?.length) throw new Error("shopify_query_failed");
    const data = object(body.data), shop = object(data.shop), attempt = object(data.subscriptionBillingAttempt), contract = object(attempt.subscriptionContract), state = object(attempt.state), order = object(state.order), money = object(object(order.currentTotalPriceSet).shopMoney);
    if (!gid(shop.id, "Shop") || state.__typename !== "SubscriptionBillingAttemptSuccessState" || attempt.id !== attemptId || contract.id !== expectedContractId || order.id !== expectedOrderId || attempt.originTime !== expectedCycle || order.test !== true || order.displayFinancialStatus !== "PAID") return Response.json({ error: "shopify_identity_mismatch" }, { status: 409 });
    const transactions = Array.isArray(order.transactions) ? order.transactions : [];
    if (!transactions.some((transaction: any) => transaction?.gateway === "bogus" && transaction?.test === true && transaction?.status === "SUCCESS")) return Response.json({ error: "shopify_test_gateway_mismatch" }, { status: 409 });
    const completedAt = string(attempt.completedAt), amount = string(money.amount), currencyCode = string(money.currencyCode);
    if (!completedAt || !amount || !currencyCode) return Response.json({ error: "shopify_reconciliation_incomplete" }, { status: 409 });
    const apiUrl = dependencies.apiUrl?.replace(/\/$/, ""), apiKey = dependencies.apiKey;
    if (!apiUrl || !apiKey) return Response.json({ error: "central_api_not_configured" }, { status: 503 });
    const central = await dependencies.fetchFn(`${apiUrl}/api/administrative-reconciliation/billing-attempt`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey }, body: JSON.stringify({ shopDomain: authenticated.session.shop.toLowerCase(), shopId: shop.id, subscriptionContractId: contract.id, subscriptionBillingAttemptId: attempt.id, shopifyOrderId: order.id, cycleOriginTime: attempt.originTime, status: "succeeded", amount, currencyCode, attemptedAt: completedAt, completedAt, test: true, gateway: "bogus", correlationId, dryRun: input.dryRun }) });
    const result = await central.json(); return Response.json(result, { status: central.status });
  } catch (error) { dependencies.logger.error("[Administrative reconciliation] Read-only reconciliation failed", { shop: authenticated.session.shop, errorType: error instanceof Error ? error.name : "UnknownError" }); return Response.json({ error: "administrative_reconciliation_failed" }, { status: 502 }); }
}
