import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { reconcileExistingShopInstallation } from "../lib/durable-installation.server";
import { isAdministrativeReconciliationShopAllowed } from "../lib/administrative-reconciliation-allowlist.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const authenticated = await reconcileExistingShopInstallation(request, authenticate.admin);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    showReconciliationNav: isAdministrativeReconciliationShopAllowed(authenticated.session.shop),
  };
};

export default function App() {
  const { apiKey, showReconciliationNav } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Visão geral</s-link>
        <s-link href="/app/selling-plans">Selling Plans</s-link>
        <s-link href="/app/contracts">Contratos</s-link>
        <s-link href="/app/settings">Configurações</s-link>
        {showReconciliationNav && (
          <s-link href="/app/billing-reconciliation">Reconciliação (dry-run)</s-link>
        )}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
