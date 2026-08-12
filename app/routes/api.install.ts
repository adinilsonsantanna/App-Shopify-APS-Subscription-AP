// app/routes/api.install.ts
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const API_BASE_URL = process.env.API_SUBSCRIPTION_URL || "";
const API_KEY = process.env.API_KEY || "";

async function installShopOnApi(data: {
    shopifyShopId?: string;
    name: string;
    domain: string;
    accessToken: string;
    scopes: string;
}) {
    const url = `${API_BASE_URL}/api/shop/install`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-API-Key": API_KEY,
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return response.json();
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const { shop, accessToken, scope } = session;

    if (!accessToken) {
        throw new Error("Shopify access token não disponível na sessão.");
    }

    try {
        const response = await fetch(
            `https://${shop}/admin/api/2026-07/shop.json`,
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

        const result = await installShopOnApi({
            shopifyShopId,
            name: shopName,
            domain: shop,
            accessToken,
            scopes: scope || "",
        });

        return Response.json({ success: true, data: result });
    } catch (error) {
        console.error("[api.install] Erro:", error);
        return Response.json(
            { success: false, error: String(error) },
            { status: 500 }
        );
    }
};