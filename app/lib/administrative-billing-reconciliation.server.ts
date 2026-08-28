type Admin = { graphql(query: string, options: { variables: Record<string, unknown> }): Promise<Response> };
type Authenticated = { admin: Admin; session: { shop: string } };
export type AdminReconciliationDependencies = {
  authenticate(request: Request): Promise<Authenticated>;
  fetchFn: typeof fetch;
  apiUrl?: string;
  apiKey?: string;
  logger: Pick<Console, "error">;
  requestId: string;
};

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
function errorClass(error: unknown) { return error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : "UnknownError"; }
function jsonError(status: number, error: string, requestId: string) { return Response.json({ error, requestId }, { status }); }
function logFailure(dependencies: AdminReconciliationDependencies, event: string, error: unknown, shop?: string) {
  dependencies.logger.error(JSON.stringify({ event, route: "/app/billing-reconciliation", requestId: dependencies.requestId, errorClass: errorClass(error), ...(shop ? { shop } : {}) }));
}

export async function handleAdministrativeBillingReconciliation(request: Request, dependencies: AdminReconciliationDependencies) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed", dependencies.requestId);
  let authenticated: Authenticated;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (error) {
    if (error instanceof Response) return jsonError(401, "shopify_authentication_required", dependencies.requestId);
    logFailure(dependencies, "administrative_reconciliation.authentication_failed", error);
    return jsonError(503, "shopify_authentication_unavailable", dependencies.requestId);
  }
  let input: Record<string, unknown>;
  try { input = object(await request.json()); } catch { return jsonError(400, "invalid_json", dependencies.requestId); }
  const attemptId = input.subscriptionBillingAttemptId, expectedContractId = input.subscriptionContractId, expectedOrderId = input.shopifyOrderId, expectedCycle = input.cycleOriginTime, correlationId = input.correlationId;
  if (!gid(attemptId, "SubscriptionBillingAttempt") || !gid(expectedContractId, "SubscriptionContract") || !gid(expectedOrderId, "Order") || typeof expectedCycle !== "string" || Number.isNaN(Date.parse(expectedCycle)) || typeof correlationId !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(correlationId) || typeof input.dryRun !== "boolean") return jsonError(400, "invalid_target", dependencies.requestId);
  if (!dependencies.apiUrl) return jsonError(503, "api_subscription_url_missing", dependencies.requestId);
  if (!dependencies.apiKey) return jsonError(503, "api_key_missing", dependencies.requestId);
  try {
    const response = await authenticated.admin.graphql(ADMINISTRATIVE_RECONCILIATION_QUERY, { variables: { attemptId } });
    const body = object(await response.json());
    if (!response.ok || body.errors?.length) return jsonError(502, "shopify_query_failed", dependencies.requestId);
    const data = object(body.data), shop = object(data.shop), attempt = object(data.subscriptionBillingAttempt), contract = object(attempt.subscriptionContract), state = object(attempt.state), order = object(state.order), money = object(object(order.currentTotalPriceSet).shopMoney);
    if (!gid(shop.id, "Shop") || state.__typename !== "SubscriptionBillingAttemptSuccessState" || attempt.id !== attemptId || contract.id !== expectedContractId || order.id !== expectedOrderId || attempt.originTime !== expectedCycle || order.test !== true || order.displayFinancialStatus !== "PAID") return jsonError(409, "shopify_identity_mismatch", dependencies.requestId);
    const transactions = Array.isArray(order.transactions) ? order.transactions : [];
    if (!transactions.some((transaction: any) => transaction?.gateway === "bogus" && transaction?.test === true && transaction?.status === "SUCCESS")) return jsonError(409, "shopify_test_gateway_mismatch", dependencies.requestId);
    const completedAt = string(attempt.completedAt), amount = string(money.amount), currencyCode = string(money.currencyCode);
    if (!completedAt || !amount || !currencyCode) return jsonError(409, "shopify_reconciliation_incomplete", dependencies.requestId);
    const apiUrl = dependencies.apiUrl.replace(/\/$/, "");
    const central = await dependencies.fetchFn(`${apiUrl}/api/administrative-reconciliation/billing-attempt`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": dependencies.apiKey }, body: JSON.stringify({ shopDomain: authenticated.session.shop.toLowerCase(), shopId: shop.id, subscriptionContractId: contract.id, subscriptionBillingAttemptId: attempt.id, shopifyOrderId: order.id, cycleOriginTime: attempt.originTime, status: "succeeded", amount, currencyCode, attemptedAt: completedAt, completedAt, test: true, gateway: "bogus", correlationId, dryRun: input.dryRun }) });
    let result: unknown;
    try { result = await central.json(); } catch (error) { logFailure(dependencies, "administrative_reconciliation.central_api_invalid_json", error, authenticated.session.shop); return jsonError(502, "central_api_invalid_response", dependencies.requestId); }
    return Response.json(result, { status: central.status });
  } catch (error) {
    logFailure(dependencies, "administrative_reconciliation.operation_failed", error, authenticated.session.shop);
    return jsonError(502, "administrative_reconciliation_failed", dependencies.requestId);
  }
}
