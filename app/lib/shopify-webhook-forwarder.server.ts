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

type AuthenticatedWebhook = Awaited<ReturnType<typeof authenticate.webhook>>;

const authenticatedTopicNames: Record<string, ForwardedShopifyTopic> = {
  APP_UNINSTALLED: "app/uninstalled",
  SUBSCRIPTION_CONTRACTS_CREATE: "subscription_contracts/create",
  SUBSCRIPTION_CONTRACTS_UPDATE: "subscription_contracts/update",
  SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS: "subscription_billing_attempts/success",
  SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE: "subscription_billing_attempts/failure",
  SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED: "subscription_billing_attempts/challenged",
};

function requiredEnvironmentVariable(name: "API_SUBSCRIPTION_URL" | "API_KEY") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function forwardAuthenticatedShopifyWebhook(
  request: Request,
  expectedTopic: ForwardedShopifyTopic,
): Promise<AuthenticatedWebhook> {
  if (request.method !== "POST") {
    throw new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const authenticated = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const authenticatedTopic = authenticatedTopicNames[String(authenticated.topic)] ?? authenticated.topic;

  if (authenticatedTopic !== expectedTopic) {
    throw new Response("Webhook topic does not match route", { status: 400 });
  }

  if (!webhookId) {
    throw new Response("Missing webhook identifier", { status: 400 });
  }

  const apiBaseUrl = requiredEnvironmentVariable("API_SUBSCRIPTION_URL").replace(/\/$/, "");
  const apiKey = requiredEnvironmentVariable("API_KEY");
  const response = await fetch(`${apiBaseUrl}/api/shopify/events`, {
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
      receivedAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    console.error("[Shopify webhook] Central API forwarding failed", {
      topic: expectedTopic,
      shop: authenticated.shop,
      status: response.status,
    });
    throw new Response("Webhook forwarding failed", { status: 502 });
  }

  console.info("[Shopify webhook] Forwarded", {
    topic: expectedTopic,
    shop: authenticated.shop,
    webhookId,
  });

  return authenticated;
}

export async function handleForwardedShopifyWebhook(
  { request }: ActionFunctionArgs,
  topic: ForwardedShopifyTopic,
) {
  await forwardAuthenticatedShopifyWebhook(request, topic);
  return new Response(null, { status: 200 });
}
