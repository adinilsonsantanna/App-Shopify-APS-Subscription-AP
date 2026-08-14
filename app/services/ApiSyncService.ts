export interface SyncShopPayload {
  shopifyShopId?: string;
  name: string;
  domain: string;
  accessToken: string;
  scopes: string;
}

export class ApiSyncService {
  private apiUrl = process.env.API_SUBSCRIPTION_URL!;
  private apiKey = process.env.API_KEY!;

  async syncShop(data: SyncShopPayload) {
    const response = await fetch(`${this.apiUrl}/api/shop/install`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error("Erro ao sincronizar a loja com a APS API.");
    }

    return response.json();
  }
}
