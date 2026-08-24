import type {
  NotificationSettings,
  SendingDomain,
} from "./notification-settings-api.server";

const RECOVERABLE_STATUSES = new Set([
  "failed",
  "temporary_error",
  "temporary_failure",
  "partially_failed",
]);

export type DnsUiState =
  | "NOT_CONFIGURED"
  | "PENDING"
  | "VERIFIED"
  | "RECOVERABLE_ERROR";

export function buildNotificationDnsState(
  settings: NotificationSettings | null,
  domains: SendingDomain[],
) {
  const activeDomain = domains.find(
    (item) => item.id === settings?.activeSendingDomain?.id,
  );
  const senderDomain = settings?.fromEmail?.split("@")[1]?.toLowerCase();
  const pendingDomain = domains.find(
    (item) =>
      item.domain.toLowerCase() === senderDomain && item.id !== activeDomain?.id,
  );
  const domain = pendingDomain || activeDomain || domains[0] || null;
  const status = String(domain?.status || "not_configured").toLowerCase();
  const verified = domain?.sendingVerified === true;
  const recoverableError = Boolean(domain && RECOVERABLE_STATUSES.has(status));
  const state: DnsUiState = !domain
    ? "NOT_CONFIGURED"
    : verified
      ? "VERIFIED"
      : recoverableError
        ? "RECOVERABLE_ERROR"
        : "PENDING";

  return {
    state,
    domain,
    activeDomain,
    showPendingSender: Boolean(
      domain &&
        settings?.fromEmail &&
        settings.fromEmail !== settings.activeFromEmail,
    ),
    showSetup: Boolean(settings?.fromEmail && state === "NOT_CONFIGURED"),
    showVerify: Boolean(domain && !verified),
    showRefresh: Boolean(domain),
    showTest: Boolean(
      verified && activeDomain?.sendingVerified && settings?.activeFromEmail,
    ),
    recoverableError,
  };
}

export function notificationActionProgress(
  state: string,
  formData?: FormData,
) {
  const submitting = state === "submitting";
  return {
    submitting,
    intent: submitting ? String(formData?.get("intent") || "") : "",
  };
}
