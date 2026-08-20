export const retryDefaults = { paymentRetryAttempts: 3, paymentRetryDays: 2, paymentFailureAction: "PAUSE_AND_NOTIFY", inventoryRetryAttempts: 5, inventoryRetryDays: 1, inventoryFailureAction: "SKIP_AND_NOTIFY", teamNotificationFrequency: "WEEKLY_SUMMARY" } as const;
export type RetrySettings = { paymentRetryAttempts: number; paymentRetryDays: number; paymentFailureAction: string; inventoryRetryAttempts: number; inventoryRetryDays: number; inventoryFailureAction: string; teamNotificationFrequency: string; updatedAt?: string | null; persisted?: boolean };
export async function retrySettingsRequest(shop: string, method: "GET" | "PUT", settings?: RetrySettings, dependencies = { baseUrl: process.env.API_SUBSCRIPTION_URL, apiKey: process.env.API_KEY, fetchFn: fetch }) {
  if (!dependencies.baseUrl || !dependencies.apiKey) throw new Error("API Central não configurada.");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8_000);
  try { const response = await dependencies.fetchFn(`${dependencies.baseUrl.replace(/\/$/, "")}/api/retry-settings/${encodeURIComponent(shop)}`, { method, headers: { "content-type": "application/json", "x-api-key": dependencies.apiKey }, ...(settings ? { body: JSON.stringify(settings) } : {}), signal: controller.signal }); const body = await response.json() as { settings?: RetrySettings; persisted?: boolean; error?: string }; if (!response.ok || !body.settings) throw new Error(body.error || `API Central respondeu ${response.status}.`); return { ...body.settings, persisted: body.persisted ?? method === "PUT" }; }
  catch (error) { if (controller.signal.aborted) throw new Error("Tempo esgotado ao acessar a API Central."); throw error; }
  finally { clearTimeout(timer); }
}

export async function loadRetrySettingsWithMigration(shop: string, legacyStore: { findUnique(args: { where: { shop: string } }): PromiseLike<(Omit<RetrySettings, "updatedAt"> & { updatedAt?: string | Date | null }) | null> }, dependencies?: Parameters<typeof retrySettingsRequest>[3]) {
  const central = await retrySettingsRequest(shop, "GET", undefined, dependencies);
  if (central.persisted) return central;
  const legacy = await legacyStore.findUnique({ where: { shop } });
  const source = legacy ?? retryDefaults;
  const migrated: RetrySettings = { paymentRetryAttempts: source.paymentRetryAttempts, paymentRetryDays: source.paymentRetryDays, paymentFailureAction: source.paymentFailureAction, inventoryRetryAttempts: source.inventoryRetryAttempts, inventoryRetryDays: source.inventoryRetryDays, inventoryFailureAction: source.inventoryFailureAction, teamNotificationFrequency: source.teamNotificationFrequency };
  return retrySettingsRequest(shop, "PUT", migrated, dependencies);
}
