export interface BillingReconciliationLiveTarget {
  subscriptionBillingAttemptId: string;
  subscriptionContractId: string;
  shopifyOrderId: string;
  cycleOriginTime: string;
  correlationId: string;
}

export const ADMIN_LIVE_CONFIRMATION_PHRASE = "EXECUTAR RECONCILIAÇÃO LIVE";

export type InFlightLock = { current: boolean };

export async function runWithInFlightLock<T>(lock: InFlightLock, operation: () => Promise<T>) {
  if (lock.current) return undefined;
  lock.current = true;
  try {
    return await operation();
  } finally {
    lock.current = false;
  }
}

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
        subscriptionContractId: dependencies.target.subscriptionContractId,
        subscriptionBillingAttemptId: dependencies.target.subscriptionBillingAttemptId,
        shopifyOrderId: dependencies.target.shopifyOrderId,
        cycleOriginTime: dependencies.target.cycleOriginTime,
        correlationId: dependencies.target.correlationId,
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
