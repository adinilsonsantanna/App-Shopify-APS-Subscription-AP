// app/lib/api.client.ts
// Cliente HTTP para comunicação com a API Central de Assinaturas
// A URL da API é configurada manualmente nas variáveis de ambiente do App

const API_BASE_URL = process.env.API_SUBSCRIPTION_URL || "";
const API_KEY = process.env.API_KEY || "";

if (!API_BASE_URL) {
    console.warn("[api.client] API_SUBSCRIPTION_URL não configurada!");
}

async function apiFetch(path: string, options: RequestInit = {}) {
    if (!API_BASE_URL) {
        throw new Error("API_SUBSCRIPTION_URL não configurada nas variáveis de ambiente");
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

/**
 * Envia os dados da loja para a API Central no momento da instalação
 */
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

/**
 * Busca os dados de uma loja na API Central
 */
export async function getShopFromApi(domain: string) {
    return apiFetch(`/api/shop/${domain}`);
}

/**
 * Busca as assinaturas de uma loja
 */
export async function getSubscriptionsFromApi(domain: string) {
    return apiFetch(`/api/shop/${domain}/subscriptions`);
}

/**
 * Cria uma nova assinatura na API Central
 */
export async function createSubscription(data: {
    domain: string;
    shopifyCustomerId: string;
    shopifyProductId: string;
    shopifyVariantId: string;
    interval: number;
    intervalType: string;
    gateway?: string;
}) {
    return apiFetch("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify(data),
    });
}