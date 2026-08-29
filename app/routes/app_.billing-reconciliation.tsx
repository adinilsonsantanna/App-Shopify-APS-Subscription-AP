import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { runAdministrativeBillingReconciliationAction, ADMIN_RECONCILIATION_DRY_RUN_TARGETS } from "../lib/administrative-billing-reconciliation-route.server";
import { BillingReconciliationDryRunForm } from "../components/billing-reconciliation-dry-run-form";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    targets: ADMIN_RECONCILIATION_DRY_RUN_TARGETS,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  return runAdministrativeBillingReconciliationAction(request);
}

export default function BillingReconciliationRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <BillingReconciliationDryRunForm targets={data.targets} />
    </AppProvider>
  );
}