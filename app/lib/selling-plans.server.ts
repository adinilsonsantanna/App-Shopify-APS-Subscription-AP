const APS_MERCHANT_CODE = "aps-subscription";

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
  sellingPlanGroups: { nodes: RawGroup[] };
};

type ProductsQuery = {
  currentAppInstallation: { app: { id: string } };
  products: { nodes: RawProduct[] };
};

type ProductQuery = {
  currentAppInstallation: { app: { id: string } };
  product: RawProduct | null;
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
  return {
    id: group.id,
    name: group.name,
    merchantCode: group.merchantCode,
    appId: group.appId ?? null,
    sellingPlans: group.sellingPlans.nodes.map(mapPlan),
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

export async function listSubscriptionProducts(
  admin: AdminGraphqlClient,
  search = "",
): Promise<SubscriptionProduct[]> {
  const data = await executeGraphql<ProductsQuery>(admin, "ListProducts", `#graphql
    ${PLAN_FIELDS}
    query ApsSubscriptionProducts($query: String) {
      currentAppInstallation { app { id } }
      products(first: 25, sortKey: TITLE, query: $query) {
        nodes {
          id
          title
          featuredMedia { preview { image { url altText } } }
          sellingPlanGroups(first: 2) {
            nodes {
              id name merchantCode appId
              sellingPlans(first: 10) { nodes { ...ApsSellingPlanFields } }
            }
          }
        }
      }
    }
  `, { query: search || null });

  const appId = data.currentAppInstallation.app.id as string;
  return data.products.nodes
    .map((product): SubscriptionProduct => {
      const groups = product.sellingPlanGroups.nodes
        .filter((group) => isOwnedApsGroup(group, appId))
        .map(mapGroup);
      return {
        id: product.id,
        numericId: product.id.split("/").pop()!,
        title: product.title,
        image: product.featuredMedia?.preview?.image ?? null,
        groups,
      };
    })
    .filter((product: SubscriptionProduct) => search.length > 0 ||
      product.title.toLocaleLowerCase("pt-BR").includes("assinatura") || product.groups.length > 0,
    );
}

export async function getSubscriptionProduct(admin: AdminGraphqlClient, productId: string): Promise<SubscriptionProduct> {
  const data = await executeGraphql<ProductQuery>(admin, "GetProductSellingPlans", `#graphql
    ${PLAN_FIELDS}
    query ApsProductSellingPlans($id: ID!) {
      currentAppInstallation { app { id } }
      product(id: $id) {
        id title
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
  const groups = data.product.sellingPlanGroups.nodes
    .filter((group) => isOwnedApsGroup(group, appId))
    .map(mapGroup);
  return {
    id: data.product.id,
    numericId: data.product.id.split("/").pop(),
    title: data.product.title,
    image: data.product.featuredMedia?.preview?.image ?? null,
    groups,
  } as SubscriptionProduct;
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
