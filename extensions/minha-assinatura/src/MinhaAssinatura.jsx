import {
  createLatestRequestCoordinator,
  customerAccountRequest as requestCustomerAccount,
} from "./customer-account-request.js";
import {
  contractActions,
  mutationErrorFeedback,
} from "./subscription-page-state.js";

const API_VERSION = "2026-07";
const API_URL = `shopify://customer-account/api/${API_VERSION}/graphql.json`;

export const SUBSCRIPTIONS_QUERY = `#graphql
  query MinhaAssinatura {
    customer {
      subscriptionContracts(first: 50) {
        nodes {
          id
          status
          currencyCode
          nextBillingDate
          billingPolicy { interval intervalCount { count } }
          deliveryPolicy { interval intervalCount { count } }
          lines(first: 50) {
            nodes {
              id
              title
              variantTitle
              quantity
              currentPrice { amount currencyCode }
            }
          }
        }
      }
    }
  }
`;

export const MUTATIONS = {
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

export default async () => {
  try {
    bootstrapExtension(document.body);
  } catch (error) {
    renderInitializationError(document.body, error);
  }
};

export function bootstrapExtension(
  root,
  {
    documentRef = document,
    request = (query, variables) =>
      requestCustomerAccount(API_URL, query, variables),
  } = {},
) {
  const page = createElement(documentRef, "s-page", {
    heading: "Minha Assinatura",
    subheading:
      "Gerencie seus planos, próximas cobranças e preferências de assinatura.",
  });
  root.textContent = "";
  root.appendChild(page);

  const state = {
    contracts: null,
    loadError: null,
    feedback: null,
    pendingId: null,
    cancelContract: null,
  };
  const loadCoordinator = createLatestRequestCoordinator();

  function renderPage() {
    try {
      page.textContent = "";
      const content = createElement(documentRef, "s-stack", {
        direction: "block",
        gap: "base",
      });

      if (state.feedback) {
        content.appendChild(
          textElement(documentRef, "s-banner", state.feedback.message, {
            tone: state.feedback.tone,
          }),
        );
      }

      if (state.contracts === null && !state.loadError) {
        content.appendChild(renderLoading(documentRef));
      } else if (state.loadError) {
        content.appendChild(renderLoadError(documentRef, loadContracts));
      } else if (state.contracts.length === 0) {
        const section = createElement(documentRef, "s-section");
        section.appendChild(
          textElement(
            documentRef,
            "s-text",
            "Você ainda não possui assinaturas.",
          ),
        );
        content.appendChild(section);
      } else {
        for (const contract of state.contracts) {
          content.appendChild(
            renderContract(documentRef, contract, {
              busy: state.pendingId === contract.id,
              onAction: manageContract,
              onCancel: openCancelConfirmation,
            }),
          );
        }
      }

      page.appendChild(content);
      page.appendChild(renderCancelModal(documentRef));
    } catch (error) {
      renderPageError(page, documentRef, error);
    }
  }

  function loadContracts() {
    return loadCoordinator.run({
      request: () => request(SUBSCRIPTIONS_QUERY, {}),
      onLoading: () => {
        state.contracts = null;
        state.loadError = null;
        renderPage();
      },
      onSuccess: (data) => {
        state.contracts = data?.customer?.subscriptionContracts?.nodes ?? [];
        renderPage();
      },
      onError: (error) => {
        console.error("Minha Assinatura API error", error);
        state.contracts = [];
        state.loadError = error;
        renderPage();
      },
    });
  }

  async function manageContract(action, contract) {
    if (!contract?.id || !MUTATIONS[action]) return;
    state.pendingId = contract.id;
    state.feedback = null;
    renderPage();

    try {
      const data = await request(MUTATIONS[action], {
        subscriptionContractId: contract.id,
      });
      const payload = data?.[`subscriptionContract${capitalize(action)}`];
      if (!payload) {
        throw new Error("A Shopify não retornou o resultado da operação.");
      }
      if (payload.userErrors?.length) {
        throw new Error(
          payload.userErrors.map(({ message }) => message).join(" "),
        );
      }

      state.contracts = state.contracts.map((item) =>
        item.id === contract.id
          ? { ...item, status: payload.contract?.status ?? item.status }
          : item,
      );
      state.cancelContract = null;
      state.feedback = { tone: "success", message: successMessage(action) };
    } catch (error) {
      console.error("Minha Assinatura mutation error", error);
      state.feedback = mutationErrorFeedback(error);
    } finally {
      state.pendingId = null;
      renderPage();
      if (action === "cancel") {
        documentRef.getElementById("cancel-subscription")?.hideOverlay?.();
      }
    }
  }

  function openCancelConfirmation(contract) {
    state.cancelContract = contract;
  }

  function renderCancelModal(documentForModal) {
    const modal = createElement(documentForModal, "s-modal", {
      id: "cancel-subscription",
      heading: "Cancelar assinatura",
    });
    modal.appendChild(
      textElement(
        documentForModal,
        "s-paragraph",
        "Tem certeza que deseja cancelar esta assinatura? Esta ação interromperá as próximas cobranças.",
      ),
    );

    const backButton = textElement(documentForModal, "s-button", "Voltar", {
      slot: "secondary-actions",
      commandFor: modal.id,
      command: "--hide",
    });
    backButton.addEventListener("click", () => {
      state.cancelContract = null;
    });
    modal.appendChild(backButton);

    const confirmButton = textElement(
      documentForModal,
      "s-button",
      "Confirmar cancelamento",
      { slot: "primary-action", variant: "primary", tone: "critical" },
    );
    setBusy(
      confirmButton,
      Boolean(state.pendingId),
      Boolean(state.pendingId),
    );
    confirmButton.addEventListener("click", () => {
      if (state.cancelContract && !state.pendingId) {
        void manageContract("cancel", state.cancelContract);
      }
    });
    modal.appendChild(confirmButton);
    return modal;
  }

  renderPage();
  const ready = loadContracts();
  return {
    loadContracts,
    manageContract,
    openCancelConfirmation,
    ready,
    state,
  };
}

export function renderInitializationError(root, error, documentRef = document) {
  console.error("Minha Assinatura initialization error", error);
  root.textContent = "";
  const page = createElement(documentRef, "s-page", {
    heading: "Minha Assinatura",
  });
  page.appendChild(
    textElement(
      documentRef,
      "s-banner",
      "Não foi possível iniciar esta página. Tente recarregar.",
      { tone: "critical" },
    ),
  );
  root.appendChild(page);
}

function renderPageError(page, documentRef, error) {
  console.error("Minha Assinatura render error", error);
  page.textContent = "";
  page.appendChild(
    textElement(
      documentRef,
      "s-banner",
      "Não foi possível exibir suas assinaturas agora. Tente recarregar a página.",
      { tone: "critical" },
    ),
  );
}

function renderLoading(documentRef) {
  const stack = createElement(documentRef, "s-stack", {
    direction: "inline",
    gap: "base",
    alignItems: "center",
  });
  stack.appendChild(
    createElement(documentRef, "s-spinner", {
      accessibilityLabel: "Carregando assinaturas",
    }),
  );
  stack.appendChild(
    textElement(documentRef, "s-text", "Carregando suas assinaturas..."),
  );
  return stack;
}

function renderLoadError(documentRef, retry) {
  const stack = createElement(documentRef, "s-stack", {
    direction: "block",
    gap: "small",
  });
  stack.appendChild(
    textElement(
      documentRef,
      "s-banner",
      "Não foi possível carregar suas assinaturas. Tente novamente.",
      { tone: "critical" },
    ),
  );
  const retryButton = textElement(documentRef, "s-button", "Tentar novamente");
  retryButton.addEventListener("click", () => void retry());
  stack.appendChild(retryButton);
  return stack;
}

function renderContract(documentRef, contract, { busy, onAction, onCancel }) {
  const section = createElement(documentRef, "s-section");
  const stack = createElement(documentRef, "s-stack", {
    direction: "block",
    gap: "base",
  });
  const lines = contract?.lines?.nodes ?? [];
  stack.appendChild(
    textElement(
      documentRef,
      "s-badge",
      STATUS_LABELS[contract.status] ?? contract.status,
      { tone: STATUS_TONES[contract.status] ?? "neutral" },
    ),
  );

  for (const line of lines) {
    const lineStack = createElement(documentRef, "s-stack", {
      direction: "block",
      gap: "small",
    });
    lineStack.appendChild(
      textElement(
        documentRef,
        "s-heading",
        `${line.title}${line.variantTitle ? ` — ${line.variantTitle}` : ""}`,
      ),
    );
    lineStack.appendChild(
      textElement(documentRef, "s-text", `Quantidade: ${line.quantity}`),
    );
    if (line.currentPrice) {
      lineStack.appendChild(
        textElement(
          documentRef,
          "s-text",
          formatMoney(line.currentPrice.amount, line.currentPrice.currencyCode),
        ),
      );
    }
    stack.appendChild(lineStack);
  }

  const total = lines.reduce(
    (sum, line) =>
      sum +
      Number(line?.currentPrice?.amount ?? 0) * Number(line?.quantity ?? 0),
    0,
  );
  stack.appendChild(
    textElement(
      documentRef,
      "s-text",
      `Total: ${formatMoney(total, contract.currencyCode)}`,
      { type: "strong" },
    ),
  );
  stack.appendChild(
    textElement(
      documentRef,
      "s-text",
      formatFrequency("Cobrança", contract.billingPolicy),
    ),
  );
  stack.appendChild(
    textElement(
      documentRef,
      "s-text",
      formatFrequency("Entrega", contract.deliveryPolicy),
    ),
  );
  stack.appendChild(
    textElement(
      documentRef,
      "s-text",
      `Próxima cobrança: ${
        contract.nextBillingDate
          ? formatDate(contract.nextBillingDate)
          : "Não disponível"
      }`,
    ),
  );

  const actions = contractActions(contract.status);
  if (actions.length > 0) {
    const buttonGroup = createElement(documentRef, "s-button-group");
    const primaryAction = actions.includes("pause") ? "pause" : "activate";
    const primaryButton = textElement(
      documentRef,
      "s-button",
      primaryAction === "pause" ? "Pausar assinatura" : "Retomar assinatura",
      { slot: "primary-action", variant: "primary" },
    );
    setBusy(primaryButton, busy, busy);
    primaryButton.addEventListener("click", () => {
      if (!busy) void onAction(primaryAction, contract);
    });
    buttonGroup.appendChild(primaryButton);

    const cancelButton = textElement(
      documentRef,
      "s-button",
      "Cancelar assinatura",
      {
        slot: "secondary-actions",
        variant: "secondary",
        tone: "critical",
        command: "--show",
        commandFor: "cancel-subscription",
      },
    );
    setBusy(cancelButton, busy, false);
    cancelButton.addEventListener("click", () => {
      if (!busy) onCancel(contract);
    });
    buttonGroup.appendChild(cancelButton);
    stack.appendChild(buttonGroup);
  }
  section.appendChild(stack);
  return section;
}

function createElement(documentRef, tagName, attributes = {}) {
  const element = documentRef.createElement(tagName);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) {
      element.setAttribute(name, String(value));
    }
  }
  return element;
}

function textElement(documentRef, tagName, text, attributes) {
  const element = createElement(documentRef, tagName, attributes);
  element.textContent = text;
  return element;
}

function setBusy(button, disabled, loading) {
  if (disabled) button.setAttribute("disabled", "");
  if (loading) button.setAttribute("loading", "");
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
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
      new Date(value),
    );
  } catch {
    return value;
  }
}

function formatFrequency(label, policy) {
  if (!policy?.interval) return `${label}: não disponível`;
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
