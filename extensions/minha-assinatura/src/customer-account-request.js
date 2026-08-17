export const CUSTOMER_ACCOUNT_REQUEST_TIMEOUT_MS = 8_000;

export async function customerAccountRequest(
  apiUrl,
  query,
  variables = {},
  {
    fetchImpl = fetch,
    timeoutMs = CUSTOMER_ACCOUNT_REQUEST_TIMEOUT_MS,
  } = {},
) {
  const abortController =
    typeof AbortController === "undefined" ? null : new AbortController();
  let timeoutId;

  const operation = Promise.resolve().then(async () => {
    const response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({query, variables}),
      ...(abortController ? {signal: abortController.signal} : {}),
    });

    if (!response.ok) {
      throw new Error(`Customer Account API: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    return result.data;
  });

  const deadline = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          "A Shopify demorou mais de 8 segundos para responder. Tente novamente.",
        ),
      );
      abortController?.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createLatestRequestCoordinator() {
  let latestRequestId = 0;

  return {
    async run({request, onLoading, onSuccess, onError}) {
      const requestId = ++latestRequestId;
      onLoading();

      try {
        const value = await request();
        if (requestId === latestRequestId) onSuccess(value);
        return {status: "success", current: requestId === latestRequestId};
      } catch (error) {
        if (requestId === latestRequestId) onError(error);
        return {status: "error", current: requestId === latestRequestId, error};
      }
    },

    invalidate() {
      latestRequestId += 1;
    },
  };
}
