// app/routes/app._index.tsx
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][Math.floor(Math.random() * 4)];
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
  return { product: responseJson.data!.productCreate!.product };
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const installFetcher = useFetcher();
  const shopify = useAppBridge();
  const [syncStatus, setSyncStatus] = useState<"loading" | "success" | "error" | null>(null);
  const [syncMessage, setSyncMessage] = useState("");

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const productId = fetcher.data?.product?.id;

  useEffect(() => {
    if (installFetcher.state === "idle" && !installFetcher.data) {
      installFetcher.submit(null, { method: "POST", action: "/api/install" });
      setSyncStatus("loading");
    }
  }, [installFetcher]);

  useEffect(() => {
    if (installFetcher.data) {
      if (installFetcher.data.success) {
        setSyncStatus("success");
        setSyncMessage("Loja sincronizada com a API Central de Assinaturas");
      } else {
        setSyncStatus("error");
        setSyncMessage(`Erro na sincronização: ${installFetcher.data.error}`);
      }
    }
  }, [installFetcher.data]);

  useEffect(() => {
    if (productId) {
      shopify.toast.show("Product created");
    }
  }, [productId, shopify]);

  const generateProduct = () => fetcher.submit({}, { method: "POST" });

  return (
    <div style={{ padding: "20px" }}>
      <h1>APS Subscription App</h1>

      {syncStatus === "loading" && (
        <div style={{ padding: "12px", marginBottom: "20px", background: "#fff3cd", borderRadius: "6px" }}>
          ⏳ Sincronizando loja com a API Central...
        </div>
      )}

      {syncStatus === "success" && (
        <div style={{ padding: "12px", marginBottom: "20px", background: "#d4edda", borderRadius: "6px" }}>
          ✅ {syncMessage}
        </div>
      )}

      {syncStatus === "error" && (
        <div style={{ padding: "12px", marginBottom: "20px", background: "#f8d7da", borderRadius: "6px" }}>
          ❌ {syncMessage}
        </div>
      )}

      <button onClick={generateProduct} disabled={isLoading}>
        {isLoading ? "Creating..." : "Generate a product"}
      </button>
    </div>
  );
}