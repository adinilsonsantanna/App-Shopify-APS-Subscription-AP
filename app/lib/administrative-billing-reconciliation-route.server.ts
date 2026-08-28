import type { AdminReconciliationDependencies } from "./administrative-billing-reconciliation.server";

type Handler = (request: Request, dependencies: AdminReconciliationDependencies) => Promise<Response>;

export interface AdministrativeReconciliationRouteDependencies {
  loadAuthenticate(): Promise<AdminReconciliationDependencies["authenticate"]>;
  loadHandler(): Promise<Handler>;
  fetchFn: typeof fetch;
  logger: Pick<Console, "error">;
  requestId(): string;
  apiUrl?: string;
  apiKey?: string;
}

function safeErrorClass(error: unknown) {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : "UnknownError";
}

function logFailure(logger: Pick<Console, "error">, event: string, requestId: string, error: unknown) {
  logger.error(JSON.stringify({ event, route: "/app/billing-reconciliation", requestId, errorClass: safeErrorClass(error) }));
}

function jsonError(status: number, error: string, requestId: string) {
  return Response.json({ error, requestId }, { status });
}

const defaults: AdministrativeReconciliationRouteDependencies = {
  loadAuthenticate: async () => {
    const { authenticate } = await import("../shopify.server");
    return authenticate.admin;
  },
  loadHandler: async () => {
    const { handleAdministrativeBillingReconciliation } = await import("./administrative-billing-reconciliation.server");
    return handleAdministrativeBillingReconciliation;
  },
  fetchFn: fetch,
  logger: console,
  requestId: () => crypto.randomUUID(),
  apiUrl: process.env.API_SUBSCRIPTION_URL,
  apiKey: process.env.API_KEY,
};

export async function runAdministrativeBillingReconciliationAction(
  request: Request,
  dependencies: AdministrativeReconciliationRouteDependencies = defaults,
) {
  const requestId = dependencies.requestId();
  let authenticate: AdminReconciliationDependencies["authenticate"];
  try {
    authenticate = await dependencies.loadAuthenticate();
  } catch (error) {
    logFailure(dependencies.logger, "administrative_reconciliation.shopify_initialization_failed", requestId, error);
    return jsonError(503, "app_infrastructure_unavailable", requestId);
  }

  let handler: Handler;
  try {
    handler = await dependencies.loadHandler();
  } catch (error) {
    logFailure(dependencies.logger, "administrative_reconciliation.route_dependency_failed", requestId, error);
    return jsonError(500, "route_initialization_failed", requestId);
  }

  try {
    return await handler(request, {
      authenticate,
      fetchFn: dependencies.fetchFn,
      apiUrl: dependencies.apiUrl,
      apiKey: dependencies.apiKey,
      logger: dependencies.logger,
      requestId,
    });
  } catch (error) {
    logFailure(dependencies.logger, "administrative_reconciliation.unhandled_failure", requestId, error);
    return jsonError(500, "administrative_reconciliation_unhandled", requestId);
  }
}
