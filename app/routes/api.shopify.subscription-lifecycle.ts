import type { ActionFunctionArgs } from "react-router";
import { handleSubscriptionLifecycle } from "../lib/subscription-lifecycle.server";
import { unauthenticated } from "../shopify.server";

export const action = ({ request }: ActionFunctionArgs) => handleSubscriptionLifecycle(request, {
  apiKey: process.env.API_KEY,
  getAdmin: (shop) => unauthenticated.admin(shop),
});
