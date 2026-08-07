// app/lib/api.client.ts
// Cliente HTTP para comunicação com a API Central de Assinaturas

const API_BASE_URL = process.env.API_SUBSCRIPTION_URL || "";
const API_KEY = process.env.API_KEY || "";

async function apiFetch(path: string, options: RequestInit = {}) {
    if (!API_BASE_URL) {
        throw new Error("API_SUBSCRIPTION_URL não configurada");
    }

    const url = `${API_BASE_URL}${path}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "X-API-Key": API_KEY,
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return response.json();
}

export async function installShopOnApi(data: {
    shopifyShopId?: string;
    name: string;
    domain: string;
    accessToken: string;
    scopes: string;
}) {
    return apiFetch("/api/shop/install", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function getShopFromApi(domain: string) {
    return apiFetch(`/api/shop/${domain}`);
}

export async function getSubscriptionsFromApi(domain: string) {
    return apiFetch(`/api/shop/${domain}/subscriptions`);
}