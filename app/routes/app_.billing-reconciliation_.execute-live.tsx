import type { ActionFunctionArgs } from "react-router";
import { runAdministrativeBillingReconciliationLiveResourceAction } from "../lib/administrative-billing-reconciliation-live-route.server";

export async function action({ request }: ActionFunctionArgs) {
  return runAdministrativeBillingReconciliationLiveResourceAction(request);
}
