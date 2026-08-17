/* eslint-disable react/prop-types */
import "@shopify/ui-extensions/preact";
import {Component, render} from "preact";
import {useCallback, useEffect, useState} from "preact/hooks";
import {
  contractActions,
  mutationErrorFeedback,
  resolvePageState,
} from "./subscription-page-state.js";

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
  STALE: "Desatualizada",
};

// Em Customer Account UI Extensions 2026-07, s-badge aceita
// auto, neutral e critical.
const STATUS_TONES = {
  ACTIVE: "neutral",
  PAUSED: "neutral",
  CANCELLED: "critical",
  CANCELED: "critical",
  FAILED: "critical",
  EXPIRED: "neutral",
  PENDING: "neutral",
  STALE: "neutral",
};

export default async () => bootstrapExtension(document.body);

export function bootstrapExtension(root) {
  try {
    render(<InitializationShell />, root);
  } catch (error) {
    renderInitializationError(root, error);
    return;
  }

  queueMicrotask(() => {
    try {
      render(
        <ExtensionErrorBoundary>
          <MinhaAssinatura />
        </ExtensionErrorBoundary>,
        root,
      );
    } catch (error) {
      renderInitializationError(root, error);
    }
  });
}

function InitializationShell() {
  return (
    <s-page heading="Minha Assinatura">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-spinner accessibilityLabel="Carregando assinaturas" />
        <s-text>Carregando suas assinaturas...</s-text>
      </s-stack>
    </s-page>
  );
}

function renderInitializationError(root, error) {
  console.error("Minha Assinatura initialization error", error);
  root.textContent = "";
  const page = document.createElement("s-page");
  page.setAttribute("heading", "Minha Assinatura");
  const banner = document.createElement("s-banner");
  banner.setAttribute("tone", "critical");
  banner.textContent =
    "Não foi possível iniciar esta página. Tente recarregar.";
  page.appendChild(banner);
  root.appendChild(page);
}

class ExtensionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {error: null};
  }

  componentDidCatch(error) {
    console.error("Minha Assinatura render error", error);
    this.setState({error});
  }

  render() {
    if (this.state.error) {
      return (
        <s-page heading="Minha Assinatura">
          <s-banner tone="critical">
            Não foi possível exibir suas assinaturas agora. Tente recarregar a página.
          </s-banner>
        </s-page>
      );
    }

    return this.props.children;
  }
}

async function customerAccountRequest(query, variables = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({query, variables}),
  });

  if (!response.ok) throw new Error(`Customer Account API: ${response.status}`);

  const result = await response.json();

  if (result.errors?.length) {
    throw new Error(result.errors[0].message);
  }

  return result.data;
}

function MinhaAssinatura() {
  const [contracts, setContracts] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [cancelContract, setCancelContract] = useState(null);
  const pageState = resolvePageState(contracts, loadError);

  const loadContracts = useCallback(async () => {
    try {
      setLoadError(false);
      const data = await customerAccountRequest(SUBSCRIPTIONS_QUERY);
      setContracts(data?.customer?.subscriptionContracts?.nodes ?? []);
    } catch (error) {
      console.error("Minha Assinatura API error", error);
      setLoadError(true);
      setContracts([]);
    }
  }, []);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  async function manageContract(action, contract) {
    if (!contract?.id) return;

    setPendingId(contract.id);
    setFeedback(null);

    try {
      const data = await customerAccountRequest(MUTATIONS[action], {
        subscriptionContractId: contract.id,
      });

      const payload = data?.[`subscriptionContract${capitalize(action)}`];

      if (!payload) {
        throw new Error("A Shopify não retornou o resultado da operação.");
      }

      if (payload.userErrors?.length) {
        throw new Error(
          payload.userErrors.map(({message}) => message).join(" "),
        );
      }

      setContracts((current) =>
        (current ?? []).map((item) =>
          item.id === contract.id
            ? {...item, status: payload.contract?.status ?? item.status}
            : item,
        ),
      );

      if (action === "cancel") {
        document.getElementById("cancel-subscription")?.hideOverlay();
      }

      setCancelContract(null);
      setFeedback({
        tone: "success",
        message: successMessage(action),
      });
    } catch (error) {
      console.error("Minha Assinatura mutation error", error);
      setFeedback(mutationErrorFeedback(error));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <s-page
      heading="Minha Assinatura"
      subheading="Gerencie seus planos, próximas cobranças e preferências de assinatura."
    >
      <s-stack direction="block" gap="base">
        {feedback && (
          <s-banner tone={feedback.tone}>{feedback.message}</s-banner>
        )}

        {pageState === "loading" && (
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner accessibilityLabel="Carregando assinaturas" />
            <s-text>Carregando suas assinaturas...</s-text>
          </s-stack>
        )}

        {pageState === "error" && (
          <s-stack direction="block" gap="small">
            <s-banner tone="critical">
              Não foi possível carregar suas assinaturas. Tente novamente.
            </s-banner>
            <s-button onClick={loadContracts}>Tentar novamente</s-button>
          </s-stack>
        )}

        {pageState === "empty" && (
          <s-section>
            <s-text>Você ainda não possui assinaturas.</s-text>
          </s-section>
        )}

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
        <s-paragraph>
          Tem certeza que deseja cancelar esta assinatura? Esta ação interromperá
          as próximas cobranças.
        </s-paragraph>

        <s-button
          slot="secondary-actions"
          commandFor="cancel-subscription"
          command="--hide"
          onClick={() => setCancelContract(null)}
        >
          Voltar
        </s-button>

        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          disabled={!cancelContract || pendingId === cancelContract?.id}
          loading={pendingId === cancelContract?.id}
          onClick={() => manageContract("cancel", cancelContract)}
        >
          Confirmar cancelamento
        </s-button>
      </s-modal>
    </s-page>
  );
}

function ContractCard({contract, busy, onPause, onActivate, onCancel}) {
  const lines = contract?.lines?.nodes ?? [];
  const actions = contractActions(contract.status);

  const total = lines.reduce(
    (sum, line) =>
      sum +
      Number(line?.currentPrice?.amount ?? 0) *
        Number(line?.quantity ?? 0),
    0,
  );

  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-badge tone={STATUS_TONES[contract.status] ?? "neutral"}>
          {STATUS_LABELS[contract.status] ?? contract.status}
        </s-badge>

        {lines.map((line) => (
          <s-stack key={line.id} direction="block" gap="small">
            <s-heading>
              {line.title}
              {line.variantTitle ? ` — ${line.variantTitle}` : ""}
            </s-heading>

            <s-text>Quantidade: {line.quantity}</s-text>

            {line.currentPrice && (
              <s-text>
                {formatMoney(
                  line.currentPrice.amount,
                  line.currentPrice.currencyCode,
                )}
              </s-text>
            )}
          </s-stack>
        ))}

        <s-text type="strong">
          Total: {formatMoney(total, contract.currencyCode)}
        </s-text>

        <s-text>
          {formatFrequency("Cobrança", contract.billingPolicy)}
        </s-text>

        <s-text>
          {formatFrequency("Entrega", contract.deliveryPolicy)}
        </s-text>

        <s-text>
          Próxima cobrança:{" "}
          {contract.nextBillingDate
            ? formatDate(contract.nextBillingDate)
            : "Não disponível"}
        </s-text>

        {actions.length > 0 && (
          <s-button-group>
            {actions.includes("pause") ? (
              <s-button
                disabled={busy}
                loading={busy}
                onClick={onPause}
              >
                Pausar assinatura
              </s-button>
            ) : (
              <s-button
                disabled={busy}
                loading={busy}
                onClick={onActivate}
              >
                Retomar assinatura
              </s-button>
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
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currencyCode || "BRL",
    }).format(Number(amount ?? 0));
  } catch {
    return `${currencyCode || "BRL"} ${Number(amount ?? 0).toFixed(2)}`;
  }
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "UTC",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatFrequency(label, policy) {
  if (!policy?.interval) {
    return `${label}: não disponível`;
  }

  const count = Number(policy?.intervalCount?.count ?? 1);

  const units = {
    DAY: count === 1 ? "dia" : "dias",
    WEEK: count === 1 ? "semana" : "semanas",
    MONTH: count === 1 ? "mês" : "meses",
    YEAR: count === 1 ? "ano" : "anos",
  };

  return `${label} a cada ${count} ${
    units[policy.interval] ?? String(policy.interval).toLowerCase()
  }`;
}
