import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  domainAction,
  getNotificationSettings,
  getSendingDomains,
  saveNotificationSettings,
  sendNotificationTest,
  type SendingDomain,
} from "../lib/notification-settings-api.server";
const FREQUENCIES = new Set([
  "IMMEDIATELY",
  "DAILY_SUMMARY",
  "WEEKLY_SUMMARY",
  "NEVER",
]);
const statusLabel: Record<string, string> = {
  not_configured: "Não configurado",
  not_started: "Aguardando DNS",
  pending: "Aguardando DNS",
  verifying: "Verificando",
  verified: "Verificado",
  partially_verified: "Parcialmente verificado",
  partially_failed: "Parcialmente verificado",
  failed: "Falhou",
  disabled: "Desativado",
};
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const settings = await getNotificationSettings(session.shop);
  try { return { settings, domains: await getSendingDomains(session.shop), domainsError: null }; }
  catch (error) { return { settings, domains: [] as SendingDomain[], domainsError: error instanceof Error ? error.message : "Não foi possível carregar os domínios." }; }
}
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request),
    form = await request.formData(),
    intent = String(form.get("intent") || "save");
  try {
    if (["setup", "verify", "refresh"].includes(intent)) {
      await domainAction(
        session.shop,
        intent as "setup" | "verify" | "refresh",
      );
      return {
        ok: true,
        message:
          intent === "setup"
            ? "Configuração DNS criada."
            : "Status do domínio atualizado.",
      };
    }
    if (intent === "test") {
      await sendNotificationTest(session.shop);
      return {
        ok: true,
        message: "E-mail de teste solicitado para a equipe configurada.",
      };
    }
    const teamFrequency = String(form.get("teamFrequency") || "");
    if (!FREQUENCIES.has(teamFrequency))
      return { ok: false, message: "Frequência inválida." };
    const teamEmails = String(form.get("teamEmails") || "")
      .split(/[\s,;]+/)
      .filter(Boolean);
    await saveNotificationSettings(session.shop, {
      fromName: form.get("fromName"),
      fromEmail: form.get("fromEmail"),
      replyTo: form.get("replyTo"),
      teamEmails,
      teamFrequency,
      customerNotificationsEnabled:
        form.get("customerNotificationsEnabled") === "on",
      paymentFailedEnabled: form.get("paymentFailedEnabled") === "on",
      retryScheduledEnabled: form.get("retryScheduledEnabled") === "on",
      inventoryFailedEnabled: form.get("inventoryFailedEnabled") === "on",
      inventoryRetryEnabled: form.get("inventoryRetryEnabled") === "on",
      pausedEnabled: form.get("pausedEnabled") === "on",
      cancelledEnabled: form.get("cancelledEnabled") === "on",
      renewalSucceededEnabled: form.get("renewalSucceededEnabled") === "on",
    });
    return { ok: true, message: "Configurações de notificações salvas." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Operação não confirmada.",
    };
  }
}
export default function NotificationsPage() {
  const { settings, domains, domainsError } = useLoaderData<typeof loader>(),
    result = useActionData<typeof action>(),
    navigation = useNavigation(),
    shopify = useAppBridge(),
    activeDomain = domains.find((item) => item.id === settings.activeSendingDomain?.id),
    pendingDomain = domains.find((item) => item.domain === settings.fromEmail?.split("@")[1] && item.id !== activeDomain?.id),
    domain = pendingDomain || activeDomain || domains[0];
  useEffect(() => {
    if (result?.ok) shopify.toast.show(result.message);
  }, [result, shopify]);
  const copy = (value: string) =>
    navigator.clipboard
      .writeText(value)
      .then(() => shopify.toast.show("Copiado."));
  return (
    <s-page heading="Notificações transacionais" inlineSize="large">
      {result && !result.ok ? (
        <s-banner heading="Não foi possível concluir" tone="critical">
          {result.message}
        </s-banner>
      ) : null}
      <s-stack direction="block" gap="large">
        <Form method="post" data-save-bar data-discard-confirmation>
          <input type="hidden" name="intent" value="save" />
          <s-section heading="Remetente e equipe">
            <s-stack direction="block" gap="base">
              {settings.activeFromEmail ? <s-banner heading="Remetente ativo" tone="success">{settings.activeFromName || "Remetente"} &lt;{settings.activeFromEmail}&gt;{settings.activeReplyTo ? ` · Reply-To ${settings.activeReplyTo}` : ""}</s-banner> : <s-banner heading="Nenhum remetente ativo" tone="warning">Conclua a verificação DNS antes de enviar notificações.</s-banner>}
              {settings.fromEmail && settings.fromEmail !== settings.activeFromEmail ? <s-banner heading="Remetente aguardando verificação" tone="info">{settings.fromName || "Remetente"} &lt;{settings.fromEmail}&gt;</s-banner> : null}
              <s-text-field
                label="Nome do remetente"
                name="fromName"
                value={settings.fromName || ""}
                required
              />
              <s-email-field
                label="E-mail de origem"
                name="fromEmail"
                value={settings.fromEmail || ""}
                required
              />
              <s-email-field
                label="Reply-To"
                name="replyTo"
                value={settings.replyTo || ""}
                required
              />
              <s-text-area
                label="E-mails da equipe"
                name="teamEmails"
                value={settings.teamEmails.join("\n")}
                rows={3}
              />
              <s-select
                label="Frequência da equipe"
                name="teamFrequency"
                value={settings.teamFrequency}
              >
                <s-option value="IMMEDIATELY">Imediatamente</s-option>
                <s-option value="DAILY_SUMMARY">Resumo diário</s-option>
                <s-option value="WEEKLY_SUMMARY">Resumo semanal</s-option>
                <s-option value="NEVER">Nunca</s-option>
              </s-select>
              <s-switch
                label="Ativar notificações para clientes"
                name="customerNotificationsEnabled"
                checked={settings.customerNotificationsEnabled}
              />
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-switch
                  label="Falha de pagamento"
                  name="paymentFailedEnabled"
                  checked={settings.paymentFailedEnabled ?? true}
                />
                <s-switch
                  label="Nova tentativa"
                  name="retryScheduledEnabled"
                  checked={settings.retryScheduledEnabled ?? true}
                />
                <s-switch
                  label="Estoque insuficiente"
                  name="inventoryFailedEnabled"
                  checked={settings.inventoryFailedEnabled ?? true}
                />
                <s-switch
                  label="Nova verificação de estoque"
                  name="inventoryRetryEnabled"
                  checked={settings.inventoryRetryEnabled ?? true}
                />
                <s-switch
                  label="Assinatura pausada"
                  name="pausedEnabled"
                  checked={settings.pausedEnabled ?? true}
                />
                <s-switch
                  label="Assinatura cancelada"
                  name="cancelledEnabled"
                  checked={settings.cancelledEnabled ?? true}
                />
                <s-switch
                  label="Renovação aprovada"
                  name="renewalSucceededEnabled"
                  checked={settings.renewalSucceededEnabled ?? true}
                />
              </s-grid>
              <s-stack direction="inline" justifyContent="end">
                <s-button
                  type="submit"
                  variant="primary"
                  loading={navigation.state === "submitting"}
                >
                  Salvar
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </Form>
        <s-section heading="Configuração DNS">
          <s-stack direction="block" gap="base">
            {domainsError ? <s-banner heading="Falha ao carregar domínios" tone="critical">{domainsError} Tente atualizar o status novamente.</s-banner> : null}
            <s-text>Domínio: {domain?.domain || "Não configurado"}</s-text>
            <s-badge tone={domain?.sendingVerified ? "success" : "caution"}>
              {statusLabel[domain?.status || "not_configured"] ||
                domain?.status}
            </s-badge>
            {domain?.records?.length ? (
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header listSlot="primary">Finalidade</s-table-header>
                  <s-table-header>Tipo</s-table-header>
                  <s-table-header>Nome/host</s-table-header>
                  <s-table-header>Valor/destino</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header>Ações</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {domain.records.map((record) => (
                    <s-table-row key={`${record.type}:${record.name}:${record.value}`}>
                      <s-table-cell>{record.purpose}</s-table-cell>
                      <s-table-cell>{record.type}</s-table-cell>
                      <s-table-cell>{record.name}</s-table-cell>
                      <s-table-cell>
                        {record.value}
                        {record.priority != null
                          ? ` · prioridade ${record.priority}`
                          : ""}
                        {record.ttl ? ` · TTL ${record.ttl}` : ""}
                      </s-table-cell>
                      <s-table-cell>{record.status}</s-table-cell>
                      <s-table-cell>
                        <s-button-group gap="base">
                          <s-button
                            type="button"
                            onClick={() => copy(record.name)}
                          >
                            Copiar nome
                          </s-button>
                          <s-button
                            type="button"
                            onClick={() => copy(record.value)}
                          >
                            Copiar valor
                          </s-button>
                        </s-button-group>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            ) : (
              <s-paragraph>
                Salve o remetente e inicie a configuração para obter os
                registros exatos do Resend.
              </s-paragraph>
            )}
            <s-text color="subdued">
              Última verificação:{" "}
              {domain?.lastCheckedAt
                ? new Date(domain.lastCheckedAt).toLocaleString("pt-BR")
                : "ainda não verificado"}
            </s-text>
            <s-button-group gap="base">
              <Form method="post">
                <input type="hidden" name="intent" value="setup" />
                <s-button type="submit">Configurar domínio</s-button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="verify" />
                <s-button type="submit">Verificar configuração</s-button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="refresh" />
                <s-button type="submit">Atualizar status</s-button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="test" />
                <s-button type="submit" disabled={!activeDomain?.sendingVerified || !settings.activeFromEmail}>
                  Enviar teste para equipe
                </s-button>
              </Form>
            </s-button-group>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
