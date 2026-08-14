import db from "../db.server";
import {
  forwardAuthenticatedShopifyWebhook,
  type AuthenticatedWebhookResult,
} from "./shopify-webhook-forwarder.server";

interface UninstallDependencies {
  forward(request: Request, topic: "app/uninstalled"): Promise<AuthenticatedWebhookResult>;
  deleteSessions(shop: string): Promise<void>;
}

const productionDependencies: UninstallDependencies = {
  forward: forwardAuthenticatedShopifyWebhook,
  deleteSessions: async (shop) => {
    await db.session.deleteMany({ where: { shop } });
  },
};

export async function processAppUninstalledWebhook(
  request: Request,
  dependencies: UninstallDependencies = productionDependencies,
) {
  const { shop, session } = await dependencies.forward(request, "app/uninstalled");

  if (session) {
    await dependencies.deleteSessions(shop);
  }

  return new Response(null, { status: 200 });
}
