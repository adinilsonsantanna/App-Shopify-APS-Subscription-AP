import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  DRY_RUN_ERRORS,
  submitBillingReconciliationDryRun,
  type BillingReconciliationDryRunTarget,
  type DryRunOutcome,
} from "../lib/billing-reconciliation-dry-run";

const CONFIRMATION_PHRASE = "EXECUTAR DRY-RUN SEGURO";

const DRY_RUN_ERROR_LABELS: Record<string, string> = {
  [DRY_RUN_ERRORS.appBridgeUnavailable]:
    "App Bridge indisponível. Nenhum dry-run foi enviado. Feche e reabra o app no Admin.",
  [DRY_RUN_ERRORS.requestFailed]: "Falha de rede ao enviar dry-run. Nenhuma escrita foi realizada.",
  [DRY_RUN_ERRORS.reconciliationFailed]: "O servidor recusou o dry-run. Nenhuma escrita foi realizada.",
};

interface Props {
  targets: BillingReconciliationDryRunTarget;
}

export function BillingReconciliationDryRunForm({ targets }: Props) {
  const shopify = useAppBridge();
  const [confirmation, setConfirmation] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DryRunOutcome | null>(null);

  const confirmed = confirmation.trim() === CONFIRMATION_PHRASE;

  async function runDryRun() {
    if (!confirmed || running) return;
    setRunning(true);
    setResult(null);
    try {
      const outcome = await submitBillingReconciliationDryRun({
        tokenProvider: () => shopify.idToken(),
        sendRequest: (init) => fetch(window.location.pathname, init),
        url: window.location.pathname,
        targets,
      });
      setResult(outcome);
    } catch {
      setResult({ ok: false, error: DRY_RUN_ERRORS.appBridgeUnavailable });
    } finally {
      setRunning(false);
    }
  }

  const field = (label: string, value: string) => (
    <div>
      <span className="aps-recon-label">{label}</span>
      <code className="aps-recon-code">{value}</code>
    </div>
  );

  return (
    <main
      style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 820, margin: "0 auto", padding: "24px" }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Reconciliação administrativa (dry-run)</h1>
      <p style={{ marginTop: 0, color: "#4a5568" }}>
        Executa apenas verificação. <strong>dryRun é sempre true</strong> e nenhuma escrita ocorre.
      </p>

      <section
        aria-label="Alvos autorizados"
        style={{ border: "1px solid #cbd5e0", borderRadius: 8, padding: 16, marginBottom: 16 }}
      >
        <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Alvos fixos e autorizados</h2>
        {field("SubscriptionBillingAttempt", targets.subscriptionBillingAttemptId)}
        {field("SubscriptionContract", targets.subscriptionContractId)}
        {field("Order", targets.shopifyOrderId)}
        {field("Cycle origin time", targets.cycleOriginTime)}
        {field("Correlation ID", targets.correlationId)}
      </section>

      <label htmlFor="aps-recon-confirm">
        Digite <code>{CONFIRMATION_PHRASE}</code> para confirmar (somente dry-run):
      </label>
      <input
        id="aps-recon-confirm"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        disabled={running}
        autoComplete="off"
        style={{ display: "block", width: "100%", margin: "8px 0 16px", padding: "8px" }}
      />

      <button
        type="button"
        onClick={runDryRun}
        disabled={!confirmed || running}
        style={{ padding: "8px 16px", marginBottom: 16 }}
      >
        {running ? "Executando…" : "Executar dry-run do Billing Attempt"}
      </button>

      {result && (
        <section
          aria-label="Resultado da reconciliação"
          style={{ border: "1px solid #cbd5e0", borderRadius: 8, padding: 16 }}
        >
          <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>
            Resultado {result.status ? `(HTTP ${result.status})` : ""}
          </h2>
          {result.error ? (
            <p style={{ color: "#c53030" }}>
              {result.error in DRY_RUN_ERROR_LABELS ? DRY_RUN_ERROR_LABELS[result.error] : "Falha generica no dry-run."}
            </p>
          ) : (
            <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(result.body, null, 2)}
            </pre>
          )}
        </section>
      )}
    </main>
  );
}