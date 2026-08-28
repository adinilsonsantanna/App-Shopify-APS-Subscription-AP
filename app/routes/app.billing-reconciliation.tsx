import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handleAdministrativeBillingReconciliation } from "../lib/administrative-billing-reconciliation.server";
export async function action({ request }: ActionFunctionArgs) { return handleAdministrativeBillingReconciliation(request, { authenticate: authenticate.admin, fetchFn: fetch, apiUrl: process.env.API_SUBSCRIPTION_URL, apiKey: process.env.API_KEY, logger: console }); }
export default function BillingReconciliationRoute() { return null; }
