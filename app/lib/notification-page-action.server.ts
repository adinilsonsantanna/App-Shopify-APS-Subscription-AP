import type { ActionFunctionArgs } from "react-router";
import type { NotificationSettings } from "./notification-settings-api.server";

const FREQUENCIES = new Set([
  "IMMEDIATELY",
  "DAILY_SUMMARY",
  "WEEKLY_SUMMARY",
  "NEVER",
]);

type ActionDependencies = {
  authenticateAdmin(request: Request): Promise<{ session: { shop: string } }>;
  domainAction(
    shop: string,
    action: "setup" | "verify" | "refresh",
  ): Promise<unknown>;
  saveSettings(shop: string, value: unknown): Promise<NotificationSettings>;
  sendTest(shop: string): Promise<unknown>;
};

export function createNotificationPageAction(dependencies: ActionDependencies) {
  return async ({ request }: ActionFunctionArgs) => {
    const { session } = await dependencies.authenticateAdmin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") || "save");

    try {
      if (["setup", "verify", "refresh"].includes(intent)) {
        await dependencies.domainAction(
          session.shop,
          intent as "setup" | "verify" | "refresh",
        );
        return {
          ok: true,
          intent,
          message:
            intent === "setup"
              ? "Configuração DNS iniciada. Os registros foram atualizados."
              : "Status do domínio atualizado.",
        };
      }
      if (intent === "test") {
        await dependencies.sendTest(session.shop);
        return {
          ok: true,
          intent,
          message: "E-mail de teste solicitado para a equipe configurada.",
        };
      }
      const teamFrequency = String(form.get("teamFrequency") || "");
      if (!FREQUENCIES.has(teamFrequency)) {
        return { ok: false, intent, message: "Frequência inválida." };
      }
      const teamEmails = String(form.get("teamEmails") || "")
        .split(/[\s,;]+/)
        .filter(Boolean);
      await dependencies.saveSettings(session.shop, {
        fromName: form.get("fromName"),
        fromEmail: form.get("fromEmail"),
        replyTo: form.get("replyTo"),
        teamEmails,
        teamFrequency,
        customerNotificationsEnabled:
          form.get("customerNotificationsEnabled") === "on",
        paymentFailedEnabled: form.get("paymentFailedEnabled") === "on",
        retryScheduledEnabled: form.get("retryScheduledEnabled") === "on",
        inventoryFailedEnabled: form.get("inventoryFailedEnabled") === "on",
        inventoryRetryEnabled: form.get("inventoryRetryEnabled") === "on",
        pausedEnabled: form.get("pausedEnabled") === "on",
        cancelledEnabled: form.get("cancelledEnabled") === "on",
        renewalSucceededEnabled: form.get("renewalSucceededEnabled") === "on",
      });
      return {
        ok: true,
        intent,
        message: "Configurações de notificações salvas.",
      };
    } catch {
      return {
        ok: false,
        intent,
        message:
          "A operação não foi confirmada pela API Central. Tente novamente.",
      };
    }
  };
}
