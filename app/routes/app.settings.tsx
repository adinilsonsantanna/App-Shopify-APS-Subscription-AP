// app/routes/app.settings.tsx
// Página de configurações do App Shopify
// Aqui você define a URL da API Central de Assinaturas

import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Form, useLoaderData, useActionData } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return {
        apiUrl: process.env.API_SUBSCRIPTION_URL || "Não configurado",
        apiKeyConfigured: !!process.env.API_KEY,
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    await authenticate.admin(request);
    const formData = await request.formData();
    const testUrl = formData.get("testUrl") as string;

    try {
        const response = await fetch(`${testUrl}/`, {
            headers: { "X-API-Key": process.env.API_KEY || "" },
        });
        const data = await response.json();
        return { success: true, message: "Conexão com API Central OK!", data };
    } catch (error) {
        return { success: false, message: `Erro: ${String(error)}` };
    }
};

export default function SettingsPage() {
    const { apiUrl, apiKeyConfigured } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();

    return (
        <div style={{ padding: "20px", maxWidth: "600px" }}>
            <h1>Configurações - APS Subscription</h1>

            <div
                style={{
                    padding: "15px",
                    background: "#f4f6f8",
                    borderRadius: "8px",
                    marginBottom: "20px",
                }}
            >
                <h3>🔗 API Central de Assinaturas</h3>
                <p>
                    <strong>URL configurada:</strong> {apiUrl}
                </p>
                <p>
                    <strong>API Key:</strong>{" "}
                    {apiKeyConfigured ? "✅ Configurada" : "❌ Não configurada"}
                </p>
                <p style={{ fontSize: "12px", color: "#666" }}>
                    Para alterar a URL da API, atualize a variável API_SUBSCRIPTION_URL
                    nas variáveis de ambiente do App.
                </p>
            </div>

            <div
                style={{
                    padding: "15px",
                    background: "#f4f6f8",
                    borderRadius: "8px",
                    marginBottom: "20px",
                }}
            >
                <h3>🧪 Testar Conexão</h3>
                <Form method="post">
                    <input
                        type="url"
                        name="testUrl"
                        placeholder="https://sua-api.vercel.app"
                        defaultValue={apiUrl !== "Não configurado" ? apiUrl : ""}
                        style={{ width: "100%", padding: "8px", marginBottom: "10px" }}
                    />
                    <button type="submit" style={{ padding: "8px 16px" }}>
                        Testar Conexão
                    </button>
                </Form>

                {actionData && (
                    <div
                        style={{
                            marginTop: "10px",
                            padding: "10px",
                            background: actionData.success ? "#d4edda" : "#f8d7da",
                            borderRadius: "4px",
                        }}
                    >
                        {actionData.message}
                    </div>
                )}
            </div>
        </div>
    );
}