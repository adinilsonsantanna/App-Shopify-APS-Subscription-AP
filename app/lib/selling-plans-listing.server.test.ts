import test from "node:test";
import assert from "node:assert/strict";
import {
  listSubscriptionProducts,
  createSellingPlan,
  updateSellingPlan,
  deleteSellingPlan,
  type SubscriptionProduct,
  type SellingPlanGroup,
} from "./selling-plans.server";

const MERCHANT_CODE = "aps-subscription";
const APP_ID = "gid://shopify/App/999";

type FixturePlan = {
  id: string;
  name: string;
};

type FixtureGroup = {
  id: string;
  name: string;
  merchantCode: string;
  appId?: string | null;
  plans: FixturePlan[];
};

type FixtureProduct = {
  id: string;
  title: string;
  groups: FixtureGroup[];
};

type AdminMock = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
  calls: { query: string; variables?: Record<string, unknown> }[];
};

const PLAN_FIELDS_RENDER = {
  id: "gid://shopify/SellingPlan/1",
  name: "Plano de Teste",
  options: ["Frequência"],
  billingPolicy: { interval: "MONTH", intervalCount: 1 },
  deliveryPolicy: { interval: "MONTH", intervalCount: 1 },
  pricingPolicies: [
    {
      adjustmentType: "PERCENTAGE",
      adjustmentValue: { percentage: 10 },
    },
  ],
};

function renderPlan(plan: FixturePlan): unknown {
  return {
    id: plan.id,
    name: plan.name,
    options: PLAN_FIELDS_RENDER.options,
    billingPolicy: PLAN_FIELDS_RENDER.billingPolicy,
    deliveryPolicy: PLAN_FIELDS_RENDER.deliveryPolicy,
    pricingPolicies: PLAN_FIELDS_RENDER.pricingPolicies,
  };
}

function renderGroup(group: FixtureGroup): unknown {
  return {
    id: group.id,
    name: group.name,
    merchantCode: group.merchantCode,
    appId: group.appId ?? null,
    sellingPlans: {
      nodes: group.plans.map(renderPlan),
    },
  };
}

function defaultPlan(id: string, name: string): FixturePlan {
  return { id: `gid://shopify/SellingPlan/${id}`, name };
}

function ownedGroup(id: string, plans: FixturePlan[] = []): FixtureGroup {
  return { id: `gid://shopify/SellingPlanGroup/${id}`, name: `Grupo ${id}`, merchantCode: MERCHANT_CODE, plans };
}

function foreignGroup(id: string, plans: FixturePlan[] = []): FixtureGroup {
  return { id: `gid://shopify/SellingPlanGroup/${id}`, name: `Outro ${id}`, merchantCode: "other-app", plans };
}

function slicePage<T>(items: T[], cursor: string | null, pageSize: number) {
  const start = cursor === null ? 0 : Number(cursor);
  const nodes = items.slice(start, start + pageSize);
  const nextStart = start + nodes.length;
  return {
    nodes,
    pageInfo: {
      hasNextPage: nextStart < items.length,
      endCursor: nextStart.toString(),
    },
  };
}

function collectGroupIndex(products: FixtureProduct[]) {
  const byGroup = new Map<string, FixtureProduct[]>();
  const groupDefs = new Map<string, FixtureGroup>();
  for (const p of products) {
    for (const g of p.groups) {
      if (!groupDefs.has(g.id)) groupDefs.set(g.id, g);
      const list = byGroup.get(g.id) ?? [];
      list.push(p);
      byGroup.set(g.id, list);
    }
  }
  return { byGroup, groupDefs };
}

function makeAdmin(
  products: FixtureProduct[],
  opts: {
    groupsPageSize?: number;
    rootGroupsPageSize?: number;
    groupProductsPageSize?: number;
    groupPlansPageSize?: number;
    stuckProductsCursor?: boolean;
    stuckRootGroupsCursor?: boolean;
    stuckGroupProductsCursor?: boolean;
    failRootGroups?: boolean;
  } = {},
): AdminMock {
  const calls: AdminMock["calls"] = [];
  const searchable = products.map((p) => p);
  const graphql = async (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response> => {
    calls.push({ query, variables: options?.variables });
    const variables = options?.variables ?? {};
    const cursor = (variables.cursor as string | null) ?? null;

    if (query.includes("ApsRootSellingPlanGroups")) {
      if (opts.failRootGroups) {
        return new Response("boom", { status: 429 });
      }
      const groups = [...collectGroupIndex(searchable).groupDefs.values()];
      const page = slicePage(groups, cursor, opts.rootGroupsPageSize ?? 100);
      return Response.json({
        data: {
          currentAppInstallation: { app: { id: APP_ID } },
          sellingPlanGroups: {
            nodes: page.nodes.map((g) => ({
              id: g.id,
              name: g.name,
              merchantCode: g.merchantCode,
              appId: g.appId ?? null,
            })),
            pageInfo: opts.stuckRootGroupsCursor
              ? { hasNextPage: true, endCursor: cursor }
              : page.pageInfo,
          },
        },
      });
    }

    if (query.includes("ApsSellingPlanGroupProducts")) {
      const id = variables.id as string;
      const idProducts = collectGroupIndex(searchable).byGroup.get(id) ?? [];
      const page = slicePage(idProducts, cursor, opts.groupProductsPageSize ?? 50);
      return Response.json({
        data: {
          sellingPlanGroup: {
            products: {
              nodes: page.nodes.map((p) => ({
                id: p.id,
                title: p.title,
                featuredMedia: null,
              })),
              pageInfo: opts.stuckGroupProductsCursor
                ? { hasNextPage: true, endCursor: cursor }
                : page.pageInfo,
            },
          },
        },
      });
    }

    if (query.includes("ApsGroupSellingPlans")) {
      const id = variables.id as string;
      const group = collectGroupIndex(searchable).groupDefs.get(id);
      if (!group) {
        return Response.json({ data: { sellingPlanGroup: null } });
      }
      const page = slicePage(group.plans, cursor, opts.groupPlansPageSize ?? 100);
      return Response.json({
        data: {
          sellingPlanGroup: {
            sellingPlans: {
              nodes: page.nodes.map(renderPlan),
              pageInfo: page.pageInfo,
            },
          },
        },
      });
    }

    if (query.includes("ApsSubscriptionProducts")) {
      const search = (variables.query as string | null) ?? "";
      const filtered = search
        ? searchable.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
        : searchable;
      const page = slicePage(filtered, cursor, 50);
      return Response.json({
        data: {
          currentAppInstallation: { app: { id: APP_ID } },
          products: {
            nodes: page.nodes.map((p) => ({
              id: p.id,
              title: p.title,
              featuredMedia: null,
            })),
            pageInfo: opts.stuckProductsCursor
              ? { hasNextPage: true, endCursor: cursor }
              : page.pageInfo,
          },
        },
      });
    }

    if (query.includes("ApsProductSellingPlanGroups")) {
      const id = variables.id as string;
      const product = searchable.find((p) => p.id === id);
      if (!product) {
        return Response.json({ data: { product: null } });
      }
      const pageSize = opts.groupsPageSize ?? 20;
      const page = slicePage(product.groups, cursor, pageSize);
      return Response.json({
        data: {
          product: {
            sellingPlanGroups: {
              nodes: page.nodes.map(renderGroup),
              pageInfo: page.pageInfo,
            },
          },
        },
      });
    }

    if (query.includes("ApsSellingPlanGroupCreate")) {
      return Response.json({
        data: { sellingPlanGroupCreate: { userErrors: [] } },
      });
    }
    if (query.includes("ApsSellingPlanGroupAddPlan")) {
      return Response.json({
        data: { sellingPlanGroupUpdate: { userErrors: [] } },
      });
    }
    if (query.includes("ApsSellingPlanGroupUpdatePlan")) {
      return Response.json({
        data: { sellingPlanGroupUpdate: { userErrors: [] } },
      });
    }
    if (query.includes("ApsSellingPlanGroupDeletePlan")) {
      return Response.json({
        data: { sellingPlanGroupUpdate: { userErrors: [] } },
      });
    }
    if (query.includes("ApsSellingPlanGroupDelete")) {
      return Response.json({
        data: { sellingPlanGroupDelete: { deletedSellingPlanGroupId: "x", userErrors: [] } },
      });
    }
    throw new Error(`Operação não esperada no mock: ${query.slice(0, 80)}`);
  };
  return { graphql, calls };
}

function productWithGroups(id: number, groups: FixtureGroup[], title?: string): FixtureProduct {
  return {
    id: `gid://shopify/Product/${id}`,
    title: title ?? `Produto ${id}`,
    groups,
  };
}

const sampleGroupWithPlans = (): FixtureGroup =>
  ownedGroup("g1", [defaultPlan("1", "Mensal"), defaultPlan("2", "Trimestral")]);

test("loja com 0 produtos retorna lista vazia", async () => {
  const admin = makeAdmin([]);
  const result = await listSubscriptionProducts(admin);
  assert.deepEqual(result, []);
});

test("loja com 5 produtos vinculados mostra os 5", async () => {
  const products = [
    1, 2, 3, 4, 5,
  ].map((n) => productWithGroups(n, [sampleGroupWithPlans()]));
  const admin = makeAdmin(products);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((p) => p.numericId), ["1", "2", "3", "4", "5"]);
});

test("loja com 8 produtos vinculados mostra os 8 (sem teto fixo)", async () => {
  const products = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    productWithGroups(n, [sampleGroupWithPlans()]),
  );
  const admin = makeAdmin(products);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 8);
});

test("loja com mais de 50 produtos vinculados percorre múltiplas páginas de produtos do grupo", async () => {
  const products = Array.from({ length: 120 }, (_, i) =>
    productWithGroups(i + 1, [sampleGroupWithPlans()]),
  );
  const admin = makeAdmin(products);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 120);
  const groupProductPages = admin.calls.filter((c) => c.query.includes("ApsSellingPlanGroupProducts"));
  assert.ok(groupProductPages.length >= 3, `esperava 3 páginas, obteve ${groupProductPages.length}`);
  const catalogPages = admin.calls.filter((c) => c.query.includes("ApsSubscriptionProducts"));
  assert.equal(catalogPages.length, 0, "abertura padrão não deve varrer o catálogo");
});

test("paginação de selling plan groups: produto com mais grupos que a página mantém todos", async () => {
  const groups = Array.from({ length: 25 }, (_, i) => ownedGroup(`g${i + 1}`, [defaultPlan(String(i + 1), `Plano ${i + 1}`)]));
  const admin = makeAdmin([productWithGroups(1, groups)], { groupsPageSize: 20 });
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 1);
  assert.equal(result[0].groups.length, 25);
  assert.equal(result[0].totalSellingPlans, 25);
});

test("paginação dos produtos do grupo avança o cursor nas páginas seguintes", async () => {
  const products = Array.from({ length: 130 }, (_, i) =>
    productWithGroups(i + 1, [sampleGroupWithPlans()]),
  );
  const admin = makeAdmin(products);
  await listSubscriptionProducts(admin);
  const cursors = admin.calls
    .filter((c) => c.query.includes("ApsSellingPlanGroupProducts"))
    .map((c) => c.variables?.cursor);
  assert.deepEqual(cursors, [null, "50", "100"]);
});

test("cursor repetido nos produtos do grupo falha de modo seguro (sem loop infinito)", async () => {
  const products = [1, 2, 3].map((n) => productWithGroups(n, [sampleGroupWithPlans()]));
  const admin = makeAdmin(products, { stuckGroupProductsCursor: true });
  await assert.rejects(
    listSubscriptionProducts(admin),
    /paginação não avançou/,
  );
});

test("produto presente em vários grupos aparece uma única vez", async () => {
  const admin = makeAdmin([
    productWithGroups(1, [
      ownedGroup("a", [defaultPlan("1", "Mensal")]),
      ownedGroup("b", [defaultPlan("2", "Trimestral")]),
    ]),
  ]);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 1);
  assert.equal(result[0].groups.length, 2);
});

test("selling plan duplicado dentro de um grupo não infla a contagem", async () => {
  const duplicates: FixturePlan[] = [
    defaultPlan("1", "Mensal"),
    { id: "gid://shopify/SellingPlan/1", name: "Mensal (clonado)" },
  ];
  const admin = makeAdmin([productWithGroups(1, [ownedGroup("g1", duplicates)])]);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result[0].groups[0].sellingPlans.length, 1);
  assert.equal(result[0].totalSellingPlans, 1);
});

test("contagem de selling plans únicos entre grupos é correta (mesmo plano em dois grupos)", async () => {
  const shared = defaultPlan("7", "Semestral");
  const admin = makeAdmin([
    productWithGroups(1, [
      ownedGroup("a", [defaultPlan("1", "Mensal"), shared]),
      ownedGroup("b", [defaultPlan("2", "Trimestral"), shared]),
    ]),
  ]);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result[0].totalSellingPlans, 3);
  assert.equal(result[0].groups.length, 2);
});

test("produto sem selling plan do app não aparece na lista padrão", async () => {
  const plain = productWithGroups(1, []);
  const admin = makeAdmin([plain]);
  const result = await listSubscriptionProducts(admin);
  assert.deepEqual(result, []);
});

test("grupo de outro app não conta como plano do app", async () => {
  const admin = makeAdmin([
    productWithGroups(1, [foreignGroup("x", [defaultPlan("9", "De outro app")])]),
  ]);
  const result = await listSubscriptionProducts(admin);
  assert.deepEqual(result, []);
});

test("busca funciona sobre o catálogo completo (produto da página 2)", async () => {
  const products = Array.from({ length: 60 }, (_, i) =>
    productWithGroups(i + 1, i === 59 ? [sampleGroupWithPlans()] : [], `Produto Genérico ${i}`),
  );
  products.push(productWithGroups(999, [sampleGroupWithPlans()], "Alvo Especial Busca"));
  const admin = makeAdmin(products);
  const result = await listSubscriptionProducts(admin, "Alvo Especial Busca");
  assert.equal(result.length, 1);
  assert.equal(result[0].numericId, "999");
});

test("busca não retorna produto que não casa (conjunto completo, não só primeira página)", async () => {
  const products = Array.from({ length: 70 }, (_, i) =>
    productWithGroups(i + 1, i === 69 ? [sampleGroupWithPlans()] : [], `Buscável ${i}`),
  );
  const admin = makeAdmin(products);
  const result = await listSubscriptionProducts(admin, "InexistenteXYZ");
  assert.deepEqual(result, []);
});

test("dados de uma loja nunca aparecem em outra (isolamento por admin autenticado)", async () => {
  const adminA = makeAdmin([productWithGroups(1, [sampleGroupWithPlans()])]);
  const adminB = makeAdmin([productWithGroups(2, [sampleGroupWithPlans()])]);
  const [a, b] = await Promise.all([
    listSubscriptionProducts(adminA),
    listSubscriptionProducts(adminB),
  ]);
  assert.deepEqual(a.map((p) => p.numericId), ["1"]);
  assert.deepEqual(b.map((p) => p.numericId), ["2"]);
  assert.equal(a[0]?.title.includes("1"), true);
  assert.equal(b[0]?.title.includes("2"), true);
});

test("handlers de criação de plano continuam funcionando (sem regressão)", async () => {
  const product: SubscriptionProduct = {
    id: "gid://shopify/Product/1",
    numericId: "1",
    title: "Produto 1",
    image: null,
    groups: [],
    badgeSellingPlanId: null,
    totalSellingPlans: 0,
  };
  const admin = makeAdmin([]);
  await createSellingPlan(admin, product, {
    name: "Mensal",
    interval: "MONTH",
    intervalCount: 1,
    discountPercentage: 10,
  });
  assert.ok(admin.calls.some((c) => c.query.includes("ApsSellingPlanGroupCreate")));
});

test("handlers de edição e exclusão de plano continuam funcionando (sem regressão)", async () => {
  const admin = makeAdmin([]);
  const group: SellingPlanGroup = {
    id: "gid://shopify/SellingPlanGroup/g1",
    name: "Grupo 1",
    merchantCode: MERCHANT_CODE,
    appId: APP_ID,
    sellingPlans: [
      {
        id: "gid://shopify/SellingPlan/1",
        name: "Mensal",
        options: [],
        interval: "MONTH",
        intervalCount: 1,
        deliveryInterval: "MONTH",
        deliveryIntervalCount: 1,
        discountPercentage: 0,
      },
      {
        id: "gid://shopify/SellingPlan/2",
        name: "Trimestral",
        options: [],
        interval: "MONTH",
        intervalCount: 3,
        deliveryInterval: "MONTH",
        deliveryIntervalCount: 3,
        discountPercentage: 0,
      },
    ],
  };

  await updateSellingPlan(admin, group.id, "gid://shopify/SellingPlan/1", {
    name: "Mensal v2",
    interval: "MONTH",
    intervalCount: 1,
    discountPercentage: 5,
  });
  assert.ok(admin.calls.some((c) => c.query.includes("ApsSellingPlanGroupUpdatePlan")));

  await deleteSellingPlan(admin, group, "gid://shopify/SellingPlan/1");
  assert.ok(admin.calls.some((c) => c.query.includes("ApsSellingPlanGroupDeletePlan")));
});

test("excluir o último plano exclui o grupo (sem regressão)", async () => {
  const admin = makeAdmin([]);
  const single: SellingPlanGroup = {
    id: "gid://shopify/SellingPlanGroup/g1",
    name: "Grupo 1",
    merchantCode: MERCHANT_CODE,
    appId: APP_ID,
    sellingPlans: [
      {
        id: "gid://shopify/SellingPlan/1",
        name: "Mensal",
        options: [],
        interval: "MONTH",
        intervalCount: 1,
        deliveryInterval: "MONTH",
        deliveryIntervalCount: 1,
        discountPercentage: 0,
      },
    ],
  };
  await deleteSellingPlan(admin, single, "gid://shopify/SellingPlan/1");
  assert.ok(admin.calls.some((c) => c.query.includes("ApsSellingPlanGroupDelete")));
});

test("custo da abertura padrão independe do tamanho do catálogo (500 produtos, 8 assinaturas)", async () => {
  const products = Array.from({ length: 500 }, (_, i) =>
    productWithGroups(i + 1, i < 8 ? [sampleGroupWithPlans()] : [], `Catálogo ${i}`),
  );
  const admin = makeAdmin(products);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 8);
  const catalogListCalls = admin.calls.filter((c) => c.query.includes("ApsSubscriptionProducts"));
  assert.equal(catalogListCalls.length, 0, "catálogo não deve ser listado na abertura");
  const perProductGroupCalls = admin.calls.filter((c) => c.query.includes("ApsProductSellingPlanGroups"));
  assert.equal(perProductGroupCalls.length, 0, "nenhuma consulta por produto na abertura");
  assert.ok(
    admin.calls.length <= 8,
    `checar 500 produtos custou ${admin.calls.length} chamadas; esperado ≤ 8`,
  );
});

test("catálogo com milhares de produtos comuns (1 assinatura) custa poucas chamadas", async () => {
  const products = Array.from({ length: 5000 }, (_, i) =>
    productWithGroups(i + 1, i === 0 ? [sampleGroupWithPlans()] : [], `Genérico ${i}`),
  );
  const admin = makeAdmin(products);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 1);
  assert.ok(admin.calls.length <= 8, `obteve ${admin.calls.length} chamadas para 5000 produtos`);
});

test("paginação de selling plan groups no QueryRoot (mais de 100 grupos)", async () => {
  const groups = Array.from({ length: 140 }, (_, i) =>
    ownedGroup(`g${i + 1}`, [defaultPlan(String(i + 1), `Plano ${i + 1}`)]),
  );
  const admin = makeAdmin([productWithGroups(1, groups)]);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 1);
  assert.equal(result[0].groups.length, 140);
  const rootCursors = admin.calls
    .filter((c) => c.query.includes("ApsRootSellingPlanGroups"))
    .map((c) => c.variables?.cursor);
  assert.deepEqual(rootCursors, [null, "100"]);
});

test("selling plans por grupo paginados (mais de 100 planos)", async () => {
  const plans = Array.from({ length: 130 }, (_, i) => defaultPlan(String(i + 1), `Plano ${i + 1}`));
  const admin = makeAdmin([productWithGroups(1, [ownedGroup("g1", plans)])]);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 1);
  assert.equal(result[0].groups[0].sellingPlans.length, 130);
  assert.equal(result[0].totalSellingPlans, 130);
  const planCursors = admin.calls
    .filter((c) => c.query.includes("ApsGroupSellingPlans"))
    .map((c) => c.variables?.cursor);
  assert.deepEqual(planCursors, [null, "100"]);
});

test("cursor repetido no QueryRoot falha de modo seguro", async () => {
  const products = Array.from({ length: 150 }, (_, i) =>
    productWithGroups(i + 1, [ownedGroup("g1", [defaultPlan("1", "Mensal")])]),
  );
  const admin = makeAdmin(products, { stuckRootGroupsCursor: true });
  await assert.rejects(
    listSubscriptionProducts(admin),
    /paginação não avançou/,
  );
});

test("lista padrão é ordenada por título (pt-BR)", async () => {
  const admin = makeAdmin([
    productWithGroups(3, [sampleGroupWithPlans()], "Beta"),
    productWithGroups(1, [sampleGroupWithPlans()], "Água"),
    productWithGroups(2, [sampleGroupWithPlans()], "alumina"),
    productWithGroups(4, [sampleGroupWithPlans()], "Zebra"),
  ]);
  const result = await listSubscriptionProducts(admin);
  assert.deepEqual(result.map((p) => p.numericId), ["1", "2", "3", "4"]);
});

test("lista padrão não inclui produto sem plano mesmo com catálogo grande", async () => {
  const products = Array.from({ length: 300 }, (_, i) =>
    productWithGroups(i + 1, [], `Comum ${i}`),
  );
  const admin = makeAdmin(products);
  const result = await listSubscriptionProducts(admin);
  assert.deepEqual(result, []);
  assert.equal(admin.calls.length, 1, "só a página raiz de grupos é consultada");
});

test("abertura padrão consulta grupos raiz, não produtos", async () => {
  const admin = makeAdmin([productWithGroups(1, [sampleGroupWithPlans()])]);
  await listSubscriptionProducts(admin);
  const operationNames = admin.calls.map((c) => {
    if (c.query.includes("ApsRootSellingPlanGroups")) return "root";
    if (c.query.includes("ApsSellingPlanGroupProducts")) return "group-products";
    if (c.query.includes("ApsGroupSellingPlans")) return "group-plans";
    return c.query.slice(0, 40);
  });
  assert.deepEqual(operationNames, ["root", "group-plans", "group-products"]);
  assert.ok(admin.calls.every((c) => !c.query.includes("ApsSubscriptionProducts")));
});

test("busca retorna produto ainda sem plano (continua adicionável ao gerenciador)", async () => {
  const admin = makeAdmin([
    productWithGroups(1, [sampleGroupWithPlans()], "Produto Com Plano"),
    productWithGroups(2, [], "Novo Sem Plano"),
  ]);
  const result = await listSubscriptionProducts(admin, "Sem Plano");
  assert.equal(result.length, 1);
  assert.equal(result[0].numericId, "2");
  assert.deepEqual(result[0].groups, []);
  assert.equal(result[0].totalSellingPlans, 0);
});

test("erro HTTP (429) propaga sem retry descontrolado", async () => {
  const products = [1, 2, 3].map((n) => productWithGroups(n, [sampleGroupWithPlans()]));
  const admin = makeAdmin(products, { failRootGroups: true });
  await assert.rejects(
    listSubscriptionProducts(admin),
    /A Shopify não conseguiu processar a solicitação/,
  );
  const rootCalls = admin.calls.filter((c) => c.query.includes("ApsRootSellingPlanGroups"));
  assert.equal(rootCalls.length, 1, "não deve repetir a chamada que falhou");
});

test("grupo atualizado depois da coleta inicial não escapa do dedupe por produto", async () => {
  const shared: FixturePlan[] = [defaultPlan("1", "Mensal"), { id: "gid://shopify/SellingPlan/1", name: "Mensal (refetch)" }];
  const admin = makeAdmin([
    productWithGroups(1, [ownedGroup("a", shared)]),
    productWithGroups(2, [ownedGroup("a", shared)]),
  ]);
  const result = await listSubscriptionProducts(admin);
  assert.equal(result.length, 2);
  for (const product of result) {
    assert.equal(product.groups[0].sellingPlans.length, 1, "plano duplicado no grupo é deduplicado");
    assert.equal(product.totalSellingPlans, 1);
  }
});
