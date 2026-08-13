type AdminGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type Money = { amount: string; currencyCode: string };
type SubscriptionOrder = { createdAt: string; totalPriceSet: { shopMoney: Money } };
type SubscriptionContract = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  currencyCode: string;
  orders: { nodes: SubscriptionOrder[] };
};

type ContractsResponse = {
  data?: {
    subscriptionContracts: {
      nodes: SubscriptionContract[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  errors?: Array<{ message: string }>;
};

export type DashboardMetrics = {
  days: number;
  from: string;
  to: string;
  currencyCode: string;
  revenue: number;
  activeSubscriptions: number;
  newSubscriptions: number;
  cancelledSubscriptions: number;
};

const DASHBOARD_QUERY = `#graphql
  query ApsSubscriptionDashboard($after: String) {
    subscriptionContracts(first: 25, after: $after) {
      nodes {
        id
        status
        createdAt
        updatedAt
        currencyCode
        orders(first: 25, reverse: true) {
          nodes {
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function getDashboardMetrics(
  admin: AdminGraphqlClient,
  days: number,
): Promise<DashboardMetrics> {
  const contracts: SubscriptionContract[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage && page < 20) {
    const response = await admin.graphql(DASHBOARD_QUERY, {
      variables: { after: cursor },
    });
    if (!response.ok) {
      console.error("[Dashboard] Shopify HTTP error:", response.status, await response.text());
      throw new Error("Não foi possível carregar os indicadores da Shopify.");
    }

    const payload = (await response.json()) as ContractsResponse;
    if (payload.errors?.length || !payload.data) {
      console.error("[Dashboard] Shopify GraphQL errors:", payload.errors);
      throw new Error(payload.errors?.map((error) => error.message).join("; ") || "Resposta inválida da Shopify.");
    }

    const connection = payload.data.subscriptionContracts;
    contracts.push(...connection.nodes);
    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
    page += 1;
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  const fromTime = from.getTime();

  const orders = contracts.flatMap((contract) => contract.orders.nodes);
  const periodOrders = orders.filter((order) => new Date(order.createdAt).getTime() >= fromTime);
  const currencyCode = periodOrders[0]?.totalPriceSet.shopMoney.currencyCode
    ?? contracts[0]?.currencyCode
    ?? "BRL";

  return {
    days,
    from: from.toISOString(),
    to: to.toISOString(),
    currencyCode,
    revenue: periodOrders.reduce(
      (total, order) => total + Number(order.totalPriceSet.shopMoney.amount),
      0,
    ),
    activeSubscriptions: contracts.filter((contract) => contract.status === "ACTIVE").length,
    newSubscriptions: contracts.filter(
      (contract) => new Date(contract.createdAt).getTime() >= fromTime,
    ).length,
    cancelledSubscriptions: contracts.filter(
      (contract) =>
        contract.status === "CANCELLED" &&
        new Date(contract.updatedAt).getTime() >= fromTime,
    ).length,
  };
}
