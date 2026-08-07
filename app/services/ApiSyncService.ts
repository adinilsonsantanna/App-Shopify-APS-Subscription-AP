export interface SyncShopPayload {
  shopifyShopId?: string;
  name: string;
  domain: string;
  accessToken: string;
  scopes: string;
}

export class ApiSyncService {
  private apiUrl = process.env.APS_API_URL!;

  async syncShop(data: SyncShopPayload) {
    const response = await fetch(`${this.apiUrl}/api/shop/install`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error("Erro ao sincronizar a loja com a APS API.");
    }

    return response.json();
  }
}