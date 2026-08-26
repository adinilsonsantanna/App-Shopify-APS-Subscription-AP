import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureCentralShopInstallation,
  reconcileExistingShopInstallation,
  type AuthenticatedAdminContext,
} from "./durable-installation.server";

const session = { shop: "one.myshopify.com", accessToken: "secret-token", scope: "read_products" };

function context(
  shop = { id: "gid://shopify/Shop/1", name: "One", myshopifyDomain: "one.myshopify.com" },
  sessionOverride = session,
): AuthenticatedAdminContext {
  return {
    session: sessionOverride,
    admin: { graphql: async () => Response.json({ data: { shop } }) },
  };
}

const quietLogger = { error: () => undefined };

test("sessão válida existente executa reconciliação autenticada", async () => {
  let calls = 0;
  const result = await ensureCentralShopInstallation(context(), {
    sync: { syncShop: async () => { calls += 1; return {}; } },
    logger: quietLogger,
  });
  assert.deepEqual(result, { synchronized: true, shop: "one.myshopify.com" });
  assert.equal(calls, 1);
});

test("domínio da instalação vem exclusivamente da sessão autenticada", async () => {
  let payload: any;
  await ensureCentralShopInstallation(context(), {
    sync: { syncShop: async (value) => { payload = value; return {}; } },
    logger: quietLogger,
  });
  assert.equal(payload.domain, session.shop);
  assert.equal(payload.accessToken, session.accessToken);
});

test("shopId canônico vem exclusivamente da GraphQL autenticada", async () => {
  let payload: any;
  await ensureCentralShopInstallation(context({ id: "gid://shopify/Shop/900719925474099312345", name: "One", myshopifyDomain: session.shop }), {
    sync: { syncShop: async (value) => { payload = value; return {}; } },
    logger: quietLogger,
  });
  assert.equal(payload.shopifyShopId, "gid://shopify/Shop/900719925474099312345");
});

test("query string forjada é ignorada pelo bootstrap autenticado", async () => {
  const request = new Request("https://app.example/app?shop=attacker.myshopify.com&shopifyShopId=999");
  let authenticatedContext: AuthenticatedAdminContext | undefined;
  const expected = context();
  await reconcileExistingShopInstallation(
    request,
    async () => expected,
    async (value) => {
      authenticatedContext = value;
      return { synchronized: true, shop: value.session.shop };
    },
  );
  assert.equal(authenticatedContext, expected);
  assert.equal(authenticatedContext?.session.shop, "one.myshopify.com");
});

test("loja inativa é enviada ao endpoint idempotente de instalação", async () => {
  const calls: any[] = [];
  await ensureCentralShopInstallation(context(), {
    sync: { syncShop: async (value) => { calls.push(value); return { isActive: true, installationGeneration: 1 }; } },
    logger: quietLogger,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shopifyShopId, "gid://shopify/Shop/1");
});

test("segunda abertura mantém payload idempotente e permite retry da API", async () => {
  const calls: any[] = [];
  const sync = { syncShop: async (value: any) => { calls.push(value); return {}; } };
  await ensureCentralShopInstallation(context(), { sync, logger: quietLogger });
  await ensureCentralShopInstallation(context(), { sync, logger: quietLogger });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});

test("falha transitória não quebra a página e retry posterior funciona", async () => {
  let calls = 0;
  const sync = { syncShop: async () => { calls += 1; if (calls === 1) throw new Error("temporary upstream failure"); return {}; } };
  const first = await ensureCentralShopInstallation(context(), { sync, logger: quietLogger });
  const second = await ensureCentralShopInstallation(context(), { sync, logger: quietLogger });
  assert.equal(first.synchronized, false);
  assert.equal(second.synchronized, true);
  assert.equal(calls, 2);
});

test("sessão inválida não chama GraphQL nem API Central", async () => {
  let graphqlCalls = 0;
  let centralCalls = 0;
  const invalid: AuthenticatedAdminContext = {
    session: { ...session, accessToken: undefined },
    admin: { graphql: async () => { graphqlCalls += 1; return Response.json({}); } },
  };
  const result = await ensureCentralShopInstallation(invalid, {
    sync: { syncShop: async () => { centralCalls += 1; return {}; } },
    logger: quietLogger,
  });
  assert.equal(result.synchronized, false);
  assert.equal(graphqlCalls, 0);
  assert.equal(centralCalls, 0);
});

test("autenticação rejeitada não inicia reconciliação", async () => {
  let reconciliationCalls = 0;
  await assert.rejects(
    reconcileExistingShopInstallation(
      new Request("https://app.example/app"),
      async () => { throw new Response("Unauthorized", { status: 401 }); },
      async () => { reconciliationCalls += 1; return { synchronized: true, shop: session.shop }; },
    ),
  );
  assert.equal(reconciliationCalls, 0);
});

test("token e segredos não aparecem em logs nem no resultado", async () => {
  const entries: unknown[][] = [];
  const result = await ensureCentralShopInstallation(context(), {
    sync: { syncShop: async () => { throw new Error(`upstream exposed ${session.accessToken} and api-key-value`); } },
    logger: { error: (...args: unknown[]) => { entries.push(args); } },
  });
  const evidence = JSON.stringify({ entries, result });
  assert.equal(evidence.includes(session.accessToken), false);
  assert.equal(evidence.includes("api-key-value"), false);
  assert.deepEqual(result, { synchronized: false, shop: session.shop });
});

test("concorrência no mesmo carregamento compartilha uma chamada externa", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sync = { syncShop: async () => { calls += 1; await gate; return {}; } };
  const first = ensureCentralShopInstallation(context(), { sync, logger: quietLogger });
  const second = ensureCentralShopInstallation(context(), { sync, logger: quietLogger });
  release();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
});

test("nomes Betterlife não recebem tratamento especial", async () => {
  const domains = ["ordinary-fixture.myshopify.com", "betterlife-fixture.myshopify.com"];
  const synchronized: string[] = [];
  for (const domain of domains) {
    await ensureCentralShopInstallation(
      context({ id: `gid://shopify/Shop/${synchronized.length + 1}`, name: domain, myshopifyDomain: domain }, { ...session, shop: domain }),
      { sync: { syncShop: async (value) => { synchronized.push(value.domain); return {}; } }, logger: quietLogger },
    );
  }
  assert.deepEqual(synchronized, domains);
});
