export type NotificationSettings = {
  shopId: string;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  activeFromName?: string | null;
  activeFromEmail?: string | null;
  activeReplyTo?: string | null;
  teamEmails: string[];
  teamFrequency: string;
  customerNotificationsEnabled: boolean;
  paymentFailedEnabled?: boolean;
  retryScheduledEnabled?: boolean;
  inventoryFailedEnabled?: boolean;
  inventoryRetryEnabled?: boolean;
  pausedEnabled?: boolean;
  cancelledEnabled?: boolean;
  renewalSucceededEnabled?: boolean;
  activeSendingDomain?: {
    id: string;
    domain: string;
    status: string;
    sendingVerified: boolean;
  } | null;
};
export type SendingDomain = {
  id: string;
  domain: string;
  status: string;
  sendingVerified: boolean;
  lastCheckedAt?: string | null;
  records: Array<{
    purpose: string;
    type: string;
    name: string;
    value: string;
    priority?: number | null;
    ttl?: string | null;
    status: string;
  }>;
};
export async function notificationApi(
  shop: string,
  path: string,
  method: "GET" | "PUT" | "POST" = "GET",
  body?: unknown,
  dependencies = {
    baseUrl: process.env.API_SUBSCRIPTION_URL,
    apiKey: process.env.API_KEY,
    fetchFn: fetch,
  },
) {
  if (!dependencies.baseUrl || !dependencies.apiKey)
    throw new Error("API Central não configurada.");
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const encodedShop = encodeURIComponent(shop);
    const endpoint = path.includes(":shop") ? path.replace(":shop", encodedShop) : `${path}/${encodedShop}`;
    const response = await dependencies.fetchFn(
      `${dependencies.baseUrl.replace(/\/$/, "")}/api/notifications/${endpoint}`,
      {
        method,
        headers: {
          "content-type": "application/json",
          "x-api-key": dependencies.apiKey,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      },
    );
    const value = (await response.json()) as {
      success?: boolean;
      data?: unknown;
      error?: string;
      status?: string;
    };
    if (!response.ok || value.success === false)
      throw Object.assign(
        new Error(value.error || "API Central recusou a operação."),
        { statusCode: response.status },
      );
    return value.data ?? value;
  } finally {
    clearTimeout(timer);
  }
}
export function getNotificationSettings(
  shop: string,
  dependencies?: Parameters<typeof notificationApi>[4],
) {
  return notificationApi(
    shop,
    "settings",
    "GET",
    undefined,
    dependencies,
  ) as Promise<NotificationSettings>;
}
export function saveNotificationSettings(
  shop: string,
  settings: unknown,
  dependencies?: Parameters<typeof notificationApi>[4],
) {
  return notificationApi(
    shop,
    "settings",
    "PUT",
    settings,
    dependencies,
  ) as Promise<NotificationSettings>;
}
export function getSendingDomains(
  shop: string,
  dependencies?: Parameters<typeof notificationApi>[4],
) {
  return notificationApi(
    shop,
    "domains",
    "GET",
    undefined,
    dependencies,
  ).then((value) => { if (!Array.isArray(value)) throw new Error("Resposta de domínios inválida."); return value.map((item) => { const source = item && typeof item === "object" ? item as Record<string, unknown> : {}; const records = Array.isArray(source.records) ? source.records : []; return { id: String(source.id || ""), domain: String(source.domain || ""), status: String(source.status || ""), sendingVerified: source.sendingVerified === true, lastCheckedAt: typeof source.lastCheckedAt === "string" ? source.lastCheckedAt : null, records: records.map((record) => { const dns = record && typeof record === "object" ? record as Record<string, unknown> : {}; return { purpose: String(dns.purpose || ""), type: String(dns.type || ""), name: String(dns.name || ""), value: String(dns.value || ""), priority: typeof dns.priority === "number" ? dns.priority : null, ttl: dns.ttl == null ? null : String(dns.ttl), status: String(dns.status || "") }; }) }; }); }) as Promise<SendingDomain[]>;
}
export function domainAction(
  shop: string,
  action: "setup" | "verify" | "refresh",
  dependencies?: Parameters<typeof notificationApi>[4],
) {
  return notificationApi(
    shop,
    `domains/:shop/${action}`,
    "POST",
    undefined,
    dependencies,
  ) as Promise<SendingDomain>;
}
export function sendNotificationTest(
  shop: string,
  dependencies?: Parameters<typeof notificationApi>[4],
) {
  return notificationApi(shop, "test", "POST", undefined, dependencies);
}
