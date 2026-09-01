import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { ADMIN_RECONCILIATION_DRY_RUN_TARGETS } from "../lib/administrative-billing-reconciliation-route.server";
import { parseLiveTargets } from "../lib/administrative-billing-reconciliation-live.server";
import { BillingReconciliationDryRunForm } from "../components/billing-reconciliation-dry-run-form";
import { BillingReconciliationLiveForm } from "../components/billing-reconciliation-live-form";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const liveTargets = parseLiveTargets(process.env.ADMIN_RECONCILIATION_LIVE_TARGETS);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    targets: ADMIN_RECONCILIATION_DRY_RUN_TARGETS,
    liveEnabled: process.env.ADMIN_BILLING_RECONCILIATION_LIVE_ENABLED === "true",
    liveTarget: process.env.ADMIN_BILLING_RECONCILIATION_LIVE_ENABLED === "true" ? liveTargets[0] ?? null : null,
  };
}

export default function BillingReconciliationRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <BillingReconciliationDryRunForm targets={data.targets} />
      <BillingReconciliationLiveForm liveEnabled={data.liveEnabled} target={data.liveTarget} />
    </AppProvider>
  );
}
