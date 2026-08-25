import {
  forwardAuthenticatedShopifyWebhook,
  type AuthenticatedWebhookResult,
} from "./shopify-webhook-forwarder.server";

interface UninstallDependencies {
  authenticate(request: Request): Promise<AuthenticatedWebhookResult>;
  forward(request: Request, topic: "app/uninstalled", authenticated: AuthenticatedWebhookResult): Promise<AuthenticatedWebhookResult>;
  deleteSessions(shop: string): Promise<void>;
}

const productionDependencies: UninstallDependencies = {
  authenticate: async (request) => {
    const { authenticate } = await import("../shopify.server");
    return authenticate.webhook(request) as Promise<AuthenticatedWebhookResult>;
  },
  forward: forwardAuthenticatedShopifyWebhook,
  deleteSessions: async (shop) => {
    const { default: db } = await import("../db.server");
    await db.session.deleteMany({ where: { shop } });
  },
};

export async function processAppUninstalledWebhook(
  request: Request,
  dependencies: UninstallDependencies = productionDependencies,
) {
  const authenticated = await dependencies.authenticate(request);
  const { shop, session } = await dependencies.forward(request, "app/uninstalled", authenticated);

  if (session) {
    await dependencies.deleteSessions(shop);
  }

  return new Response(null, { status: 200 });
}
