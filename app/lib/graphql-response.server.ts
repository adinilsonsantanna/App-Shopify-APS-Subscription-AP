export interface ShopifyGraphqlError {
  message: string;
  extensions?: Record<string, unknown>;
}

export function getShopifyGraphqlErrors(body: unknown): ShopifyGraphqlError[] {
  if (!body || typeof body !== "object" || !("errors" in body)) return [];

  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];

  return errors.flatMap((error) => {
    if (!error || typeof error !== "object" || !("message" in error)) return [];
    const message = (error as { message?: unknown }).message;
    if (typeof message !== "string") return [];

    const extensions = "extensions" in error
      && error.extensions
      && typeof error.extensions === "object"
      && !Array.isArray(error.extensions)
      ? error.extensions as Record<string, unknown>
      : undefined;

    return [{ message, ...(extensions ? { extensions } : {}) }];
  });
}
