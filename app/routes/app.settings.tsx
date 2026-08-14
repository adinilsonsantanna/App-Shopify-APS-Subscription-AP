import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const defaults = {
  paymentRetryAttempts: 3,
  paymentRetryDays: 2,
  paymentFailureAction: "PAUSE_AND_NOTIFY",
  inventoryRetryAttempts: 5,
  inventoryRetryDays: 1,
  inventoryFailureAction: "SKIP_AND_NOTIFY",
  teamNotificationFrequency: "WEEKLY_SUMMARY",
};

function boundedInteger(formData: FormData, name: string, min: number, max: number) {
  const value = Number(formData.get(name));
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.billingRetrySettings.findUnique({ where: { shop: session.shop } });
  const shopHandle = session.shop.replace(/\.myshopify\.com$/i, "");
  return {
    settings: settings ?? defaults,
    notificationsUrl: `https://admin.shopify.com/store/${shopHandle}/settings/notifications/customer`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const paymentRetryAttempts = boundedInteger(formData, "paymentRetryAttempts", 0, 10);
  const paymentRetryDays = boundedInteger(formData, "paymentRetryDays", 1, 14);
  const inventoryRetryAttempts = boundedInteger(formData, "inventoryRetryAttempts", 0, 10);
  const inventoryRetryDays = boundedInteger(formData, "inventoryRetryDays", 1, 14);
  const paymentFailureAction = String(formData.get("paymentFailureAction") || "");
  const inventoryFailureAction = String(formData.get("inventoryFailureAction") || "");
  const teamNotificationFrequency = String(formData.get("teamNotificationFrequency") || "");

  if ([paymentRetryAttempts, paymentRetryDays, inventoryRetryAttempts, inventoryRetryDays].includes(null)) {
    return { ok: false, message: "Revise os limites informados e tente novamente." };
  }

  const data = {
    paymentRetryAttempts: paymentRetryAttempts!, paymentRetryDays: paymentRetryDays!, paymentFailureAction,
    inventoryRetryAttempts: inventoryRetryAttempts!, inventoryRetryDays: inventoryRetryDays!,
    inventoryFailureAction, teamNotificationFrequency,
  };
  await prisma.billingRetrySettings.upsert({ where: { shop: session.shop }, create: { shop: session.shop, ...data }, update: data });
  return { ok: true, message: "Configurações salvas." };
};

export default function SettingsPage() {
  const { settings, notificationsUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.ok) shopify.toast.show(actionData.message);
  }, [actionData, shopify]);

  return (
    <s-page heading="Configurações" inlineSize="large">
      {actionData && !actionData.ok ? <s-banner heading="Não foi possível salvar" tone="critical">{actionData.message}</s-banner> : null}
      <Form method="post" data-save-bar data-discard-confirmation>
        <s-grid gridTemplateColumns="280px minmax(0, 1fr)" gap="large">
          <s-box paddingBlockStart="base">
            <s-stack direction="block" gap="base">
              <s-heading>Tentativas de faturamento</s-heading>
              <s-paragraph>Controle quando novas tentativas de faturamento serão feitas depois de uma falha</s-paragraph>
            </s-stack>
          </s-box>

          <s-section heading="Falha na forma de pagamento">
            <s-stack direction="block" gap="large">
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-stack direction="block" gap="small">
                  <s-number-field label="Número de tentativas de repetição" name="paymentRetryAttempts" value={String(settings.paymentRetryAttempts)} min={0} max={10} step={1} required />
                  <s-text color="subdued">Mínimo de 0, máximo de 10 tentativas</s-text>
                </s-stack>
                <s-stack direction="block" gap="small">
                  <s-number-field label="Dias entre tentativas de repetição de pagamento" name="paymentRetryDays" value={String(settings.paymentRetryDays)} min={1} max={14} step={1} required />
                  <s-text color="subdued">Mínimo de 1, máximo de 14 dias</s-text>
                </s-stack>
              </s-grid>
              <s-select label="Ação quando todas as tentativas de repetição falharem" name="paymentFailureAction" value={settings.paymentFailureAction}>
                <s-option value="PAUSE_AND_NOTIFY">Pausar assinatura e enviar notificação</s-option>
                <s-option value="CANCEL_AND_NOTIFY">Cancelar assinatura e enviar notificação</s-option>
                <s-option value="SKIP_AND_NOTIFY">Pular pedido e enviar notificação</s-option>
              </s-select>
              <s-link href={notificationsUrl}>Editar notificações</s-link>
              <s-divider />
              <s-heading>Estoque insuficiente</s-heading>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-stack direction="block" gap="small">
                  <s-number-field label="Número de tentativas de repetição" name="inventoryRetryAttempts" value={String(settings.inventoryRetryAttempts)} min={0} max={10} step={1} required />
                  <s-text color="subdued">Mínimo de 0, máximo de 10 tentativas</s-text>
                </s-stack>
                <s-stack direction="block" gap="small">
                  <s-number-field label="Dias entre tentativas de repetição de pagamento" name="inventoryRetryDays" value={String(settings.inventoryRetryDays)} min={1} max={14} step={1} required />
                  <s-text color="subdued">Mínimo de 1, máximo de 14 dias</s-text>
                </s-stack>
              </s-grid>
              <s-select label="Ação quando todas as tentativas de repetição falharem" name="inventoryFailureAction" value={settings.inventoryFailureAction}>
                <s-option value="SKIP_AND_NOTIFY">Pular pedido e enviar notificação</s-option>
                <s-option value="PAUSE_AND_NOTIFY">Pausar assinatura e enviar notificação</s-option>
                <s-option value="CANCEL_AND_NOTIFY">Cancelar assinatura e enviar notificação</s-option>
              </s-select>
              <s-select label="Frequência de notificações para membros da equipe" name="teamNotificationFrequency" value={settings.teamNotificationFrequency}>
                <s-option value="IMMEDIATELY">Notificar a cada falha de faturamento</s-option>
                <s-option value="DAILY_SUMMARY">Resumo diário de falhas de faturamento</s-option>
                <s-option value="WEEKLY_SUMMARY">Resumo semanal de falhas de faturamento</s-option>
                <s-option value="NEVER">Não enviar notificações</s-option>
              </s-select>
              <s-link href={notificationsUrl}>Editar notificações</s-link>
              <s-stack direction="inline" justifyContent="end">
                <s-button type="submit" variant="primary" loading={navigation.state === "submitting"}>Salvar</s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </s-grid>
      </Form>
    </s-page>
  );
}
