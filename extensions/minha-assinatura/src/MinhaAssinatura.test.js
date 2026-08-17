import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapExtension,
  MUTATIONS,
  renderInitializationError,
  SUBSCRIPTIONS_QUERY,
} from "./MinhaAssinatura.jsx";

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.ownText = "";
    this.overlayShown = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  get id() {
    return this.getAttribute("id") ?? "";
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get("click")?.({ currentTarget: this });
  }

  showOverlay() {
    this.overlayShown = true;
  }

  hideOverlay() {
    this.overlayShown = false;
  }

  set textContent(value) {
    this.ownText = String(value);
    this.children = [];
  }

  get textContent() {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement("body", this);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return walk(this.body).find((element) => element.id === id) ?? null;
  }
}

function walk(element) {
  return [element, ...element.children.flatMap(walk)];
}

function findByText(root, text) {
  return walk(root).find((element) => element.ownText === text);
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function contract(status = "ACTIVE") {
  return {
    id: "gid://shopify/SubscriptionContract/1",
    status,
    currencyCode: "BRL",
    nextBillingDate: "2026-09-10T00:00:00Z",
    billingPolicy: { interval: "MONTH", intervalCount: { count: 1 } },
    deliveryPolicy: { interval: "WEEK", intervalCount: { count: 2 } },
    lines: {
      nodes: [
        {
          id: "line-1",
          title: "Produto Betterlife",
          variantTitle: "Frasco 60 cápsulas",
          quantity: 2,
          currentPrice: { amount: "49.90", currencyCode: "BRL" },
        },
      ],
    },
  };
}

function dataWith(contracts) {
  return { customer: { subscriptionContracts: { nodes: contracts } } };
}

test("renders loading immediately before the query completes", () => {
  const documentRef = new FakeDocument();
  const pending = deferred();
  bootstrapExtension(documentRef.body, {
    documentRef,
    request: () => pending.promise,
  });

  assert.equal(documentRef.body.children[0].tagName, "s-page");
  assert.equal(
    documentRef.body.children[0].getAttribute("heading"),
    "Minha Assinatura",
  );
  assert.match(documentRef.body.textContent, /Carregando suas assinaturas/);
});

test("renders contracts and all subscription details", async () => {
  const documentRef = new FakeDocument();
  const controller = bootstrapExtension(documentRef.body, {
    documentRef,
    request: async (query) => {
      assert.equal(query, SUBSCRIPTIONS_QUERY);
      return dataWith([contract()]);
    },
  });
  await controller.ready;

  assert.match(documentRef.body.textContent, /Ativa/);
  assert.match(
    documentRef.body.textContent,
    /Produto Betterlife — Frasco 60 cápsulas/,
  );
  assert.match(documentRef.body.textContent, /Quantidade: 2/);
  assert.match(documentRef.body.textContent, /Total:/);
  assert.match(documentRef.body.textContent, /Cobrança a cada 1 mês/);
  assert.match(documentRef.body.textContent, /Entrega a cada 2 semanas/);
  assert.match(documentRef.body.textContent, /Próxima cobrança:/);
});

test("renders the empty state", async () => {
  const documentRef = new FakeDocument();
  const controller = bootstrapExtension(documentRef.body, {
    documentRef,
    request: async () => dataWith([]),
  });
  await controller.ready;

  assert.match(
    documentRef.body.textContent,
    /Você ainda não possui assinaturas/,
  );
});

test("renders an error and retry replaces it with loaded data", async () => {
  const documentRef = new FakeDocument();
  let attempts = 0;
  const controller = bootstrapExtension(documentRef.body, {
    documentRef,
    request: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("API indisponível");
      return dataWith([contract()]);
    },
  });
  await controller.ready;

  assert.match(documentRef.body.textContent, /Não foi possível carregar/);
  const retry = findByText(documentRef.body, "Tentar novamente");
  assert.ok(retry);
  retry.click();
  await flushPromises();

  assert.match(documentRef.body.textContent, /Produto Betterlife/);
  assert.doesNotMatch(
    documentRef.body.textContent,
    /Não foi possível carregar/,
  );
});

for (const [action, initialStatus, resultingStatus, mutationName] of [
  ["pause", "ACTIVE", "PAUSED", "PausarAssinatura"],
  ["activate", "PAUSED", "ACTIVE", "RetomarAssinatura"],
]) {
  test(`${action} sends the preserved mutation and updates the status`, async () => {
    const documentRef = new FakeDocument();
    const calls = [];
    const currentContract = contract(initialStatus);
    const controller = bootstrapExtension(documentRef.body, {
      documentRef,
      request: async (query, variables) => {
        calls.push({ query, variables });
        if (query === SUBSCRIPTIONS_QUERY) return dataWith([currentContract]);
        return {
          [`subscriptionContract${action[0].toUpperCase()}${action.slice(1)}`]:
            {
              contract: { id: currentContract.id, status: resultingStatus },
              userErrors: [],
            },
        };
      },
    });
    await controller.ready;
    const actionButton = findByText(
      documentRef.body,
      action === "pause" ? "Pausar assinatura" : "Retomar assinatura",
    );
    assert.equal(actionButton.getAttribute("slot"), "primary-action");
    assert.equal(actionButton.getAttribute("variant"), "primary");
    actionButton.click();

    assert.ok(
      walk(documentRef.body).some(
        (element) => element.getAttribute("loading") === "",
      ),
    );
    await flushPromises();
    assert.match(calls[1].query, new RegExp(`mutation ${mutationName}`));
    assert.deepEqual(calls[1].variables, {
      subscriptionContractId: currentContract.id,
    });
    assert.match(documentRef.body.textContent, /sucesso/);
  });
}

test("cancel requires confirmation and sends the preserved mutation", async () => {
  const documentRef = new FakeDocument();
  const currentContract = contract("ACTIVE");
  const calls = [];
  const controller = bootstrapExtension(documentRef.body, {
    documentRef,
    request: async (query, variables) => {
      calls.push({ query, variables });
      if (query === SUBSCRIPTIONS_QUERY) return dataWith([currentContract]);
      return {
        subscriptionContractCancel: {
          contract: { id: currentContract.id, status: "CANCELLED" },
          userErrors: [],
        },
      };
    },
  });
  await controller.ready;

  const cancelButton = findByText(documentRef.body, "Cancelar assinatura");
  assert.equal(cancelButton.getAttribute("slot"), "secondary-actions");
  assert.equal(cancelButton.getAttribute("variant"), "secondary");
  assert.equal(cancelButton.getAttribute("tone"), "critical");
  cancelButton.click();
  const modal = documentRef.getElementById("cancel-subscription");
  assert.equal(modal.overlayShown, true);
  findByText(modal, "Confirmar cancelamento").click();
  await flushPromises();

  assert.equal(calls.length, 2);
  assert.equal(calls[1].query, MUTATIONS.cancel);
  assert.deepEqual(calls[1].variables, {
    subscriptionContractId: currentContract.id,
  });
  assert.match(
    documentRef.body.textContent,
    /Assinatura cancelada com sucesso/,
  );
});

test("a stale query cannot overwrite a newer retry", async () => {
  const documentRef = new FakeDocument();
  const first = deferred();
  const second = deferred();
  let attempt = 0;
  const controller = bootstrapExtension(documentRef.body, {
    documentRef,
    request: () => (attempt++ === 0 ? first.promise : second.promise),
  });

  const retry = controller.loadContracts();
  second.resolve(dataWith([contract()]));
  await retry;
  first.resolve(dataWith([]));
  await controller.ready;

  assert.match(documentRef.body.textContent, /Produto Betterlife/);
  assert.doesNotMatch(documentRef.body.textContent, /Você ainda não possui/);
});

test("an initialization failure always produces a visible banner", () => {
  const documentRef = new FakeDocument();
  renderInitializationError(
    documentRef.body,
    new Error("falha antes do fetch"),
    documentRef,
  );

  const banner = walk(documentRef.body).find(
    (element) => element.tagName === "s-banner",
  );
  assert.ok(banner);
  assert.equal(banner.getAttribute("tone"), "critical");
  assert.match(banner.textContent, /Não foi possível iniciar esta página/);
});
