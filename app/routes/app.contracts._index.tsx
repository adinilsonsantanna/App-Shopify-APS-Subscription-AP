import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listContracts } from "../lib/contracts.server";

const statusLabels: Record<string, string> = {
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  CANCELLED: "Cancelado",
  EXPIRED: "Expirado",
  FAILED: "Falhou",
};

function statusTone(status: string): "success" | "warning" | "critical" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "PAUSED") return "warning";
  if (status === "FAILED") return "critical";
  return "neutral";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function frequency(interval: string, count: number) {
  const names: Record<string, [string, string]> = {
    DAY: ["dia", "dias"], WEEK: ["semana", "semanas"], MONTH: ["mês", "meses"], YEAR: ["ano", "anos"],
  };
  const label = names[interval] ?? [interval.toLowerCase(), interval.toLowerCase()];
  return count === 1 ? `Todo ${label[0]}` : `A cada ${count} ${label[1]}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "ACTIVE";
  const search = (url.searchParams.get("search") || "").trim().toLocaleLowerCase("pt-BR");
  const contracts = await listContracts(admin);
  return {
    status,
    search,
    contracts: contracts.filter((contract) => {
      const matchesStatus = status === "ALL" || contract.status === status;
      const haystack = `${contract.numericId} ${contract.customerName} ${contract.customerEmail} ${contract.products.join(" ")}`.toLocaleLowerCase("pt-BR");
      return matchesStatus && (!search || haystack.includes(search));
    }),
  };
};

export default function ContractsIndex() {
  const { contracts, status, search } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Contratos de assinatura">
      <s-section>
        <Form method="get">
          <s-grid gridTemplateColumns="180px minmax(260px, 1fr) auto" gap="base" alignItems="end">
            <s-select label="Status" name="status" value={status}>
              <s-option value="ACTIVE">Ativos</s-option><s-option value="ALL">Todos</s-option>
              <s-option value="PAUSED">Pausados</s-option><s-option value="CANCELLED">Cancelados</s-option>
            </s-select>
            <s-search-field label="Pesquisar contratos" name="search" value={search} placeholder="Nome, e-mail, produto ou contrato" />
            <s-button type="submit">Pesquisar</s-button>
          </s-grid>
        </Form>
      </s-section>

      <s-section heading={`${contracts.length} contrato(s)`}>
        {contracts.length === 0 ? <s-banner heading="Nenhum contrato encontrado" tone="info">Ajuste os filtros ou aguarde a criação de novas assinaturas.</s-banner> : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Contrato</s-table-header><s-table-header>Cliente</s-table-header>
              <s-table-header>Produto</s-table-header><s-table-header format="currency">Preço</s-table-header>
              <s-table-header>Frequência</s-table-header><s-table-header>Próxima cobrança</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {contracts.map((contract) => (
                <s-table-row key={contract.id}>
                  <s-table-cell><s-link href={`/app/contracts/${contract.numericId}`}>{contract.numericId}</s-link></s-table-cell>
                  <s-table-cell><s-stack direction="block" gap="small"><s-text>{contract.customerName}</s-text><s-text color="subdued">{contract.customerEmail}</s-text></s-stack></s-table-cell>
                  <s-table-cell>{contract.products.join(", ")}</s-table-cell>
                  <s-table-cell>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: contract.currencyCode }).format(contract.price)}</s-table-cell>
                  <s-table-cell>{frequency(contract.interval, contract.intervalCount)}</s-table-cell>
                  <s-table-cell>{formatDate(contract.nextBillingDate)}</s-table-cell>
                  <s-table-cell><s-badge tone={statusTone(contract.status)}>{statusLabels[contract.status] ?? contract.status}</s-badge></s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
