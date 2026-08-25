import { ApiSyncService } from "../services/ApiSyncService";

interface OfflineSession {
  shop: string;
  accessToken?: string;
  scope?: string;
}
interface AdminClient { graphql(query: string): Promise<Response> }

export async function syncAuthenticatedInstallation(
  session: OfflineSession,
  admin: AdminClient,
  sync: Pick<ApiSyncService, "syncShop"> = new ApiSyncService(),
) {
  if (!session.accessToken) throw new Error("Authenticated offline session has no access token");
  const domain = session.shop.trim().toLowerCase();
  if (!/^([a-z0-9][a-z0-9-]*\.)*myshopify\.com$/.test(domain)) throw new Error("Authenticated session has an invalid shop domain");
  const response = await admin.graphql(`#graphql
    query DurableInstallationShopIdentity { shop { id name myshopifyDomain } }
  `);
  if (!response.ok) throw new Error("Unable to resolve authenticated Shopify identity");
  const body = await response.json() as { data?: { shop?: { id?: string; name?: string; myshopifyDomain?: string } }; errors?: unknown[] };
  if (body.errors?.length) throw new Error("Unable to resolve authenticated Shopify identity");
  const shop = body.data?.shop;
  if (!shop?.id || !/^gid:\/\/shopify\/Shop\/\d+$/.test(shop.id) || shop.myshopifyDomain?.toLowerCase() !== domain) throw new Error("Authenticated Shopify identity does not match the session");
  return sync.syncShop({ shopifyShopId: shop.id, name: shop.name || domain, domain, accessToken: session.accessToken, scopes: session.scope || "" });
}
