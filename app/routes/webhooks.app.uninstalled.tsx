import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { forwardAuthenticatedShopifyWebhook } from "../lib/shopify-webhook-forwarder.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await forwardAuthenticatedShopifyWebhook(
    request,
    "app/uninstalled",
  );

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response(null, { status: 200 });
};
