import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listSubscriptionProducts } from "../lib/selling-plans.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  return { products: await listSubscriptionProducts(admin) };
};

export default function SellingPlansIndex() {
  const { products } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Selling Plans">
      <s-paragraph>Gerencie os planos de assinatura vinculados aos seus produtos de assinatura.</s-paragraph>
      <s-section heading="Produtos de assinatura">
        {products.length === 0 ? (
          <s-banner heading="Nenhum produto de assinatura encontrado" tone="info">
            Produtos com “Assinatura” no nome aparecerão aqui.
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
                  <s-table-cell>{product.groups.reduce((total, group) => total + group.sellingPlans.length, 0)}</s-table-cell>
                  <s-table-cell><s-button href={`/app/selling-plans/${product.numericId}`}>Gerenciar planos</s-button></s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
