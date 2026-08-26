import { ApiSyncService } from "../services/ApiSyncService";

export interface AuthenticatedAdminSession {
  shop: string;
  accessToken?: string;
  scope?: string;
}

export interface AuthenticatedAdminClient {
  graphql(query: string): Promise<Response>;
}

export interface AuthenticatedAdminContext {
  session: AuthenticatedAdminSession;
  admin: AuthenticatedAdminClient;
}

export interface InstallationReconciliationResult {
  synchronized: boolean;
  shop: string | null;
}

interface ReconciliationDependencies {
  sync: Pick<ApiSyncService, "syncShop">;
  logger: Pick<Console, "error">;
}

const inFlightByShop = new Map<string, Promise<InstallationReconciliationResult>>();

function authenticatedDomain(session: AuthenticatedAdminSession) {
  const domain = session.shop.trim().toLowerCase();
  if (!/^([a-z0-9][a-z0-9-]*\.)*myshopify\.com$/.test(domain)) {
    throw new Error("Authenticated session has an invalid shop domain");
  }
  return domain;
}

async function synchronizeAuthenticatedInstallation(
  authenticated: AuthenticatedAdminContext,
  dependencies: ReconciliationDependencies,
  domain: string,
): Promise<InstallationReconciliationResult> {
  const { session, admin } = authenticated;
  if (!session.accessToken) throw new Error("Authenticated offline session has no access token");

  const response = await admin.graphql(`#graphql
    query DurableInstallationShopIdentity { shop { id name myshopifyDomain } }
  `);
  if (!response.ok) throw new Error("Unable to resolve authenticated Shopify identity");

  const body = await response.json() as {
    data?: { shop?: { id?: string; name?: string; myshopifyDomain?: string } };
    errors?: unknown[];
  };
  if (body.errors?.length) throw new Error("Unable to resolve authenticated Shopify identity");

  const shop = body.data?.shop;
  if (
    !shop?.id ||
    !/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(shop.id) ||
    shop.myshopifyDomain?.trim().toLowerCase() !== domain
  ) {
    throw new Error("Authenticated Shopify identity does not match the session");
  }

  await dependencies.sync.syncShop({
    shopifyShopId: shop.id,
    name: shop.name || domain,
    domain,
    accessToken: session.accessToken,
    scopes: session.scope || "",
  });
  return { synchronized: true, shop: domain };
}

export async function ensureCentralShopInstallation(
  authenticated: AuthenticatedAdminContext,
  dependencies: Partial<ReconciliationDependencies> = {},
): Promise<InstallationReconciliationResult> {
  const resolved: ReconciliationDependencies = {
    sync: dependencies.sync ?? new ApiSyncService(),
    logger: dependencies.logger ?? console,
  };

  let domain: string;
  try {
    domain = authenticatedDomain(authenticated.session);
  } catch {
    resolved.logger.error("[Installation reconciliation] Invalid authenticated Shopify session");
    return { synchronized: false, shop: null };
  }

  const pending = inFlightByShop.get(domain);
  if (pending) return pending;

  const reconciliation = synchronizeAuthenticatedInstallation(authenticated, resolved, domain)
    .catch(() => {
      resolved.logger.error("[Installation reconciliation] Temporary synchronization failure", { shop: domain });
      return { synchronized: false, shop: domain };
    })
    .finally(() => {
      if (inFlightByShop.get(domain) === reconciliation) inFlightByShop.delete(domain);
    });

  inFlightByShop.set(domain, reconciliation);
  return reconciliation;
}

export async function reconcileExistingShopInstallation(
  request: Request,
  authenticateAdmin: (request: Request) => Promise<AuthenticatedAdminContext>,
  reconcile: (authenticated: AuthenticatedAdminContext) => Promise<InstallationReconciliationResult> = ensureCentralShopInstallation,
) {
  const authenticated = await authenticateAdmin(request);
  await reconcile(authenticated);
  return authenticated;
}

export async function syncAuthenticatedInstallation(
  session: AuthenticatedAdminSession,
  admin: AuthenticatedAdminClient,
  sync: Pick<ApiSyncService, "syncShop"> = new ApiSyncService(),
) {
  return ensureCentralShopInstallation({ session, admin }, { sync });
}
