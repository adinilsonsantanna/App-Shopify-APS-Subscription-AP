// app/routes/app._index.tsx
// Página principal do App Shopify
// Chama a API de instalação automaticamente ao carregar

import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
          variants: [{ price: "100.00" }],
        },
      },
    }
  );
  const responseJson = await response.json();
  return {
    product: responseJson.data!.productCreate!.product,
  };
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const installFetcher = useFetcher();
  const shopify = useAppBridge();

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const productId = fetcher.data?.product?.id;

  // 🆕 Chama a API Central de Assinaturas ao carregar a página
  useEffect(() => {
    if (installFetcher.state === "idle" && !installFetcher.data) {
      installFetcher.submit(null, { method: "POST", action: "/api/install" });
    }
  }, [installFetcher]);

  useEffect(() => {
    if (productId) {
      shopify.toast.show("Product created");
    }
  }, [productId, shopify]);

  const generateProduct = () => fetcher.submit({}, { method: "POST" });

  return (
    <div style={{ padding: "20px" }}>
      <h1>APS Subscription App</h1>

      {/* Status da sincronização com a API Central */}
      {installFetcher.data && (
        <div
          style={{
            padding: "12px",
            marginBottom: "20px",
            borderRadius: "6px",
            background: installFetcher.data.success ? "#d4edda" : "#f8d7da",
          }}
        >
          {installFetcher.data.success
            ? "✅ Loja sincronizada com a API Central de Assinaturas"
            : `❌ Erro na sincronização: ${installFetcher.data.error}`}
        </div>
      )}

      {installFetcher.state === "loading" && (
        <div style={{ padding: "12px", marginBottom: "20px", background: "#fff3cd" }}>
          ⏳ Sincronizando loja com a API Central...
        </div>
      )}

      <div style={{ marginBottom: "20px" }}>
        <Link
          to="/app/settings"
          style={{
            padding: "10px 20px",
            background: "#008060",
            color: "white",
            textDecoration: "none",
            borderRadius: "4px",
            display: "inline-block",
            marginRight: "10px",
          }}
        >
          ⚙️ Configurações da API
        </Link>
      </div>

      <button onClick={generateProduct} disabled={isLoading}>
        {isLoading ? "Creating..." : "Generate a product"}
      </button>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};