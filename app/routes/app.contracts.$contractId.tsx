import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getContract, updateContractStatus } from "../lib/contracts.server";

const statusLabels: Record<string, string> = { ACTIVE: "Ativo", PAUSED: "Pausado", CANCELLED: "Cancelado", EXPIRED: "Expirado", FAILED: "Falhou" };

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  if (!params.contractId || !/^\d+$/.test(params.contractId)) throw new Response("Contrato inválido", { status: 400 });
  return { contract: await getContract(admin, `gid://shopify/SubscriptionContract/${params.contractId}`) };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  if (!params.contractId || !/^\d+$/.test(params.contractId)) return { ok: false, error: "Contrato inválido." };
  try {
    const form = await request.formData();
    const intent = String(form.get("intent"));
    if (!(["activate", "pause", "cancel"] as const).includes(intent as "activate" | "pause" | "cancel")) throw new Error("Ação inválida.");
    await updateContractStatus(admin, `gid://shopify/SubscriptionContract/${params.contractId}`, intent as "activate" | "pause" | "cancel");
    return { ok: true, message: "Status do contrato atualizado." };
  } catch (error) {
    console.error("[Contracts] Falha ao atualizar contrato:", error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível atualizar o contrato." };
  }
};

export default function ContractDetails() {
  const { contract } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const busy = navigation.state !== "idle";

  useEffect(() => { if (actionData?.ok) shopify.toast.show(actionData.message ?? "Contrato atualizado."); }, [actionData, shopify]);

  return (
    <s-page heading={`Contrato ${contract.numericId}`}>
      <s-button slot="breadcrumb-actions" href="/app/contracts">Contratos</s-button>
      {actionData && !actionData.ok && <s-banner heading="Não foi possível atualizar" tone="critical">{actionData.error}</s-banner>}
      <s-section heading="Cliente">
        <s-stack direction="block" gap="small"><s-text type="strong">{contract.customerName}</s-text><s-text>{contract.customerEmail}</s-text></s-stack>
      </s-section>
      <s-section heading="Assinatura">
        <s-stack direction="block" gap="base">
          <s-text>Status: {statusLabels[contract.status] ?? contract.status}</s-text>
          <s-text>Produtos: {contract.products.join(", ")}</s-text>
          <s-text>Valor: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: contract.currencyCode }).format(contract.price)}</s-text>
          <s-text>Próxima cobrança: {contract.nextBillingDate ? new Intl.DateTimeFormat("pt-BR").format(new Date(contract.nextBillingDate)) : "—"}</s-text>
        </s-stack>
      </s-section>
      <s-section heading="Gerenciar contrato">
        <s-stack direction="inline" gap="base">
          {contract.status === "ACTIVE" && <Form method="post" onSubmit={(event) => { if (!confirm("Pausar este contrato?")) event.preventDefault(); }}><input type="hidden" name="intent" value="pause" /><s-button type="submit" disabled={busy}>Pausar</s-button></Form>}
          {contract.status === "PAUSED" && <Form method="post"><input type="hidden" name="intent" value="activate" /><s-button type="submit" variant="primary" disabled={busy}>Reativar</s-button></Form>}
          {!["CANCELLED", "EXPIRED"].includes(contract.status) && <Form method="post" onSubmit={(event) => { if (!confirm("Cancelar este contrato? Esta ação não pode ser desfeita.")) event.preventDefault(); }}><input type="hidden" name="intent" value="cancel" /><s-button type="submit" tone="critical" disabled={busy}>Cancelar contrato</s-button></Form>}
        </s-stack>
      </s-section>
    </s-page>
  );
}
