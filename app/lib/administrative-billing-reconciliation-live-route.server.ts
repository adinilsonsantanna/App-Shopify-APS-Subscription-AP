import type {
  AdminReconciliationLiveDependencies,
  AdminReconciliationLiveTarget,
} from "./administrative-billing-reconciliation-live.server";
import { parseLiveTargets } from "./administrative-billing-reconciliation-live.server";

type Handler = (request: Request, dependencies: AdminReconciliationLiveDependencies) => Promise<Response>;

export const ADMIN_LIVE_RECONCILIATION_RESOURCE_PATH = "/app/billing-reconciliation/execute-live";

export interface AdministrativeReconciliationLiveRouteDependencies {
  loadAuthenticate(): Promise<AdminReconciliationLiveDependencies["authenticate"]>;
  loadHandler(): Promise<Handler>;
  fetchFn: typeof fetch;
  logger: Pick<Console, "error" | "info">;
  requestId(): string;
  apiUrl?: string;
  apiKey?: string;
  liveSecret?: string;
  liveEnabled?: boolean;
  liveTargets?: AdminReconciliationLiveTarget[];
}

function safeErrorClass(error: unknown) {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : "UnknownError";
}

function logFailure(logger: Pick<Console, "error">, event: string, requestId: string, error: unknown) {
  logger.error(JSON.stringify({ event, route: ADMIN_LIVE_RECONCILIATION_RESOURCE_PATH, requestId, errorClass: safeErrorClass(error) }));
}

function jsonError(status: number, error: string, requestId: string) {
  return Response.json({ error, requestId }, { status });
}

const defaults: AdministrativeReconciliationLiveRouteDependencies = {
  loadAuthenticate: async () => {
    const { authenticate } = await import("../shopify.server");
    return authenticate.admin;
  },
  loadHandler: async () => {
    const { handleAdministrativeBillingReconciliationLive } = await import("./administrative-billing-reconciliation-live.server");
    return handleAdministrativeBillingReconciliationLive;
  },
  fetchFn: fetch,
  logger: console,
  requestId: () => crypto.randomUUID(),
  apiUrl: process.env.API_SUBSCRIPTION_URL,
  apiKey: process.env.API_KEY,
  liveSecret: process.env.ADMIN_RECONCILIATION_LIVE_SECRET,
  liveEnabled: process.env.ADMIN_BILLING_RECONCILIATION_LIVE_ENABLED === "true",
  liveTargets: parseLiveTargets(process.env.ADMIN_RECONCILIATION_LIVE_TARGETS),
};

export async function runAdministrativeBillingReconciliationLiveResourceAction(
  request: Request,
  dependencies: AdministrativeReconciliationLiveRouteDependencies = defaults,
) {
  const requestId = dependencies.requestId();
  dependencies.logger.info(JSON.stringify({ event: "live_resource_action_started", route: ADMIN_LIVE_RECONCILIATION_RESOURCE_PATH, requestId, stage: "started" }));

  if (request.method !== "POST") {
    dependencies.logger.error(JSON.stringify({ event: "live_resource_action_failed", route: ADMIN_LIVE_RECONCILIATION_RESOURCE_PATH, requestId, stage: "method_rejected" }));
    return jsonError(400, "method_not_allowed", requestId);
  }

  let authenticate: AdminReconciliationLiveDependencies["authenticate"];
  try {
    authenticate = await dependencies.loadAuthenticate();
  } catch (error) {
    logFailure(dependencies.logger, "live_resource_action_failed", requestId, error);
    return jsonError(503, "app_infrastructure_unavailable", requestId);
  }

  let handler: Handler;
  try {
    handler = await dependencies.loadHandler();
  } catch (error) {
    logFailure(dependencies.logger, "live_resource_action_failed", requestId, error);
    return jsonError(500, "route_initialization_failed", requestId);
  }

  try {
    const response = await handler(request, {
      authenticate,
      fetchFn: dependencies.fetchFn,
      apiUrl: dependencies.apiUrl,
      apiKey: dependencies.apiKey,
      liveEnabled: dependencies.liveEnabled ?? false,
      liveTargets: dependencies.liveTargets ?? [],
      liveSecret: dependencies.liveSecret ?? "",
      logger: dependencies.logger,
      requestId,
    });
    if (!/application\/json/i.test(response.headers.get("content-type") || "")) {
      logFailure(dependencies.logger, "live_resource_action_failed", requestId, new Error("non_json_response"));
      return jsonError(500, "administrative_reconciliation_live_unhandled", requestId);
    }
    return response;
  } catch (error) {
    logFailure(dependencies.logger, "live_resource_action_failed", requestId, error);
    return jsonError(500, "administrative_reconciliation_live_unhandled", requestId);
  }
}
