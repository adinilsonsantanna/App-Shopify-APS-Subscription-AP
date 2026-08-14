import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const forwardedShopifyTopics = ["subscription_contracts/create", "subscription_contracts/update", "subscription_billing_attempts/success", "subscription_billing_attempts/failure", "subscription_billing_attempts/challenged", "app/uninstalled"] as const;
export type ForwardedShopifyTopic = (typeof forwardedShopifyTopics)[number];
type AdminClient = { graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> };
export interface AuthenticatedWebhookResult { shop: string; topic: string; payload: unknown; session?: unknown; admin?: AdminClient }
export interface NormalizedContract {
  id: string; status: string; nextBillingAt?: string; currencyCode: string;
  originOrder?: { id: string; financialStatus?: string; amount?: string; currencyCode?: string; processedAt?: string };
  customer?: { id: string; email?: string; name?: string };
  billingPolicy: { interval: string; intervalCount: number }; deliveryPolicy: { interval: string; intervalCount: number }; paymentMethodId?: string;
  lines: Array<{ id: string; title?: string; productId?: string; variantId?: string; quantity: number; currentPrice: { amount: string; currencyCode: string }; sellingPlanId?: string }>;
}
export interface WebhookForwarderDependencies {
  authenticateWebhook(request: Request): Promise<AuthenticatedWebhookResult>; fetchFn: typeof fetch; environment: Record<string, string | undefined>; now(): Date;
  loadContract(admin: AdminClient, id: string): Promise<NormalizedContract>;
  logger: { error(message: string, metadata: Record<string, unknown>): void; info(message: string, metadata: Record<string, unknown>): void };
}

const CONTRACT_QUERY = `#graphql
query ApsEnrichedSubscriptionContract($id: ID!) {
  subscriptionContract(id: $id) {
    id status nextBillingDate currencyCode
    billingPolicy { interval intervalCount }
    deliveryPolicy { interval intervalCount }
    originOrder { id displayFinancialStatus processedAt totalPriceSet { shopMoney { amount currencyCode } } }
    customer { id displayName defaultEmailAddress { emailAddress } }
    customerPaymentMethod { id }
    lines(first: 100) { nodes { id title quantity currentPrice { amount currencyCode } productId variantId sellingPlanId } }
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
  const payment = c.customerPaymentMethod ? object(c.customerPaymentMethod) : undefined;
  return { id: text(c.id, true)!, status: text(c.status, true)!, ...(text(c.nextBillingDate) && { nextBillingAt: text(c.nextBillingDate) }), currencyCode: text(c.currencyCode, true)!,
    billingPolicy: { interval: text(billing.interval, true)!, intervalCount: count(billing.intervalCount) }, deliveryPolicy: { interval: text(delivery.interval, true)!, intervalCount: count(delivery.intervalCount) },
    ...(order && { originOrder: { id: text(order.id, true)!, ...(text(order.displayFinancialStatus) && { financialStatus: text(order.displayFinancialStatus) }), ...(text(money?.amount) && { amount: text(money?.amount) }), ...(text(money?.currencyCode) && { currencyCode: text(money?.currencyCode) }), ...(text(order.processedAt) && { processedAt: text(order.processedAt) }) } }),
    ...(customer && { customer: { id: text(customer.id, true)!, ...(text(email?.emailAddress) && { email: text(email?.emailAddress) }), ...(text(customer.displayName) && { name: text(customer.displayName) }) } }),
    ...(text(payment?.id) && { paymentMethodId: text(payment?.id) }),
    lines: lines.nodes.map((item) => { const line = object(item), price = object(line.currentPrice); return { id: text(line.id, true)!, ...(text(line.title) && { title: text(line.title) }), ...(text(line.productId) && { productId: text(line.productId) }), ...(text(line.variantId) && { variantId: text(line.variantId) }), quantity: count(line.quantity), currentPrice: { amount: text(price.amount, true)!, currencyCode: text(price.currencyCode, true)! }, ...(text(line.sellingPlanId) && { sellingPlanId: text(line.sellingPlanId) }) }; }),
  };
}
async function loadContract(admin: AdminClient, id: string) { const response = await admin.graphql(CONTRACT_QUERY, { variables: { id } }); if (!response.ok) throw new Error("Shopify contract query failed"); const body = object(await response.json()); if (Array.isArray(body.errors) && body.errors.length) throw new Error("Shopify contract query failed"); const data = object(body.data); if (!data.subscriptionContract) throw new Error("Shopify contract not found"); return normalizeContract(data.subscriptionContract); }
const topicNames: Record<string, ForwardedShopifyTopic> = { APP_UNINSTALLED: "app/uninstalled", SUBSCRIPTION_CONTRACTS_CREATE: "subscription_contracts/create", SUBSCRIPTION_CONTRACTS_UPDATE: "subscription_contracts/update", SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS: "subscription_billing_attempts/success", SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE: "subscription_billing_attempts/failure", SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED: "subscription_billing_attempts/challenged" };
const productionDependencies: WebhookForwarderDependencies = { authenticateWebhook: (request) => authenticate.webhook(request) as Promise<AuthenticatedWebhookResult>, fetchFn: fetch, environment: process.env, now: () => new Date(), loadContract, logger: console };
function required(env: Record<string, string | undefined>, name: "API_SUBSCRIPTION_URL" | "API_KEY") { const value = env[name]; if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; }
function contractId(payload: unknown) { const data = object(payload), candidate = data.admin_graphql_api_id ?? data.id, raw = text(candidate) ?? (typeof candidate === "number" && Number.isFinite(candidate) ? String(candidate) : undefined); if (!raw) throw new Error("Shopify contract identifier unavailable"); return raw.startsWith("gid://") ? raw : `gid://shopify/SubscriptionContract/${raw}`; }
async function within<T>(promise: Promise<T>, ms: number) { let timer: ReturnType<typeof setTimeout>; try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); })]); } finally { clearTimeout(timer!); } }

export function createShopifyWebhookForwarder(dependencies: WebhookForwarderDependencies = productionDependencies) {
  return async (request: Request, expectedTopic: ForwardedShopifyTopic): Promise<AuthenticatedWebhookResult> => {
    if (request.method !== "POST") throw new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    const authenticated = await dependencies.authenticateWebhook(request), webhookId = request.headers.get("x-shopify-webhook-id");
    if ((topicNames[authenticated.topic] ?? authenticated.topic) !== expectedTopic) throw new Response("Webhook topic does not match route", { status: 400 });
    if (!webhookId) throw new Response("Missing webhook identifier", { status: 400 });
    let contract: NormalizedContract | undefined;
    if (expectedTopic.startsWith("subscription_contracts/")) {
      if (!authenticated.admin) throw new Response("Contract enrichment unavailable", { status: 503 });
      try { contract = await within(dependencies.loadContract(authenticated.admin, contractId(authenticated.payload)), 8000); }
      catch { dependencies.logger.error("[Shopify webhook] Contract enrichment failed", { topic: expectedTopic, shop: authenticated.shop, webhookId }); throw new Response("Contract enrichment failed", { status: 503 }); }
    }
    const base = required(dependencies.environment, "API_SUBSCRIPTION_URL").replace(/\/$/, ""), apiKey = required(dependencies.environment, "API_KEY");
    const response = await dependencies.fetchFn(`${base}/api/shopify/events`, { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: JSON.stringify({ shop: authenticated.shop, topic: expectedTopic, webhookId, payload: authenticated.payload, ...(contract && { contract }), receivedAt: dependencies.now().toISOString() }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) { dependencies.logger.error("[Shopify webhook] Central API forwarding failed", { topic: expectedTopic, shop: authenticated.shop, status: response.status }); throw new Response("Webhook forwarding failed", { status: 502 }); }
    dependencies.logger.info("[Shopify webhook] Forwarded", { topic: expectedTopic, shop: authenticated.shop, webhookId }); return authenticated;
  };
}
export const forwardAuthenticatedShopifyWebhook = createShopifyWebhookForwarder();
export async function handleForwardedShopifyWebhook({ request }: ActionFunctionArgs, topic: ForwardedShopifyTopic) { await forwardAuthenticatedShopifyWebhook(request, topic); return new Response(null, { status: 200 }); }
