import { useEffect, useState } from "react";

export interface BillingReconciliationDryRunTarget {
  subscriptionBillingAttemptId: string;
  subscriptionContractId: string;
  shopifyOrderId: string;
  cycleOriginTime: string;
  correlationId: string;
}

const CONFIRMATION_PHRASE = "EXECUTAR DRY-RUN SEGURO";

type BridgeGlobal = { shopify: { idToken: () => Promise<string> } };

interface DryRunResult {
  status?: number;
  body?: unknown;
  error?: string;
}

interface Props {
  apiKey: string;
  targets: BillingReconciliationDryRunTarget;
}

function useAppBridgeIdToken(apiKey: string) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!apiKey) return;
    const existing = document.querySelector<HTMLScriptElement>("script[data-api-key]");
    if (existing) {
      setReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.shopify.com/shopifycloud/app-bridge.js";
    script.setAttribute("data-api-key", apiKey);
    script.onload = () => setReady(true);
    script.onerror = () => setReady(false);
    document.body.appendChild(script);
    return () => {
      script.onload = null;
      script.onerror = null;
    };
  }, [apiKey]);

  return { ready, idToken: () => (window as unknown as BridgeGlobal).shopify.idToken() };
}

export function BillingReconciliationDryRunForm({ apiKey, targets }: Props) {
  const { ready, idToken } = useAppBridgeIdToken(apiKey);
  const [confirmation, setConfirmation] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);

  const confirmed = confirmation.trim() === CONFIRMATION_PHRASE;

  async function runDryRun() {
    if (!confirmed || running) return;
    setRunning(true);
    setResult(null);
    try {
      const token = await idToken();
      const response = await fetch(window.location.pathname, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...targets, dryRun: true }),
      });
      const body = await response.json().catch(() => null);
      setResult({ status: response.status, body });
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "unknown_error" });
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
        disabled={!confirmed || !ready || running}
        style={{ padding: "8px 16px", marginBottom: 16 }}
      >
        {running ? "Executando…" : "Executar dry-run do Billing Attempt"}
      </button>
      {!ready && <p style={{ marginTop: 0 }}>Carregando App Bridge…</p>}

      {result && (
        <section
          aria-label="Resultado da reconciliação"
          style={{ border: "1px solid #cbd5e0", borderRadius: 8, padding: 16 }}
        >
          <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>
            Resultado {result.status ? `(HTTP ${result.status})` : ""}
          </h2>
          {result.error ? (
            <p style={{ color: "#c53030" }}>{result.error}</p>
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