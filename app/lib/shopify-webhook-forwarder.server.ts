import type { ActionFunctionArgs } from "react-router";

export const forwardedShopifyTopics = ["subscription_contracts/create", "subscription_contracts/update", "subscription_billing_attempts/success", "subscription_billing_attempts/failure", "subscription_billing_attempts/challenged", "app/uninstalled"] as const;
export type ForwardedShopifyTopic = (typeof forwardedShopifyTopics)[number];
type AdminClient = { graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> };
export interface AuthenticatedWebhookResult { shop: string; topic: string; payload: unknown; session?: unknown; admin?: AdminClient; triggeredAt?: string; webhookId?: string; eventId?: string }
export interface NormalizedContract {
  id: string; revisionId?: string; status: string; nextBillingAt?: string; currencyCode: string;
  originOrder?: { id: string; financialStatus?: string; amount?: string; currencyCode?: string; processedAt?: string };
  customer?: { id: string; email?: string; name?: string };
  billingPolicy: { interval: string; intervalCount: number }; deliveryPolicy: { interval: string; intervalCount: number };
  lines: Array<{ id: string; title?: string; productId?: string; variantId?: string; quantity: number; currentPrice: { amount: string; currencyCode: string }; sellingPlanId?: string }>;
}
export interface NormalizedBillingAttempt {
  id: string; idempotencyKey: string; cycleOriginTime?: string; createdAt?: string; completedAt?: string;
  state: "pending" | "succeeded" | "failed"; contractId: string; nextBillingAt?: string;
  order?: { id: string; processedAt?: string; test: boolean; financialStatus?: string; amount: string; currencyCode: string; subtotal?: string; shipping?: string; tax?: string };
  reconciliationStatus: "complete" | "pending";
}
export interface WebhookForwarderDependencies {
  fetchFn: typeof fetch; environment: Record<string, string | undefined>; now(): Date;
  loadContract(admin: AdminClient, id: string): Promise<{ shopifyShopId: string; contract: NormalizedContract }>;
  loadBillingAttempt?(admin: AdminClient, id: string): Promise<{ shopifyShopId: string; billingAttempt: NormalizedBillingAttempt }>;
  budgetMs?: number;
  logger: { error(message: string, metadata: Record<string, unknown>): void; info(message: string, metadata: Record<string, unknown>): void };
}

const CONTRACT_QUERY = `#graphql
query ApsEnrichedSubscriptionContract($id: ID!) {
  shop { id }
  subscriptionContract(id: $id) {
    id status nextBillingDate currencyCode
    billingPolicy { interval intervalCount }
    deliveryPolicy { interval intervalCount }
    originOrder { id displayFinancialStatus processedAt totalPriceSet { shopMoney { amount currencyCode } } }
    customer { id displayName defaultEmailAddress { emailAddress } }
    lines(first: 100) { nodes { id title quantity currentPrice { amount currencyCode } productId variantId sellingPlanId } }
  }
}`;
const BILLING_ATTEMPT_QUERY = `#graphql
query ApsEnrichedBillingAttempt($id: ID!) {
  shop { id }
  subscriptionBillingAttempt(id: $id) {
    id idempotencyKey originTime createdAt completedAt
    subscriptionContract { id nextBillingDate }
    state {
      __typename
      ... on SubscriptionBillingAttemptPendingState { processing }
      ... on SubscriptionBillingAttemptSuccessState {
        order {
          id processedAt test displayFinancialStatus
          currentSubtotalPriceSet { shopMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          currentTotalTaxSet { shopMoney { amount currencyCode } }
          currentTotalPriceSet { shopMoney { amount currencyCode } }
        }
      }
      ... on SubscriptionBillingAttemptFailedState { error { __typename } }
    }
  }
}`;
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Shopify contract response"); return value as Record<string, unknown>; }
function text(value: unknown, required = false) { if (typeof value === "string" && value.trim()) return value; if (required) throw new Error("Invalid Shopify contract response"); return undefined; }
function count(value: unknown) { if (!Number.isInteger(value) || Number(value) < 1) throw new Error("Invalid Shopify contract response"); return Number(value); }
function normalizeContract(value: unknown): NormalizedContract {
  const c = object(value), billing = object(c.billingPolicy), delivery = object(c.deliveryPolicy), lines = object(c.lines);
  if (!Array.isArray(lines.nodes)) throw new Error("Invalid Shopify contract response");
  const order = c.originOrder ? object(c.originOrder) : undefined, money = order?.totalPriceSet ? object(object(order.totalPriceSet).shopMoney) : undefined;
  const customer = c.customer ? object(c.customer) : undefined, email = customer?.defaultEmailAddress ? object(customer.defaultEmailAddress) : undefined;
  return { id: text(c.id, true)!, status: text(c.status, true)!, ...(text(c.nextBillingDate) && { nextBillingAt: text(c.nextBillingDate) }), currencyCode: text(c.currencyCode, true)!,
    billingPolicy: { interval: text(billing.interval, true)!, intervalCount: count(billing.intervalCount) }, deliveryPolicy: { interval: text(delivery.interval, true)!, intervalCount: count(delivery.intervalCount) },
    ...(order && { originOrder: { id: text(order.id, true)!, ...(text(order.displayFinancialStatus) && { financialStatus: text(order.displayFinancialStatus) }), ...(text(money?.amount) && { amount: text(money?.amount) }), ...(text(money?.currencyCode) && { currencyCode: text(money?.currencyCode) }), ...(text(order.processedAt) && { processedAt: text(order.processedAt) }) } }),
    ...(customer && { customer: { id: text(customer.id, true)!, ...(text(email?.emailAddress) && { email: text(email?.emailAddress) }), ...(text(customer.displayName) && { name: text(customer.displayName) }) } }),
    lines: lines.nodes.map((item) => { const line = object(item), price = object(line.currentPrice); return { id: text(line.id, true)!, ...(text(line.title) && { title: text(line.title) }), ...(text(line.productId) && { productId: text(line.productId) }), ...(text(line.variantId) && { variantId: text(line.variantId) }), quantity: count(line.quantity), currentPrice: { amount: text(price.amount, true)!, currencyCode: text(price.currencyCode, true)! }, ...(text(line.sellingPlanId) && { sellingPlanId: text(line.sellingPlanId) }) }; }),
  };
}
async function loadContract(admin: AdminClient, id: string) { const response = await admin.graphql(CONTRACT_QUERY, { variables: { id } }); if (!response.ok) throw new Error("Shopify contract query failed"); const body = object(await response.json()); if (Array.isArray(body.errors) && body.errors.length) throw new Error("Shopify contract query failed"); const data = object(body.data); if (!data.subscriptionContract) throw new Error("Shopify contract not found"); const shop = object(data.shop); const shopifyShopId = text(shop.id, true)!; if (!/^gid:\/\/shopify\/Shop\/[^/]+$/.test(shopifyShopId)) throw new Error("Invalid Shopify shop identifier"); return { shopifyShopId, contract: normalizeContract(data.subscriptionContract) }; }
function optionalMoney(value: unknown) { if (!value) return undefined; const money = object(object(value).shopMoney); const amount = text(money.amount), currencyCode = text(money.currencyCode); return amount && currencyCode ? { amount, currencyCode } : undefined; }
function normalizeBillingAttempt(value: unknown): NormalizedBillingAttempt {
  const attempt = object(value), contract = object(attempt.subscriptionContract), state = object(attempt.state), type = text(state.__typename, true)!;
  const normalizedState = type === "SubscriptionBillingAttemptSuccessState" ? "succeeded" : type === "SubscriptionBillingAttemptFailedState" ? "failed" : "pending";
  const order = normalizedState === "succeeded" && state.order ? object(state.order) : undefined;
  const total = order?.currentTotalPriceSet ? optionalMoney(order.currentTotalPriceSet) : undefined;
  if (normalizedState === "succeeded" && (!order || !total)) throw new Error("Successful billing attempt is missing order totals");
  return {
    id: text(attempt.id, true)!, idempotencyKey: text(attempt.idempotencyKey, true)!,
    ...(text(attempt.originTime) && { cycleOriginTime: text(attempt.originTime) }), createdAt: text(attempt.createdAt, true)!,
    ...(text(attempt.completedAt) && { completedAt: text(attempt.completedAt) }), state: normalizedState,
    contractId: text(contract.id, true)!, ...(text(contract.nextBillingDate) && { nextBillingAt: text(contract.nextBillingDate) }),
    ...(order && total && { order: { id: text(order.id, true)!, ...(text(order.processedAt) && { processedAt: text(order.processedAt) }), test: order.test === true, ...(text(order.displayFinancialStatus) && { financialStatus: text(order.displayFinancialStatus) }), amount: total.amount, currencyCode: total.currencyCode, ...(optionalMoney(order.currentSubtotalPriceSet)?.amount && { subtotal: optionalMoney(order.currentSubtotalPriceSet)!.amount }), ...(optionalMoney(order.totalShippingPriceSet)?.amount && { shipping: optionalMoney(order.totalShippingPriceSet)!.amount }), ...(optionalMoney(order.currentTotalTaxSet)?.amount && { tax: optionalMoney(order.currentTotalTaxSet)!.amount }) } }),
    reconciliationStatus: "complete",
  };
}
async function loadBillingAttempt(admin: AdminClient, id: string) { const response = await admin.graphql(BILLING_ATTEMPT_QUERY, { variables: { id } }); if (!response.ok) throw new Error("Shopify billing attempt query failed"); const body = object(await response.json()); if (Array.isArray(body.errors) && body.errors.length) throw new Error("Shopify billing attempt query failed"); const data = object(body.data); if (!data.subscriptionBillingAttempt) throw new Error("Shopify billing attempt not found"); const shop = object(data.shop), shopifyShopId = text(shop.id, true)!; if (!/^gid:\/\/shopify\/Shop\/[^/]+$/.test(shopifyShopId)) throw new Error("Invalid Shopify shop identifier"); return { shopifyShopId, billingAttempt: normalizeBillingAttempt(data.subscriptionBillingAttempt) }; }
const topicNames: Record<string, ForwardedShopifyTopic> = { APP_UNINSTALLED: "app/uninstalled", SUBSCRIPTION_CONTRACTS_CREATE: "subscription_contracts/create", SUBSCRIPTION_CONTRACTS_UPDATE: "subscription_contracts/update", SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS: "subscription_billing_attempts/success", SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE: "subscription_billing_attempts/failure", SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED: "subscription_billing_attempts/challenged" };
const productionDependencies: WebhookForwarderDependencies = { fetchFn: fetch, environment: process.env, now: () => new Date(), loadContract, loadBillingAttempt, logger: console };
function required(env: Record<string, string | undefined>, name: "API_SUBSCRIPTION_URL" | "API_KEY") { const value = env[name]; if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; }
function contractId(payload: unknown) { const data = object(payload), candidate = data.admin_graphql_api_id ?? data.id, raw = text(candidate) ?? (typeof candidate === "number" && Number.isFinite(candidate) ? String(candidate) : undefined); if (!raw) throw new Error("Shopify contract identifier unavailable"); return raw.startsWith("gid://") ? raw : `gid://shopify/SubscriptionContract/${raw}`; }
function optionalIdentifier(value: unknown) { return text(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : undefined); }
function billingAttemptId(payload: unknown) { const data = object(payload), candidate = data.admin_graphql_api_id ?? data.id, raw = optionalIdentifier(candidate); if (!raw) throw new Error("Shopify billing attempt identifier unavailable"); return raw.startsWith("gid://") ? raw : `gid://shopify/SubscriptionBillingAttempt/${raw}`; }
export const WEBHOOK_BUDGET_MS = 4000;
class WebhookDeadlineExceeded extends Error {}

export function createShopifyWebhookForwarder(dependencies: WebhookForwarderDependencies = productionDependencies) {
  return async (request: Request, expectedTopic: ForwardedShopifyTopic, authenticated: AuthenticatedWebhookResult): Promise<AuthenticatedWebhookResult> => {
    if (request.method !== "POST") throw new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    const budgetMs = dependencies.budgetMs ?? WEBHOOK_BUDGET_MS;
    const deadlineAt = Date.now() + budgetMs;
    const controller = new AbortController();
    let rejectDeadline!: (error: Error) => void;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const timer = setTimeout(() => { controller.abort(); rejectDeadline(new WebhookDeadlineExceeded("Webhook deadline exceeded")); }, Math.max(0, deadlineAt - Date.now()));
    const beforeDeadline = <T>(operation: Promise<T>) => Promise.race([operation, deadline]);
    try {
      const webhookId = authenticated.webhookId ?? request.headers.get("x-shopify-webhook-id");
      if ((topicNames[authenticated.topic] ?? authenticated.topic) !== expectedTopic) throw new Response("Webhook topic does not match route", { status: 400 });
      if (!webhookId) throw new Response("Missing webhook identifier", { status: 400 });
      let contract: NormalizedContract | undefined;
      let billingAttempt: NormalizedBillingAttempt | undefined;
      let shopifyShopId: string | undefined;
      const shopifyEventId = text(authenticated.eventId ?? request.headers.get("x-shopify-event-id"));
      const triggeredAt = text(authenticated.triggeredAt);
      if (expectedTopic === "app/uninstalled") {
        const parsed = triggeredAt ? new Date(triggeredAt) : undefined;
        if (!parsed || Number.isNaN(parsed.getTime())) {
          dependencies.logger.error("[Shopify webhook] Authenticated uninstall timestamp is missing or invalid", { topic: expectedTopic, shop: authenticated.shop, webhookId });
          throw new Response("Authenticated webhook timestamp unavailable", { status: 503 });
        }
      }
      if (expectedTopic.startsWith("subscription_contracts/")) {
        if (!authenticated.admin) throw new Response("Contract enrichment unavailable", { status: 503 });
        try { const enriched = await beforeDeadline(dependencies.loadContract(authenticated.admin, contractId(authenticated.payload))); shopifyShopId = enriched.shopifyShopId; const payload = object(authenticated.payload); const revisionId = optionalIdentifier(payload.revision_id); contract = { ...enriched.contract, ...(revisionId && { revisionId }) }; }
        catch (error) { if (error instanceof WebhookDeadlineExceeded) throw error; dependencies.logger.error("[Shopify webhook] Contract enrichment failed", { topic: expectedTopic, shop: authenticated.shop, webhookId }); throw new Response("Contract enrichment failed", { status: 503 }); }
      }
      if (expectedTopic.startsWith("subscription_billing_attempts/")) {
        if (authenticated.admin) {
          try { const enriched = await beforeDeadline((dependencies.loadBillingAttempt ?? loadBillingAttempt)(authenticated.admin, billingAttemptId(authenticated.payload))); shopifyShopId = enriched.shopifyShopId; billingAttempt = enriched.billingAttempt; }
          catch (error) { if (error instanceof WebhookDeadlineExceeded) throw error; dependencies.logger.error("[Shopify webhook] Billing attempt enrichment pending", { topic: expectedTopic, shop: authenticated.shop, webhookId }); }
        }
        if (!billingAttempt) {
          const payload = object(authenticated.payload), rawId = optionalIdentifier(payload.admin_graphql_api_id ?? payload.id), rawContract = optionalIdentifier(payload.admin_graphql_api_subscription_contract_id ?? payload.subscription_contract_id ?? payload.contract_id);
          if (rawId && rawContract) billingAttempt = { id: rawId.startsWith("gid://") ? rawId : `gid://shopify/SubscriptionBillingAttempt/${rawId}`, idempotencyKey: optionalIdentifier(payload.idempotency_key) ?? `webhook:${webhookId}`, ...(triggeredAt && { createdAt: triggeredAt }), state: expectedTopic.endsWith("/success") ? "succeeded" : expectedTopic.endsWith("/failure") ? "failed" : "pending", contractId: rawContract.startsWith("gid://") ? rawContract : `gid://shopify/SubscriptionContract/${rawContract}`, reconciliationStatus: "pending" };
        }
      }
      const base = required(dependencies.environment, "API_SUBSCRIPTION_URL").replace(/\/$/, ""), apiKey = required(dependencies.environment, "API_KEY");
      let response: Response;
      if (expectedTopic === "app/uninstalled") {
        const payload = object(authenticated.payload);
        const rawShopId = optionalIdentifier(payload.admin_graphql_api_id ?? payload.id);
        if (!rawShopId) throw new Response("Shop identifier unavailable", { status: 503 });
        shopifyShopId = rawShopId.startsWith("gid://") ? rawShopId : `gid://shopify/Shop/${rawShopId}`;
      }
      try { response = await beforeDeadline(dependencies.fetchFn(`${base}/api/shopify/events`, { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: JSON.stringify({ shop: authenticated.shop, ...(shopifyShopId && { shopifyShopId }), ...(shopifyEventId && { shopifyEventId }), topic: expectedTopic, webhookId, payload: authenticated.payload, ...(contract && { contract }), ...(billingAttempt && { billingAttempt }), ...(triggeredAt && { triggeredAt }), receivedAt: dependencies.now().toISOString() }), signal: controller.signal })); }
      catch (error) { if (error instanceof WebhookDeadlineExceeded || controller.signal.aborted) throw new WebhookDeadlineExceeded("Webhook deadline exceeded"); throw new Response("Webhook forwarding failed", { status: 502 }); }
      if (!response.ok) { dependencies.logger.error("[Shopify webhook] Central API forwarding failed", { topic: expectedTopic, shop: authenticated.shop, status: response.status }); throw new Response("Webhook forwarding failed", { status: 502 }); }
      dependencies.logger.info("[Shopify webhook] Forwarded", { topic: expectedTopic, shop: authenticated.shop, webhookId }); return authenticated;
    } catch (error) {
      if (error instanceof WebhookDeadlineExceeded) throw new Response("Webhook processing deadline exceeded", { status: 503 });
      throw error;
    } finally { clearTimeout(timer); }
  };
}
export const forwardAuthenticatedShopifyWebhook = createShopifyWebhookForwarder();
export async function handleForwardedShopifyWebhook({ request }: ActionFunctionArgs, topic: ForwardedShopifyTopic) {
  const { authenticate } = await import("../shopify.server");
  const authenticated = await authenticate.webhook(request) as AuthenticatedWebhookResult;
  await forwardAuthenticatedShopifyWebhook(request, topic, authenticated);
  return new Response(null, { status: 200 });
}
