import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listSubscriptionProducts } from "../lib/selling-plans.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const search = new URL(request.url).searchParams.get("search")?.trim() ?? "";
  return { products: await listSubscriptionProducts(admin, search), search };
};

export default function SellingPlansIndex() {
  const { products, search } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Selling Plans">
      <s-paragraph>Gerencie os planos de assinatura vinculados aos seus produtos de assinatura.</s-paragraph>

      <s-section heading="Adicionar produto ao gerenciador">
        <Form method="get">
          <s-grid gridTemplateColumns="minmax(260px, 1fr) auto auto" gap="base" alignItems="end">
            <s-search-field
              label="Pesquisar produtos"
              name="search"
              value={search}
              placeholder="Digite o nome do produto"
            />
            <s-button type="submit" variant="primary">Pesquisar</s-button>
            {search ? <s-button href="/app/selling-plans">Limpar</s-button> : null}
          </s-grid>
          <s-paragraph color="subdued">Pesquise qualquer produto do catálogo para criar ou gerenciar seus Selling Plans.</s-paragraph>
        </Form>
      </s-section>

      <s-section heading={search ? `Resultados para “${search}”` : "Produtos de assinatura"}>
        {products.length === 0 ? (
          <s-banner heading={search ? "Nenhum produto encontrado" : "Nenhum produto de assinatura encontrado"} tone="info">
            {search ? "Tente pesquisar usando outro nome de produto." : "Produtos com “Assinatura” no nome aparecerão aqui."}
          </s-banner>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Produto</s-table-header>
              <s-table-header>Shopify Product ID</s-table-header>
              <s-table-header format="numeric">Selling Plans</s-table-header>
              <s-table-header>Ações</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((product) => (
                <s-table-row key={product.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="base" alignItems="center">
                      {product.image && <s-thumbnail src={product.image.url} alt={product.image.altText ?? product.title} size="small" />}
                      <s-text type="strong">{product.title}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{product.numericId}</s-table-cell>
                  <s-table-cell>{product.totalSellingPlans}</s-table-cell>
                  <s-table-cell>
                    <s-button href={`/app/selling-plans/${product.numericId}`}>
                      {product.groups.length > 0 ? "Gerenciar planos" : "Adicionar ao gerenciador"}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
