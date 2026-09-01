export interface BillingReconciliationLiveTarget {
  subscriptionBillingAttemptId: string;
  subscriptionContractId: string;
  shopifyOrderId: string;
  cycleOriginTime: string;
  correlationId: string;
}

export const ADMIN_LIVE_CONFIRMATION_PHRASE = "EXECUTAR RECONCILIAÇÃO LIVE";

export type LiveTokenProvider = () => Promise<string>;
export type LiveRequestSender = (init: RequestInit) => Promise<Response>;

export interface LiveOutcome {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}

export const LIVE_ERRORS = {
  appBridgeUnavailable: "app_bridge_unavailable",
  requestFailed: "request_failed",
  reconciliationFailed: "reconciliation_returned_error",
} as const;

export interface BillingReconciliationLiveDependencies {
  tokenProvider: LiveTokenProvider;
  sendRequest: LiveRequestSender;
  url: string;
  target: BillingReconciliationLiveTarget;
  confirmation: string;
}

export async function submitBillingReconciliationLive(
  dependencies: BillingReconciliationLiveDependencies,
): Promise<LiveOutcome> {
  let token: string;
  try {
    token = await dependencies.tokenProvider();
  } catch {
    return { ok: false, error: LIVE_ERRORS.appBridgeUnavailable };
  }

  let response: Response;
  try {
    response = await dependencies.sendRequest({
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...dependencies.target,
        confirmation: dependencies.confirmation,
      }),
    });
  } catch {
    return { ok: false, error: LIVE_ERRORS.requestFailed };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, status: response.status, body, error: LIVE_ERRORS.reconciliationFailed };
  }

  return { ok: true, status: response.status, body };
}
