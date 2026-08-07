// app/routes/api.install.ts
// Endpoint interno do App Shopify que recebe os dados da loja
// e os envia para a API Central de Assinaturas

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { installShopOnApi } from "../lib/api.client";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const { shop, accessToken, scope } = session;

    try {
        // Busca informações da loja no Shopify Admin
        const response = await fetch(
            `https://${shop}/admin/api/2024-07/shop.json`,
            {
                headers: {
                    "X-Shopify-Access-Token": accessToken,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Shopify API error: ${response.status}`);
        }

        const shopData = await response.json();
        const shopName = shopData.shop?.name || shop;
        const shopifyShopId = shopData.shop?.id?.toString();

        // Envia para a API Central de Assinaturas
        const result = await installShopOnApi({
            shopifyShopId,
            name: shopName,
            domain: shop,
            accessToken,
            scopes: scope || "",
        });

        return Response.json({ success: true, data: result });
    } catch (error) {
        console.error("[api.install] Erro ao sincronizar com API Central:", error);
        return Response.json(
            { success: false, error: String(error) },
            { status: 500 }
        );
    }
};