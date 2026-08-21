import type { ActionFunctionArgs } from "react-router";
import { handleRetryOperation } from "../lib/retry-operation.server";
import { unauthenticated } from "../shopify.server";
export const action = ({ request }: ActionFunctionArgs) => handleRetryOperation(request, { apiKey: process.env.API_KEY, getAdmin: shop => unauthenticated.admin(shop) });
