import type { LoaderFunctionArgs } from "react-router";
import {
  getNotificationSettings,
  getSendingDomains,
  type SendingDomain,
} from "./notification-settings-api.server";

type AuthenticatedAdmin = {
  session: { shop: string };
};

type NotificationLoaderDependencies = {
  authenticateAdmin(request: Request): Promise<AuthenticatedAdmin>;
  getSettings(shop: string): ReturnType<typeof getNotificationSettings>;
  getDomains(shop: string): ReturnType<typeof getSendingDomains>;
};

export function createNotificationPageLoader(
  dependencies: NotificationLoaderDependencies,
) {
  return async ({ request }: LoaderFunctionArgs) => {
    const { session } = await dependencies.authenticateAdmin(request);

    try {
      const settings = await dependencies.getSettings(session.shop);
      try {
        return {
          settings,
          domains: await dependencies.getDomains(session.shop),
          loadError: null,
          domainsError: null,
        };
      } catch {
        return {
          settings,
          domains: [] as SendingDomain[],
          loadError: null,
          domainsError:
            "Não foi possível carregar os domínios. Tente novamente.",
        };
      }
    } catch {
      return {
        settings: null,
        domains: [] as SendingDomain[],
        loadError:
          "Não foi possível carregar as configurações de notificação. Recarregue a página para tentar novamente.",
        domainsError: null,
      };
    }
  };
}

export const notificationPageApi = {
  getSettings: getNotificationSettings,
  getDomains: getSendingDomains,
};
