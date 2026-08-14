import type { ActionFunctionArgs } from "react-router";
import { handleForwardedShopifyWebhook } from "../lib/shopify-webhook-forwarder.server";

export const action = (args: ActionFunctionArgs) =>
  handleForwardedShopifyWebhook(args, "subscription_billing_attempts/challenged");
