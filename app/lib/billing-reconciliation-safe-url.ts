export function buildBillingReconciliationSafeUrl(
  origin: string,
  pathname: string,
  search: string,
): string {
  const safeUrl = new URL(pathname, origin);
  const params = new URLSearchParams(search);
  const allowed = ["shop", "host", "embedded"];
  
  for (const key of allowed) {
    if (params.has(key)) {
      safeUrl.searchParams.set(key, params.get(key)!);
    }
  }
  
  return safeUrl.toString();
}
