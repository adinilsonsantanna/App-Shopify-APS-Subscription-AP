export const ADMINISTRATIVE_RECONCILIATION_ALLOWED_SHOP = "aps-test-store-hx3rwtgw.myshopify.com";

export function normalizeShopDomain(shop: unknown): string | null {
  if (typeof shop !== "string") return null;
  const normalized = shop.trim().toLowerCase();
  if (!/^([a-z0-9][a-z0-9-]*\.)*myshopify\.com$/.test(normalized)) return null;
  return normalized;
}

export function isAdministrativeReconciliationShopAllowed(shop: unknown): boolean {
  const normalized = normalizeShopDomain(shop);
  return normalized !== null && normalized === ADMINISTRATIVE_RECONCILIATION_ALLOWED_SHOP;
}
