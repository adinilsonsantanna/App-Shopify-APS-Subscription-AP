import { useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  LIVE_ERRORS,
  ADMIN_LIVE_CONFIRMATION_PHRASE,
  runWithInFlightLock,
  submitBillingReconciliationLive,
  type BillingReconciliationLiveTarget,
  type LiveOutcome,
} from "../lib/billing-reconciliation-live";
import { buildBillingReconciliationSafeUrl } from "../lib/billing-reconciliation-safe-url";

const LIVE_ERROR_LABELS: Record<string, string> = {
  [LIVE_ERRORS.appBridgeUnavailable]:
    "App Bridge indisponível. Nenhuma reconciliação live foi enviada. Feche e reabra o app no Admin.",
  [LIVE_ERRORS.requestFailed]:
    "Falha de rede ao enviar a reconciliação live. Nenhuma escrita foi realizada.",
  [LIVE_ERRORS.reconciliationFailed]:
    "O servidor recusou a reconciliação live. Nenhuma escrita foi realizada.",
};

interface Props {
  liveEnabled: boolean;
  target: BillingReconciliationLiveTarget | null;
}

export function BillingReconciliationLiveForm({ liveEnabled, target }: Props) {
  const shopify = useAppBridge();
  const [confirmation, setConfirmation] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LiveOutcome | null>(null);
  const inFlightRef = useRef(false);

  const confirmed = confirmation === ADMIN_LIVE_CONFIRMATION_PHRASE;

  async function runLive() {
    if (!confirmed || !target) return;
    await runWithInFlightLock(inFlightRef, async () => {
      setRunning(true);
      setResult(null);
      const safeUrlString = buildBillingReconciliationSafeUrl(
        window.location.origin,
        "/app/billing-reconciliation/execute-live",
        window.location.search
      );

      try {
        const outcome = await submitBillingReconciliationLive({
          tokenProvider: () => shopify.idToken(),
          sendRequest: (init) => fetch(safeUrlString, init),
          url: safeUrlString,
          target,
          confirmation,
        });
        setResult(outcome);
      } catch {
        setResult({ ok: false, error: LIVE_ERRORS.appBridgeUnavailable });
      } finally {
        setRunning(false);
      }
    });
  }

  const field = (label: string, value: string) => (
    <div>
      <span className="aps-recon-label">{label}</span>
      <code className="aps-recon-code">{value}</code>
    </div>
  );

  const bodyRecord =
    result && result.body && typeof result.body === "object" && !Array.isArray(result.body)
      ? (result.body as Record<string, unknown>)
      : null;
  const bodyError = typeof bodyRecord?.error === "string" ? bodyRecord.error : undefined;
  const bodyRequestId = typeof bodyRecord?.requestId === "string" ? bodyRecord.requestId : undefined;

  if (!liveEnabled) {
    return (
      <section
        aria-label="Reconciliação live indisponível"
        style={{ border: "1px solid #cbd5e0", borderRadius: 8, padding: 16, marginTop: 24, opacity: 0.6 }}
      >
        <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Reconciliação live</h2>
        <p style={{ margin: 0, color: "#4a5568" }}>
          Indisponível. A execução live está desligada. Nenhuma escrita ocorre.
        </p>
      </section>
    );
  }

  if (!target) return <section aria-label="Reconciliação live indisponível"><h2>Reconciliação live</h2><p>Nenhum alvo live autorizado.</p></section>;

  return (
    <section
      aria-label="Reconciliação live"
      style={{ border: "1px solid #e2a33b", borderRadius: 8, padding: 16, marginTop: 24 }}
    >
      <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Reconciliação live (modifica banco interno)</h2>
      <p style={{ marginTop: 0, color: "#744210" }}>
        Esta operação <strong>modifica o banco interno</strong> para alinhar o Billing Attempt e a Order ao
        estado canônico da Shopify. NÃO cria cobrança, NÃO cria pedido, NÃO executa mutation Shopify e NÃO
        executa mutation Stripe. Apenas o alvo autorizado abaixo é aceito; qualquer divergência é rejeitada.
      </p>
      <div
        style={{ border: "1px solid #e2a33b", borderRadius: 6, padding: 12, marginBottom: 16 }}
      >
        {field("SubscriptionBillingAttempt", target.subscriptionBillingAttemptId)}
        {field("SubscriptionContract", target.subscriptionContractId)}
        {field("Order", target.shopifyOrderId)}
        {field("Cycle origin time", target.cycleOriginTime)}
        {field("Correlation ID", target.correlationId)}
      </div>

      <label htmlFor="aps-recon-live-confirm">
        Digite <code>{ADMIN_LIVE_CONFIRMATION_PHRASE}</code> para confirmar a reconciliação live:
      </label>
      <input
        id="aps-recon-live-confirm"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        disabled={running}
        autoComplete="off"
        style={{ display: "block", width: "100%", margin: "8px 0 16px", padding: "8px" }}
      />

      <button
        type="button"
        onClick={runLive}
        disabled={!confirmed || running}
        style={{ padding: "8px 16px", marginBottom: 16, border: "1px solid #c05621", background: "#c05621", color: "#fff" }}
      >
        {running ? "Executando…" : "Executar reconciliação live"}
      </button>

      {result && (
        <div
          aria-label="Resultado da reconciliação live"
          style={{ border: "1px solid #cbd5e0", borderRadius: 6, padding: 12 }}
        >
          <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>
            Resultado {result.status ? `(HTTP ${result.status})` : ""}
          </h3>
          {result.error ? (
            <div style={{ color: "#c53030" }}>
              <p style={{ margin: 0 }}>
                {result.error in LIVE_ERROR_LABELS ? LIVE_ERROR_LABELS[result.error] : "Falha genérica na reconciliação live."}
              </p>
              {result.status ? (
                <p style={{ margin: "4px 0 0" }}>
                  <strong>HTTP {result.status}</strong>
                </p>
              ) : null}
              {bodyError ? (
                <p style={{ margin: "4px 0 0" }}>
                  <strong>Código:</strong> <code>{bodyError}</code>
                </p>
              ) : null}
              {bodyRequestId ? (
                <p style={{ margin: "4px 0 0" }}>
                  <strong>requestId:</strong> <code>{bodyRequestId}</code>
                </p>
              ) : null}
            </div>
          ) : (
            <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", maxHeight: 320 }}>
              {JSON.stringify(result.body, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
