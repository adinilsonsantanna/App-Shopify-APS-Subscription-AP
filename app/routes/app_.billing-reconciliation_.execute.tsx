import type { ActionFunctionArgs } from "react-router";
import { runAdministrativeBillingReconciliationResourceAction } from "../lib/administrative-billing-reconciliation-route.server";

export async function action({ request }: ActionFunctionArgs) {
  return runAdministrativeBillingReconciliationResourceAction(request);
}
