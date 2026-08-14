import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  clearBadgeSellingPlanIfSelected,
  createSellingPlan,
  deleteSellingPlan,
  getSubscriptionProduct,
  setBadgeSellingPlanId,
  updateSellingPlan,
  type SellingPlan,
} from "../lib/selling-plans.server";

const intervals = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
const labels = { DAY: "Dia", WEEK: "Semana", MONTH: "Mês", YEAR: "Ano" };

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const productId = params.productId;
  if (!productId || !/^\d+$/.test(productId)) throw new Response("Produto inválido", { status: 400 });
  return { product: await getSubscriptionProduct(admin, `gid://shopify/Product/${productId}`) };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const productId = params.productId;
  if (!productId || !/^\d+$/.test(productId)) return { ok: false, error: "Produto inválido." };
  try {
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const product = await getSubscriptionProduct(admin, `gid://shopify/Product/${productId}`);
    const groupId = String(form.get("groupId") ?? "");
    const sellingPlanId = String(form.get("sellingPlanId") ?? "");

    if (intent === "badge") {
      const badgeSellingPlanId = String(form.get("badgeSellingPlanId") ?? "");
      if (badgeSellingPlanId !== "none" && !/^gid:\/\/shopify\/SellingPlan\/\d+$/.test(badgeSellingPlanId)) {
        throw new Error("Selecione um Selling Plan válido.");
      }
      await setBadgeSellingPlanId(
        admin,
        product.id,
        badgeSellingPlanId === "none" ? null : badgeSellingPlanId,
      );
      return { ok: true, message: "Configuração do badge salva." };
    }

    if (intent === "delete") {
      const group = product.groups.find((candidate) => candidate.id === groupId);
      const owned = group?.sellingPlans.some((plan) => plan.id === sellingPlanId);
      if (!group || !owned) throw new Error("O plano não pertence ao grupo APS deste produto.");
      await clearBadgeSellingPlanIfSelected(admin, product, sellingPlanId);
      await deleteSellingPlan(admin, group, sellingPlanId);
      return { ok: true, message: "Selling Plan excluído." };
    }

    const name = String(form.get("name") ?? "").trim();
    const interval = String(form.get("interval") ?? "");
    const intervalCount = Number(form.get("intervalCount"));
    const discountPercentage = Number(form.get("discountPercentage"));
    if (!name || !intervals.includes(interval as typeof intervals[number])) throw new Error("Preencha um nome e uma frequência válidos.");
    if (!Number.isInteger(intervalCount) || intervalCount < 1) throw new Error("O intervalo deve ser um número inteiro maior que zero.");
    if (!Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 100) throw new Error("O desconto deve estar entre 0 e 100%.");
    const input = { name, interval, intervalCount, discountPercentage };

    if (intent === "create") await createSellingPlan(admin, product, input);
    else if (intent === "update") {
      const owned = product.groups.some((group) => group.id === groupId && group.sellingPlans.some((plan) => plan.id === sellingPlanId));
      if (!owned) throw new Error("O plano não pertence ao grupo APS deste produto.");
      await updateSellingPlan(admin, groupId, sellingPlanId, input);
    } else throw new Error("Ação inválida.");
    return { ok: true, message: intent === "create" ? "Selling Plan criado." : "Selling Plan atualizado." };
  } catch (error) {
    console.error("[Selling Plans] Falha na action:", error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível salvar o Selling Plan." };
  }
};

function PlanForm({ plan, groupId, onCancel }: { plan?: SellingPlan; groupId?: string; onCancel: () => void }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={plan ? "update" : "create"} />
      {plan && <><input type="hidden" name="groupId" value={groupId} /><input type="hidden" name="sellingPlanId" value={plan.id} /></>}
      <s-stack direction="block" gap="base">
        <s-text-field label="Nome do plano" name="name" value={plan?.name ?? ""} placeholder="Mensal" required />
        <s-select label="Frequência" name="interval" value={plan?.interval ?? "MONTH"}>
          {intervals.map((interval) => <s-option key={interval} value={interval}>{labels[interval]}</s-option>)}
        </s-select>
        <s-number-field label="Intervalo" name="intervalCount" value={String(plan?.intervalCount ?? 1)} min={1} step={1} required />
        <s-number-field label="Desconto (%)" name="discountPercentage" value={String(plan?.discountPercentage ?? 20)} min={0} max={100} step={0.01} required />
        <s-stack direction="inline" gap="base">
          <s-button type="submit" variant="primary">{plan ? "Salvar alterações" : "Criar Selling Plan"}</s-button>
          <s-button type="button" variant="secondary" onClick={onCancel}>Cancelar</s-button>
        </s-stack>
      </s-stack>
    </Form>
  );
}

export default function ProductSellingPlans() {
  const { product } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [editing, setEditing] = useState<{ plan: SellingPlan; groupId: string } | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (actionData?.ok) { shopify.toast.show(actionData.message ?? "Operação concluída."); setEditing(null); setCreating(false); }
  }, [actionData, shopify]);
  const busy = navigation.state !== "idle";
  const plans = product.groups.flatMap((group) =>
    group.sellingPlans.map((plan) => ({ group, plan })),
  );

  return (
    <s-page heading={product.title}>
      <s-button slot="breadcrumb-actions" href="/app/selling-plans">Selling Plans</s-button>
      <s-paragraph>Selling Plans gerenciados pelo APS Subscription.</s-paragraph>
      {actionData && !actionData.ok && <s-banner heading="Não foi possível concluir" tone="critical">{actionData.error}</s-banner>}
      {creating && <s-section heading="Criar Selling Plan"><s-paragraph>Produto: {product.title}</s-paragraph><PlanForm onCancel={() => setCreating(false)} /></s-section>}
      <s-section heading="Selling Plans">
        {plans.length === 0 ? <s-paragraph>Nenhum Selling Plan APS associado a este produto.</s-paragraph> : (
          <s-stack direction="block" gap="base">
            {plans.map(({ group, plan }, index) => (
              <s-box key={plan.id} padding="base" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-heading>Plano {index + 1}</s-heading>
                  <s-text type="strong">{plan.name}</s-text>
                  <s-text>Cobrança: a cada {plan.intervalCount} {labels[plan.interval].toLowerCase()}(s)</s-text>
                  <s-text>Entrega: a cada {plan.deliveryIntervalCount} {labels[plan.deliveryInterval].toLowerCase()}(s)</s-text>
                  <s-text>Desconto: {plan.discountPercentage}%</s-text>
                  <s-stack direction="inline" gap="base">
                    <s-button disabled={busy} onClick={() => { setCreating(false); setEditing({ groupId: group.id, plan }); }}>Editar</s-button>
                    <Form method="post" onSubmit={(event) => { if (!confirm(`Excluir o plano “${plan.name}”?`)) event.preventDefault(); }}>
                      <input type="hidden" name="intent" value="delete" /><input type="hidden" name="groupId" value={group.id} /><input type="hidden" name="sellingPlanId" value={plan.id} />
                      <s-button type="submit" tone="critical" disabled={busy}>Excluir</s-button>
                    </Form>
                  </s-stack>
                  {editing?.plan.id === plan.id && (
                    <s-stack direction="block" gap="base">
                      <s-divider />
                      <s-heading>Editar {plan.name}</s-heading>
                      <PlanForm
                        plan={plan}
                        groupId={group.id}
                        onCancel={() => setEditing(null)}
                      />
                    </s-stack>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
        {!creating && !editing && <s-button variant="primary" onClick={() => setCreating(true)}>Criar Selling Plan</s-button>}
      </s-section>
      <s-section heading="Badge na loja">
        <s-paragraph>Escolha qual Selling Plan receberá o badge configurado no editor do tema da Shopify.</s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="badge" />
          <s-stack direction="block" gap="base">
            <s-select
              label="Exibir badge no plano"
              name="badgeSellingPlanId"
              value={plans.find(({ plan }) => plan.id.split("/").pop() === product.badgeSellingPlanId)?.plan.id ?? "none"}
            >
              <s-option value="none">Não exibir badge</s-option>
              {plans.map(({ plan }) => (
                <s-option key={plan.id} value={plan.id}>{plan.name}</s-option>
              ))}
            </s-select>
            <s-button type="submit" variant="primary" disabled={busy}>Salvar configuração</s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
