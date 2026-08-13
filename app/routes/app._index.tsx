import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getDashboardMetrics } from "../lib/dashboard.server";

const ranges = [7, 30, 60, 90] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const requestedDays = Number(new URL(request.url).searchParams.get("days"));
  const days = ranges.includes(requestedDays as typeof ranges[number]) ? requestedDays : 7;

  try {
    return { metrics: await getDashboardMetrics(admin, days), error: null };
  } catch (error) {
    console.error("[Dashboard] Falha ao carregar métricas:", error);
    return {
      metrics: {
        days,
        from: new Date(Date.now() - days * 86400000).toISOString(),
        to: new Date().toISOString(),
        currencyCode: "BRL",
        revenue: 0,
        activeSubscriptions: 0,
        newSubscriptions: 0,
        cancelledSubscriptions: 0,
      },
      error: error instanceof Error ? error.message : "Não foi possível carregar os indicadores.",
    };
  }
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack direction="block" gap="small">
        <s-text>{label}</s-text>
        <s-heading>{value}</s-heading>
        <s-text color="subdued">{detail}</s-text>
      </s-stack>
    </s-box>
  );
}

export default function Dashboard() {
  const { metrics, error } = useLoaderData<typeof loader>();
  const installFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (installFetcher.state === "idle" && !installFetcher.data) {
      installFetcher.submit(null, { method: "POST", action: "/api/install" });
    }
  }, [installFetcher]);

  useEffect(() => {
    if (installFetcher.data && !installFetcher.data.success) {
      setSyncError(installFetcher.data.error ?? "Falha ao sincronizar a loja com a API central.");
    }
  }, [installFetcher.data]);

  const revenue = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: metrics.currencyCode,
  }).format(metrics.revenue);

  return (
    <s-page heading="Visão geral">
      <s-stack direction="block" gap="base">
        <s-paragraph>Acompanhe o desempenho das assinaturas gerenciadas pelo APS Subscription.</s-paragraph>

        {error && <s-banner heading="Indicadores temporariamente indisponíveis" tone="warning">{error}</s-banner>}
        {syncError && <s-banner heading="Falha na sincronização com a API central" tone="warning">{syncError}</s-banner>}

        <s-section heading="Desempenho">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              {ranges.map((days) => (
                <s-button key={days} href={`/app?days=${days}`} variant={metrics.days === days ? "primary" : "secondary"}>
                  {days} dias
                </s-button>
              ))}
            </s-stack>

            <s-text color="subdued">{formatDate(metrics.from)} – {formatDate(metrics.to)}</s-text>

            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(210px, 1fr))" gap="base">
              <MetricCard label="Receita de assinaturas" value={revenue} detail={`Pedidos nos últimos ${metrics.days} dias`} />
              <MetricCard label="Assinaturas ativas" value={metrics.activeSubscriptions} detail="Contratos ativos atualmente" />
              <MetricCard label="Novas assinaturas" value={metrics.newSubscriptions} detail={`Criadas nos últimos ${metrics.days} dias`} />
              <MetricCard label="Assinaturas canceladas" value={metrics.cancelledSubscriptions} detail={`Atualizadas como canceladas nos últimos ${metrics.days} dias`} />
            </s-grid>
          </s-stack>
        </s-section>

        <s-section heading="Gerenciamento rápido">
          <s-stack direction="inline" gap="base">
            <s-button href="/app/selling-plans" variant="primary">Gerenciar Selling Plans</s-button>
            <s-button href="/app/settings" variant="secondary">Configurações</s-button>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
