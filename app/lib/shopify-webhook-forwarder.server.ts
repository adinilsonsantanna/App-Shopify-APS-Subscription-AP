import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const forwardedShopifyTopics = [
  "subscription_contracts/create",
  "subscription_contracts/update",
  "subscription_billing_attempts/success",
  "subscription_billing_attempts/failure",
  "subscription_billing_attempts/challenged",
  "app/uninstalled",
] as const;

export type ForwardedShopifyTopic = (typeof forwardedShopifyTopics)[number];

export interface AuthenticatedWebhookResult {
  shop: string;
  topic: string;
  payload: unknown;
  session?: unknown;
}

export interface WebhookForwarderDependencies {
  authenticateWebhook(request: Request): Promise<AuthenticatedWebhookResult>;
  fetchFn: typeof fetch;
  environment: Record<string, string | undefined>;
  now(): Date;
  logger: {
    error(message: string, metadata: Record<string, unknown>): void;
    info(message: string, metadata: Record<string, unknown>): void;
  };
}

const authenticatedTopicNames: Record<string, ForwardedShopifyTopic> = {
  APP_UNINSTALLED: "app/uninstalled",
  SUBSCRIPTION_CONTRACTS_CREATE: "subscription_contracts/create",
  SUBSCRIPTION_CONTRACTS_UPDATE: "subscription_contracts/update",
  SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS: "subscription_billing_attempts/success",
  SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE: "subscription_billing_attempts/failure",
  SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED: "subscription_billing_attempts/challenged",
};

const productionDependencies: WebhookForwarderDependencies = {
  authenticateWebhook: (request) => authenticate.webhook(request),
  fetchFn: fetch,
  environment: process.env,
  now: () => new Date(),
  logger: console,
};

function requiredEnvironmentVariable(
  environment: Record<string, string | undefined>,
  name: "API_SUBSCRIPTION_URL" | "API_KEY",
) {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createShopifyWebhookForwarder(
  dependencies: WebhookForwarderDependencies = productionDependencies,
) {
  return async (
    request: Request,
    expectedTopic: ForwardedShopifyTopic,
  ): Promise<AuthenticatedWebhookResult> => {
    if (request.method !== "POST") {
      throw new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "POST" },
      });
    }

    const authenticated = await dependencies.authenticateWebhook(request);
    const webhookId = request.headers.get("x-shopify-webhook-id");
    const authenticatedTopic = authenticatedTopicNames[authenticated.topic] ?? authenticated.topic;

    if (authenticatedTopic !== expectedTopic) {
      throw new Response("Webhook topic does not match route", { status: 400 });
    }
    if (!webhookId) {
      throw new Response("Missing webhook identifier", { status: 400 });
    }

    const apiBaseUrl = requiredEnvironmentVariable(
      dependencies.environment,
      "API_SUBSCRIPTION_URL",
    ).replace(/\/$/, "");
    const apiKey = requiredEnvironmentVariable(dependencies.environment, "API_KEY");
    const response = await dependencies.fetchFn(`${apiBaseUrl}/api/shopify/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        shop: authenticated.shop,
        topic: expectedTopic,
        webhookId,
        payload: authenticated.payload,
        receivedAt: dependencies.now().toISOString(),
      }),
    });

    if (!response.ok) {
      dependencies.logger.error("[Shopify webhook] Central API forwarding failed", {
        topic: expectedTopic,
        shop: authenticated.shop,
        status: response.status,
      });
      throw new Response("Webhook forwarding failed", { status: 502 });
    }

    dependencies.logger.info("[Shopify webhook] Forwarded", {
      topic: expectedTopic,
      shop: authenticated.shop,
      webhookId,
    });
    return authenticated;
  };
}

export const forwardAuthenticatedShopifyWebhook = createShopifyWebhookForwarder();

export async function handleForwardedShopifyWebhook(
  { request }: ActionFunctionArgs,
  topic: ForwardedShopifyTopic,
) {
  await forwardAuthenticatedShopifyWebhook(request, topic);
  return new Response(null, { status: 200 });
}
