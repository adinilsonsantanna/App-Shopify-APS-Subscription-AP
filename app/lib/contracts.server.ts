type AdminGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type UserError = { field?: string[]; message: string };

type RawContract = {
  id: string;
  status: string;
  nextBillingDate: string | null;
  createdAt: string;
  updatedAt?: string;
  customer: {
    displayName: string;
    defaultEmailAddress?: { emailAddress: string } | null;
  } | null;
  billingPolicy: { interval: string; intervalCount: number };
  lines: {
    nodes: Array<{
      title: string;
      quantity: number;
      currentPrice: { amount: string; currencyCode: string };
    }>;
  };
};

export type ContractSummary = {
  id: string;
  numericId: string;
  status: string;
  nextBillingDate: string | null;
  createdAt: string;
  updatedAt?: string;
  customerName: string;
  customerEmail: string;
  interval: string;
  intervalCount: number;
  products: string[];
  price: number;
  currencyCode: string;
};

const CONTRACT_FIELDS = `#graphql
  fragment ApsContractFields on SubscriptionContract {
    id
    status
    nextBillingDate
    createdAt
    updatedAt
    customer {
      displayName
      defaultEmailAddress { emailAddress }
    }
    billingPolicy { interval intervalCount }
    lines(first: 20) {
      nodes {
        title
        quantity
        currentPrice { amount currencyCode }
      }
    }
  }
`;

async function execute<T>(
  admin: AdminGraphqlClient,
  name: string,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await admin.graphql(query, { variables });
  if (!response.ok) {
    console.error(`[Contracts] ${name} HTTP ${response.status}:`, await response.text());
    throw new Error("A Shopify não conseguiu processar a solicitação.");
  }
  const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length || !payload.data) {
    console.error(`[Contracts] ${name} GraphQL errors:`, payload.errors);
    throw new Error(payload.errors?.map((error) => error.message).join("; ") || "Resposta inválida da Shopify.");
  }
  return payload.data;
}

function assertNoUserErrors(name: string, errors: UserError[]) {
  if (!errors.length) return;
  console.error(`[Contracts] ${name} userErrors:`, errors);
  throw new Error(errors.map((error) => error.message).join("; "));
}

function mapContract(contract: RawContract): ContractSummary {
  const firstLine = contract.lines.nodes[0];
  return {
    id: contract.id,
    numericId: contract.id.split("/").pop()!,
    status: contract.status,
    nextBillingDate: contract.nextBillingDate,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    customerName: contract.customer?.displayName || "Cliente não informado",
    customerEmail: contract.customer?.defaultEmailAddress?.emailAddress || "",
    interval: contract.billingPolicy.interval,
    intervalCount: contract.billingPolicy.intervalCount,
    products: contract.lines.nodes.map((line) => line.title),
    price: contract.lines.nodes.reduce(
      (total, line) => total + Number(line.currentPrice.amount) * line.quantity,
      0,
    ),
    currencyCode: firstLine?.currentPrice.currencyCode ?? "BRL",
  };
}

export async function listContracts(admin: AdminGraphqlClient) {
  const contracts: ContractSummary[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage && page < 10) {
    const data: {
      subscriptionContracts: {
        nodes: RawContract[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await execute(admin, "ListContracts", `#graphql
      ${CONTRACT_FIELDS}
      query ApsContracts($after: String) {
        subscriptionContracts(first: 50, after: $after, reverse: true) {
          nodes { ...ApsContractFields }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { after: cursor });
    contracts.push(...data.subscriptionContracts.nodes.map(mapContract));
    hasNextPage = data.subscriptionContracts.pageInfo.hasNextPage;
    cursor = data.subscriptionContracts.pageInfo.endCursor;
    page += 1;
  }
  return contracts;
}

export async function getContract(admin: AdminGraphqlClient, id: string) {
  const data = await execute<{ subscriptionContract: RawContract | null }>(
    admin,
    "GetContract",
    `#graphql
      ${CONTRACT_FIELDS}
      query ApsContract($id: ID!) {
        subscriptionContract(id: $id) { ...ApsContractFields }
      }
    `,
    { id },
  );
  if (!data.subscriptionContract) throw new Error("Contrato não encontrado na Shopify.");
  return mapContract(data.subscriptionContract);
}

export async function updateContractStatus(
  admin: AdminGraphqlClient,
  id: string,
  intent: "activate" | "pause" | "cancel",
) {
  const operations = {
    activate: {
      field: "subscriptionContractActivate",
      operation: "Activate",
    },
    pause: {
      field: "subscriptionContractPause",
      operation: "Pause",
    },
    cancel: {
      field: "subscriptionContractCancel",
      operation: "Cancel",
    },
  } as const;
  const selected = operations[intent];
  const data = await execute<Record<string, { userErrors: UserError[] }>>(
    admin,
    `Contract${selected.operation}`,
    `#graphql
      mutation ApsContract${selected.operation}($id: ID!) {
        ${selected.field}(subscriptionContractId: $id) {
          contract { id status }
          userErrors { field message }
        }
      }
    `,
    { id },
  );
  assertNoUserErrors(`Contract${selected.operation}`, data[selected.field].userErrors);
}
