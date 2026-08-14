/* eslint-disable react/prop-types */
import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useCallback, useEffect, useState} from "preact/hooks";

const API_VERSION = "2026-07";
const API_URL = `shopify://customer-account/api/${API_VERSION}/graphql.json`;

const SUBSCRIPTIONS_QUERY = `#graphql
  query MinhaAssinatura {
    customer {
      subscriptionContracts(first: 50) {
        nodes {
          id
          status
          currencyCode
          nextBillingDate
          billingPolicy {
            interval
            intervalCount { count }
          }
          deliveryPolicy {
            interval
            intervalCount { count }
          }
          lines(first: 50) {
            nodes {
              id
              title
              variantTitle
              quantity
              currentPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

const MUTATIONS = {
  pause: `#graphql
    mutation PausarAssinatura($subscriptionContractId: ID!) {
      subscriptionContractPause(subscriptionContractId: $subscriptionContractId) {
        contract { id status }
        userErrors { field message }
      }
    }
  `,
  activate: `#graphql
    mutation RetomarAssinatura($subscriptionContractId: ID!) {
      subscriptionContractActivate(subscriptionContractId: $subscriptionContractId) {
        contract { id status }
        userErrors { field message }
      }
    }
  `,
  cancel: `#graphql
    mutation CancelarAssinatura($subscriptionContractId: ID!) {
      subscriptionContractCancel(subscriptionContractId: $subscriptionContractId) {
        contract { id status }
        userErrors { field message }
      }
    }
  `,
};

const STATUS_LABELS = {
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  CANCELLED: "Cancelada",
  CANCELED: "Cancelada",
  FAILED: "Falha",
  EXPIRED: "Expirada",
  PENDING: "Pendente",
};

const STATUS_TONES = {
  ACTIVE: "success",
  PAUSED: "warning",
  CANCELLED: "critical",
  CANCELED: "critical",
  FAILED: "critical",
  EXPIRED: "neutral",
  PENDING: "info",
};

export default async () => {
  render(<MinhaAssinatura />, document.body);
};

async function customerAccountRequest(query, variables = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({query, variables}),
  });

  if (!response.ok) throw new Error(`Customer Account API: ${response.status}`);
  const result = await response.json();
  if (result.errors?.length) throw new Error(result.errors[0].message);
  return result.data;
}

function MinhaAssinatura() {
  const [contracts, setContracts] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [cancelContract, setCancelContract] = useState(null);

  const loadContracts = useCallback(async () => {
    try {
      setLoadError(false);
      const data = await customerAccountRequest(SUBSCRIPTIONS_QUERY);
      setContracts(data?.customer?.subscriptionContracts?.nodes ?? []);
    } catch (error) {
      console.error(error);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  async function manageContract(action, contract) {
    setPendingId(contract.id);
    setFeedback(null);
    try {
      const data = await customerAccountRequest(MUTATIONS[action], {
        subscriptionContractId: contract.id,
      });
      const payload = data[`subscriptionContract${capitalize(action)}`];
      if (payload.userErrors?.length) {
        throw new Error(payload.userErrors.map(({message}) => message).join(" "));
      }

      setContracts((current) =>
        current.map((item) =>
          item.id === contract.id ? {...item, status: payload.contract.status} : item,
        ),
      );
      if (action === "cancel") {
        document.getElementById("cancel-subscription")?.hideOverlay();
      }
      setCancelContract(null);
      setFeedback({tone: "success", message: successMessage(action)});
    } catch (error) {
      console.error(error);
      setFeedback({
        tone: "critical",
        message: error.message || "Não foi possível atualizar a assinatura. Tente novamente.",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <s-page
      heading="Minha Assinatura"
      subheading="Gerencie seus planos, próximas cobranças e preferências de assinatura."
    >
      {feedback && <s-banner tone={feedback.tone}>{feedback.message}</s-banner>}

      {contracts === null && !loadError && (
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-spinner accessibilityLabel="Carregando assinaturas" />
          <s-text>Carregando suas assinaturas...</s-text>
        </s-stack>
      )}

      {loadError && (
        <s-banner tone="critical">
          Não foi possível carregar suas assinaturas. Tente novamente.
          <s-button slot="secondary-actions" onClick={loadContracts}>Tentar novamente</s-button>
        </s-banner>
      )}

      {contracts?.length === 0 && (
        <s-section><s-text>Você ainda não possui assinaturas.</s-text></s-section>
      )}

      <s-stack direction="block" gap="base">
        {contracts?.map((contract) => (
          <ContractCard
            key={contract.id}
            contract={contract}
            busy={pendingId === contract.id}
            onPause={() => manageContract("pause", contract)}
            onActivate={() => manageContract("activate", contract)}
            onCancel={() => setCancelContract(contract)}
          />
        ))}
      </s-stack>

      <s-modal id="cancel-subscription" heading="Cancelar assinatura">
        <s-stack direction="block" gap="base">
          <s-text>
            Tem certeza que deseja cancelar esta assinatura? Esta ação interromperá as próximas cobranças.
          </s-text>
          <s-button-group>
            <s-button commandFor="cancel-subscription" command="--hide" onClick={() => setCancelContract(null)}>Voltar</s-button>
            <s-button
              variant="primary"
              tone="critical"
              disabled={!cancelContract || pendingId === cancelContract?.id}
              loading={pendingId === cancelContract?.id}
              onClick={() => manageContract("cancel", cancelContract)}
            >
              Confirmar cancelamento
            </s-button>
          </s-button-group>
        </s-stack>
      </s-modal>
    </s-page>
  );
}

function ContractCard({contract, busy, onPause, onActivate, onCancel}) {
  const total = contract.lines.nodes.reduce(
    (sum, line) => sum + Number(line.currentPrice.amount) * line.quantity,
    0,
  );

  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-badge tone={STATUS_TONES[contract.status] ?? "neutral"}>
          {STATUS_LABELS[contract.status] ?? contract.status}
        </s-badge>

        {contract.lines.nodes.map((line) => (
          <s-stack key={line.id} direction="block" gap="small">
            <s-heading>{line.title}{line.variantTitle ? ` — ${line.variantTitle}` : ""}</s-heading>
            <s-text>Quantidade: {line.quantity}</s-text>
            <s-text>{formatMoney(line.currentPrice.amount, line.currentPrice.currencyCode)}</s-text>
          </s-stack>
        ))}

        <s-text type="strong">Total: {formatMoney(total, contract.currencyCode)}</s-text>
        <s-text>{formatFrequency("Cobrança", contract.billingPolicy)}</s-text>
        <s-text>{formatFrequency("Entrega", contract.deliveryPolicy)}</s-text>
        <s-text>
          Próxima cobrança: {contract.nextBillingDate ? formatDate(contract.nextBillingDate) : "Não disponível"}
        </s-text>

        {(contract.status === "ACTIVE" || contract.status === "PAUSED") && (
          <s-button-group>
            {contract.status === "ACTIVE" ? (
              <s-button disabled={busy} loading={busy} onClick={onPause}>Pausar assinatura</s-button>
            ) : (
              <s-button disabled={busy} loading={busy} onClick={onActivate}>Retomar assinatura</s-button>
            )}
            <s-button
              tone="critical"
              disabled={busy}
              commandFor="cancel-subscription"
              command="--show"
              onClick={onCancel}
            >
              Cancelar assinatura
            </s-button>
          </s-button-group>
        )}
      </s-stack>
    </s-section>
  );
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function successMessage(action) {
  return {
    pause: "Assinatura pausada com sucesso.",
    activate: "Assinatura retomada com sucesso.",
    cancel: "Assinatura cancelada com sucesso.",
  }[action];
}

function formatMoney(amount, currencyCode) {
  return new Intl.NumberFormat("pt-BR", {style: "currency", currency: currencyCode}).format(Number(amount));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {timeZone: "UTC"}).format(new Date(value));
}

function formatFrequency(label, policy) {
  if (!policy) return `${label}: não disponível`;
  const count = Number(policy.intervalCount.count);
  const units = {
    DAY: count === 1 ? "dia" : "dias",
    WEEK: count === 1 ? "semana" : "semanas",
    MONTH: count === 1 ? "mês" : "meses",
    YEAR: count === 1 ? "ano" : "anos",
  };
  return `${label} a cada ${count} ${units[policy.interval] ?? policy.interval.toLowerCase()}`;
}
