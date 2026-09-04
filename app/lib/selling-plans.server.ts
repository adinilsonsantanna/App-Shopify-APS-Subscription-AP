const APS_MERCHANT_CODE = "aps-subscription";

// Tamanhos de página e proteções defensivas. São limites técnicos de chunk,
// NÃO limites de resultado: a paginação percorre todas as páginas até esgotar.
const PRODUCTS_PAGE_SIZE = 50;
const GROUPS_PAGE_SIZE = 20;
const PLANS_PAGE_SIZE = 50;
// Proteção contra loop infinito em caso de cursor que nunca avança ou resposta
// malformada da API. Documentado como salvaguarda, não como teto de resultado.
const MAX_PAGES = 1_000;
const BADGE_METAFIELD_NAMESPACE = "aps_subscription";
const BADGE_METAFIELD_KEY = "badge_selling_plan_id";

type AdminGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message: string; path?: Array<string | number> }>;
};

type UserError = { field?: string[]; message: string };

type RawPlan = {
  id: string;
  name: string;
  options?: string[];
  billingPolicy: { interval: SellingPlan["interval"]; intervalCount: number };
  deliveryPolicy: { interval: SellingPlan["interval"]; intervalCount: number };
  pricingPolicies?: Array<{
    adjustmentType?: string;
    adjustmentValue?: { percentage?: number };
  }>;
};

type RawGroup = {
  id: string;
  name: string;
  merchantCode: string;
  appId?: string | null;
  sellingPlans: { nodes: RawPlan[] };
};

type RawProduct = {
  id: string;
  title: string;
  featuredMedia?: { preview?: { image?: { url: string; altText: string | null } | null } | null } | null;
  sellingPlanGroups?: { nodes: RawGroup[] };
  badgeSellingPlan?: { value: string } | null;
};

type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type ProductsPage = {
  currentAppInstallation: { app: { id: string } };
  products: { nodes: RawProduct[]; pageInfo: PageInfo };
};

type ProductQuery = {
  currentAppInstallation: { app: { id: string } };
  product: RawProduct | null;
};

type ProductGroupsPage = {
  product: {
    sellingPlanGroups: { nodes: RawGroup[]; pageInfo: PageInfo };
  } | null;
};

type MutationResult = {
  sellingPlanGroupCreate: { userErrors: UserError[] };
  sellingPlanGroupUpdate: { userErrors: UserError[] };
};

type DeleteGroupResult = {
  sellingPlanGroupDelete: {
    deletedSellingPlanGroupId: string | null;
    userErrors: UserError[];
  };
};

type MetafieldsSetResult = {
  metafieldsSet: { userErrors: UserError[] };
};

type MetafieldsDeleteResult = {
  metafieldsDelete: { userErrors: UserError[] };
};

export type SellingPlan = {
  id: string;
  name: string;
  options: string[];
  interval: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
  deliveryInterval: "DAY" | "WEEK" | "MONTH" | "YEAR";
  deliveryIntervalCount: number;
  discountPercentage: number;
};

export type SellingPlanGroup = {
  id: string;
  name: string;
  merchantCode: string;
  appId: string | null;
  sellingPlans: SellingPlan[];
};

export type SubscriptionProduct = {
  id: string;
  numericId: string;
  title: string;
  image: { url: string; altText: string | null } | null;
  groups: SellingPlanGroup[];
  badgeSellingPlanId: string | null;
  totalSellingPlans: number;
};

const PLAN_FIELDS = `#graphql
  fragment ApsSellingPlanFields on SellingPlan {
    id
    name
    options
    billingPolicy {
      ... on SellingPlanRecurringBillingPolicy { interval intervalCount }
    }
    deliveryPolicy {
      ... on SellingPlanRecurringDeliveryPolicy { interval intervalCount }
    }
    pricingPolicies {
      ... on SellingPlanFixedPricingPolicy {
        adjustmentType
        adjustmentValue {
          ... on SellingPlanPricingPolicyPercentageValue { percentage }
        }
      }
    }
  }
`;

async function executeGraphql<T>(
  admin: AdminGraphqlClient,
  operationName: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  if (!response.ok) {
    const body = await response.text();
    console.error(`[Selling Plans] ${operationName} HTTP ${response.status}:`, body);
    throw new Error("A Shopify não conseguiu processar a solicitação.");
  }

  const payload = (await response.json()) as GraphqlEnvelope<T>;
  if (payload.errors?.length) {
    console.error(`[Selling Plans] ${operationName} GraphQL errors:`, payload.errors);
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  if (!payload.data) {
    console.error(`[Selling Plans] ${operationName} sem data:`, payload);
    throw new Error("A Shopify retornou uma resposta inesperada.");
  }
  return payload.data;
}

function assertNoUserErrors(operationName: string, userErrors: UserError[]) {
  if (!userErrors.length) return;
  console.error(`[Selling Plans] ${operationName} userErrors:`, userErrors);
  throw new Error(userErrors.map((error) => error.message).join("; "));
}

function mapPlan(plan: RawPlan): SellingPlan {
  const fixedPolicy = plan.pricingPolicies?.find(
    (policy) => policy.adjustmentType === "PERCENTAGE",
  );
  return {
    id: plan.id,
    name: plan.name,
    options: plan.options ?? [],
    interval: plan.billingPolicy.interval,
    intervalCount: plan.billingPolicy.intervalCount,
    deliveryInterval: plan.deliveryPolicy.interval,
    deliveryIntervalCount: plan.deliveryPolicy.intervalCount,
    discountPercentage: fixedPolicy?.adjustmentValue?.percentage ?? 0,
  };
}

function mapGroup(group: RawGroup): SellingPlanGroup {
  const seenPlans = new Set<string>();
  const sellingPlans = group.sellingPlans.nodes
    .filter((plan) => {
      if (seenPlans.has(plan.id)) return false;
      seenPlans.add(plan.id);
      return true;
    })
    .map(mapPlan);
  return {
    id: group.id,
    name: group.name,
    merchantCode: group.merchantCode,
    appId: group.appId ?? null,
    sellingPlans,
  };
}

function normalizeShopifyId(id: string | null | undefined) {
  return id?.split("/").pop() ?? null;
}

function isOwnedApsGroup(group: RawGroup, currentAppId: string) {
  return (
    group.merchantCode === APS_MERCHANT_CODE &&
    (!group.appId ||
      normalizeShopifyId(group.appId) === normalizeShopifyId(currentAppId))
  );
}

function assertCursorAdvanced(operation: string, cursor: string | null, endCursor: string | null) {
  if (!endCursor || endCursor === cursor) {
    throw new Error(
      `[Selling Plans] ${operation}: paginação não avançou; encerrando para evitar loop infinito.`,
    );
  }
}

async function collectOwnedGroups(
  admin: AdminGraphqlClient,
  productId: string,
  appId: string,
): Promise<SellingPlanGroup[]> {
  const groups: SellingPlanGroup[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: ProductGroupsPage = await executeGraphql<ProductGroupsPage>(admin, "ListProductGroups", `#graphql
      ${PLAN_FIELDS}
      query ApsProductSellingPlanGroups($id: ID!, $cursor: String) {
        product(id: $id) {
          sellingPlanGroups(first: ${GROUPS_PAGE_SIZE}, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id name merchantCode appId
              sellingPlans(first: ${PLANS_PAGE_SIZE}) { nodes { ...ApsSellingPlanFields } }
            }
          }
        }
      }
    `, { id: productId, cursor });

    if (!data.product) break;
    for (const group of data.product.sellingPlanGroups.nodes) {
      if (isOwnedApsGroup(group, appId)) groups.push(mapGroup(group));
    }
    if (!data.product.sellingPlanGroups.pageInfo.hasNextPage) break;
    const endCursor: string | null = data.product.sellingPlanGroups.pageInfo.endCursor;
    assertCursorAdvanced("ListProductGroups", cursor, endCursor);
    cursor = endCursor;
  }
  return groups;
}

export async function listSubscriptionProducts(
  admin: AdminGraphqlClient,
  search = "",
): Promise<SubscriptionProduct[]> {
  const products: SubscriptionProduct[] = [];
  let appId: string | null = null;
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: ProductsPage = await executeGraphql<ProductsPage>(admin, "ListProducts", `#graphql
      query ApsSubscriptionProducts($query: String, $cursor: String) {
        currentAppInstallation { app { id } }
        products(first: ${PRODUCTS_PAGE_SIZE}, after: $cursor, sortKey: TITLE, query: $query) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            featuredMedia { preview { image { url altText } } }
          }
        }
      }
    `, { query: search || null, cursor });

    appId = data.currentAppInstallation.app.id as string;

    for (const raw of data.products.nodes) {
      const groups = await collectOwnedGroups(admin, raw.id, appId);
      // Lista padrão (sem busca): apenas produtos realmente vinculados a
      // Selling Plans gerenciados pelo app. Busca explícita varre o catálogo
      // inteiro para permitir adicionar um produto ao gerenciador.
      if (search.length === 0 && groups.length === 0) continue;
      const planIds = new Set<string>();
      for (const group of groups) {
        for (const plan of group.sellingPlans) planIds.add(plan.id);
      }
      products.push({
        id: raw.id,
        numericId: raw.id.split("/").pop()!,
        title: raw.title,
        image: raw.featuredMedia?.preview?.image ?? null,
        groups,
        badgeSellingPlanId: null,
        totalSellingPlans: planIds.size,
      });
    }

    if (!data.products.pageInfo.hasNextPage) break;
    const endCursor: string | null = data.products.pageInfo.endCursor;
    assertCursorAdvanced("ListProducts", cursor, endCursor);
    cursor = endCursor;
  }

  return products;
}

export async function getSubscriptionProduct(admin: AdminGraphqlClient, productId: string): Promise<SubscriptionProduct> {
  const data = await executeGraphql<ProductQuery>(admin, "GetProductSellingPlans", `#graphql
    ${PLAN_FIELDS}
    query ApsProductSellingPlans($id: ID!) {
      currentAppInstallation { app { id } }
      product(id: $id) {
        id title
        badgeSellingPlan: metafield(
          namespace: "aps_subscription"
          key: "badge_selling_plan_id"
        ) { value }
        featuredMedia { preview { image { url altText } } }
        sellingPlanGroups(first: 10) {
          nodes {
            id name merchantCode appId
            sellingPlans(first: 50) { nodes { ...ApsSellingPlanFields } }
          }
        }
      }
    }
  `, { id: productId });
  if (!data.product) throw new Error("Produto não encontrado na Shopify.");
  const appId = data.currentAppInstallation.app.id;
  const groups = (data.product.sellingPlanGroups?.nodes ?? [])
    .filter((group) => isOwnedApsGroup(group, appId))
    .map(mapGroup);
  const totalSellingPlans = new Set(
    groups.flatMap((group) => group.sellingPlans.map((plan) => plan.id)),
  ).size;
  return {
    id: data.product.id,
    numericId: data.product.id.split("/").pop(),
    title: data.product.title,
    image: data.product.featuredMedia?.preview?.image ?? null,
    groups,
    badgeSellingPlanId: data.product.badgeSellingPlan?.value ?? null,
    totalSellingPlans,
  } as SubscriptionProduct;
}

async function deleteBadgeSellingPlanMetafield(
  admin: AdminGraphqlClient,
  productId: string,
) {
  const data = await executeGraphql<MetafieldsDeleteResult>(admin, "DeleteBadgeSellingPlanMetafield", `#graphql
    mutation DeleteBadgeSellingPlanMetafield($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { key namespace ownerId }
        userErrors { field message }
      }
    }
  `, {
    metafields: [{
      ownerId: productId,
      namespace: BADGE_METAFIELD_NAMESPACE,
      key: BADGE_METAFIELD_KEY,
    }],
  });
  assertNoUserErrors("DeleteBadgeSellingPlanMetafield", data.metafieldsDelete.userErrors);
}

export async function setBadgeSellingPlanId(
  admin: AdminGraphqlClient,
  productId: string,
  sellingPlanId: string | null,
) {
  if (!sellingPlanId) {
    await deleteBadgeSellingPlanMetafield(admin, productId);
    return;
  }

  const product = await getSubscriptionProduct(admin, productId);
  const numericSellingPlanId = normalizeShopifyId(sellingPlanId);
  const belongsToProduct = product.groups.some((group) =>
    group.sellingPlans.some((plan) => plan.id === sellingPlanId),
  );
  if (!numericSellingPlanId || !/^\d+$/.test(numericSellingPlanId) || !belongsToProduct) {
    throw new Error("O plano não pertence a um grupo APS deste produto.");
  }

  const data = await executeGraphql<MetafieldsSetResult>(admin, "SetBadgeSellingPlanMetafield", `#graphql
    mutation SetBadgeSellingPlanMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors { field message }
      }
    }
  `, {
    metafields: [{
      ownerId: productId,
      namespace: BADGE_METAFIELD_NAMESPACE,
      key: BADGE_METAFIELD_KEY,
      type: "single_line_text_field",
      value: numericSellingPlanId,
    }],
  });
  assertNoUserErrors("SetBadgeSellingPlanMetafield", data.metafieldsSet.userErrors);
}

export async function clearBadgeSellingPlanIfSelected(
  admin: AdminGraphqlClient,
  product: SubscriptionProduct,
  sellingPlanId: string,
) {
  if (product.badgeSellingPlanId === normalizeShopifyId(sellingPlanId)) {
    await deleteBadgeSellingPlanMetafield(admin, product.id);
  }
}

function planInput(input: { name: string; interval: string; intervalCount: number; discountPercentage: number }) {
  return {
    name: input.name,
    options: [input.name],
    category: "SUBSCRIPTION",
    billingPolicy: { recurring: { interval: input.interval, intervalCount: input.intervalCount } },
    deliveryPolicy: { recurring: { interval: input.interval, intervalCount: input.intervalCount } },
    pricingPolicies: [{
      fixed: {
        adjustmentType: "PERCENTAGE",
        adjustmentValue: { percentage: input.discountPercentage },
      },
    }],
  };
}

export async function createSellingPlan(
  admin: AdminGraphqlClient,
  product: SubscriptionProduct,
  input: { name: string; interval: string; intervalCount: number; discountPercentage: number },
) {
  const group = product.groups[0];
  if (!group) {
    const data = await executeGraphql<MutationResult>(admin, "SellingPlanGroupCreate", `#graphql
      mutation ApsSellingPlanGroupCreate($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput!) {
        sellingPlanGroupCreate(input: $input, resources: $resources) {
          sellingPlanGroup { id }
          userErrors { field message }
        }
      }
    `, {
      input: {
        name: "Assinatura",
        merchantCode: APS_MERCHANT_CODE,
        options: ["Frequência"],
        sellingPlansToCreate: [planInput(input)],
      },
      resources: { productIds: [product.id] },
    });
    assertNoUserErrors("SellingPlanGroupCreate", data.sellingPlanGroupCreate.userErrors);
    return;
  }

  const data = await executeGraphql<MutationResult>(admin, "SellingPlanGroupAddPlan", `#graphql
    mutation ApsSellingPlanGroupAddPlan($id: ID!, $input: SellingPlanGroupInput!) {
      sellingPlanGroupUpdate(id: $id, input: $input) {
        sellingPlanGroup { id }
        userErrors { field message }
      }
    }
  `, { id: group.id, input: { sellingPlansToCreate: [planInput(input)] } });
  assertNoUserErrors("SellingPlanGroupAddPlan", data.sellingPlanGroupUpdate.userErrors);
}

export async function updateSellingPlan(
  admin: AdminGraphqlClient,
  groupId: string,
  sellingPlanId: string,
  input: { name: string; interval: string; intervalCount: number; discountPercentage: number },
) {
  const data = await executeGraphql<MutationResult>(admin, "SellingPlanGroupUpdatePlan", `#graphql
    mutation ApsSellingPlanGroupUpdatePlan($id: ID!, $input: SellingPlanGroupInput!) {
      sellingPlanGroupUpdate(id: $id, input: $input) {
        sellingPlanGroup { id }
        userErrors { field message }
      }
    }
  `, { id: groupId, input: { sellingPlansToUpdate: [{ id: sellingPlanId, ...planInput(input) }] } });
  assertNoUserErrors("SellingPlanGroupUpdatePlan", data.sellingPlanGroupUpdate.userErrors);
}

export async function deleteSellingPlan(
  admin: AdminGraphqlClient,
  group: SellingPlanGroup,
  sellingPlanId: string,
) {
  if (group.sellingPlans.length === 1) {
    const data = await executeGraphql<DeleteGroupResult>(admin, "SellingPlanGroupDelete", `#graphql
      mutation ApsSellingPlanGroupDelete($id: ID!) {
        sellingPlanGroupDelete(id: $id) {
          deletedSellingPlanGroupId
          userErrors { field message }
        }
      }
    `, { id: group.id });
    assertNoUserErrors("SellingPlanGroupDelete", data.sellingPlanGroupDelete.userErrors);
    return;
  }

  const data = await executeGraphql<MutationResult>(admin, "SellingPlanGroupDeletePlan", `#graphql
    mutation ApsSellingPlanGroupDeletePlan($id: ID!, $input: SellingPlanGroupInput!) {
      sellingPlanGroupUpdate(id: $id, input: $input) {
        sellingPlanGroup { id }
        userErrors { field message }
      }
    }
  `, { id: group.id, input: { sellingPlansToDelete: [sellingPlanId] } });
  assertNoUserErrors("SellingPlanGroupDeletePlan", data.sellingPlanGroupUpdate.userErrors);
}
