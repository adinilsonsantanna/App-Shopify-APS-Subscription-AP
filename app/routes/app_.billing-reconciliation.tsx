import type { ActionFunctionArgs } from "react-router";
import { runAdministrativeBillingReconciliationAction } from "../lib/administrative-billing-reconciliation-route.server";

export async function action({ request }: ActionFunctionArgs) {
  return runAdministrativeBillingReconciliationAction(request);
}

export default function BillingReconciliationRoute() {
  return null;
}
