export interface BillingReconciliationDryRunTarget {
  subscriptionBillingAttemptId: string;
  subscriptionContractId: string;
  shopifyOrderId: string;
  cycleOriginTime: string;
  correlationId: string;
}

export type DryRunTokenProvider = () => Promise<string>;
export type DryRunRequestSender = (init: RequestInit) => Promise<Response>;

export interface DryRunOutcome {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}

export const DRY_RUN_ERRORS = {
  appBridgeUnavailable: "app_bridge_unavailable",
  requestFailed: "request_failed",
  reconciliationFailed: "reconciliation_returned_error",
} as const;

export interface BillingReconciliationDryRunDependencies {
  tokenProvider: DryRunTokenProvider;
  sendRequest: DryRunRequestSender;
  url: string;
  targets: BillingReconciliationDryRunTarget;
}

export async function submitBillingReconciliationDryRun(
  dependencies: BillingReconciliationDryRunDependencies,
): Promise<DryRunOutcome> {
  let token: string;
  try {
    token = await dependencies.tokenProvider();
  } catch {
    return { ok: false, error: DRY_RUN_ERRORS.appBridgeUnavailable };
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
      body: JSON.stringify({ ...dependencies.targets, dryRun: true }),
    });
  } catch {
    return { ok: false, error: DRY_RUN_ERRORS.requestFailed };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, status: response.status, body, error: DRY_RUN_ERRORS.reconciliationFailed };
  }

  return { ok: true, status: response.status, body };
}