import { useEffect, useRef, useState } from "react";
import type { MetaFunction } from "react-router";
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
  saveNotificationSettings,
  sendNotificationTest,
} from "../lib/notification-settings-api.server";
import { createNotificationPageAction } from "../lib/notification-page-action.server";
import {
  createNotificationPageLoader,
  notificationPageApi,
} from "../lib/notification-page.server";
import {
  buildNotificationDnsState,
  notificationActionProgress,
} from "../lib/notification-dns-ui";
import { copyDnsValue } from "../lib/notification-clipboard";
import styles from "../styles/notification-dns.module.css";

export const meta: MetaFunction = () => [
  { title: "Notificações transacionais" },
];
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
export const loader = createNotificationPageLoader({
  authenticateAdmin: authenticate.admin,
  ...notificationPageApi,
});
export const action = createNotificationPageAction({
  authenticateAdmin: authenticate.admin,
  domainAction,
  saveSettings: saveNotificationSettings,
  sendTest: sendNotificationTest,
});
export default function NotificationsPage() {
  const { settings, domains, loadError, domainsError } = useLoaderData<typeof loader>(),
    result = useActionData<typeof action>(),
    navigation = useNavigation(),
    shopify = useAppBridge(),
    dns = buildNotificationDnsState(settings, domains),
    progress = notificationActionProgress(
      navigation.state,
      navigation.formData,
    ),
    { domain, activeDomain } = dns,
    [copyFeedback, setCopyFeedback] = useState<{
      key: string;
      ok: boolean;
      message: string;
    } | null>(null),
    copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (result?.ok) shopify.toast.show(result.message);
  }, [result, shopify]);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const copy = async (key: string, value: string) => {
    const feedback = await copyDnsValue(value);
    setCopyFeedback({ key, ...feedback });
    if (feedback.ok) shopify.toast.show("Copiado");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyFeedback(null), 2_000);
  };
  const copyLabel = (key: string, fallback: string) =>
    copyFeedback?.ok && copyFeedback.key === key ? "Copiado" : fallback;
  return (
    <s-page heading="Notificações transacionais" inlineSize="large">
      {loadError ? <s-banner heading="Não foi possível carregar" tone="critical">{loadError}</s-banner> : null}
      {result && !result.ok ? (
        <s-banner heading="Não foi possível concluir" tone="critical">
          {result.message}
        </s-banner>
      ) : null}
      <s-stack direction="block" gap="large">
        {settings ? <Form method="post" data-save-bar data-discard-confirmation>
          <input type="hidden" name="intent" value="save" />
          <s-section heading="Remetente e equipe">
            <s-stack direction="block" gap="base">
              {settings.activeFromEmail ? <s-banner heading="Remetente ativo" tone="success">{settings.activeFromName || "Remetente"} &lt;{settings.activeFromEmail}&gt;{settings.activeReplyTo ? ` · Reply-To ${settings.activeReplyTo}` : ""}</s-banner> : <s-banner heading="Nenhum remetente ativo" tone="warning">Conclua a verificação DNS antes de enviar notificações.</s-banner>}
              {dns.showPendingSender ? <s-banner heading="Remetente aguardando verificação" tone="info">{settings.fromName || "Remetente"} &lt;{settings.fromEmail}&gt;</s-banner> : null}
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
        </Form> : null}
        <s-section heading="Configuração DNS">
          <s-stack direction="block" gap="base">
            {domainsError ? <s-banner heading="Falha ao carregar domínios" tone="critical">{domainsError} Tente atualizar o status novamente.</s-banner> : null}
            {dns.recoverableError ? <s-banner heading="A verificação DNS encontrou um problema" tone="critical">Os registros continuam disponíveis. Verifique o DNS e tente verificar ou atualizar o status novamente.</s-banner> : null}
            {copyFeedback && !copyFeedback.ok ? <s-banner heading="Não foi possível copiar" tone="critical">{copyFeedback.message}</s-banner> : null}
            <s-text>Domínio: {domain?.domain || "Não configurado"}</s-text>
            <s-badge tone={domain?.sendingVerified ? "success" : "caution"}>
              {statusLabel[domain?.status || "not_configured"] ||
                domain?.status}
            </s-badge>
            {domain?.records?.length ? (
              <div className={styles.recordsContainer}>
                <div className={styles.desktopRecords}>
                  <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header listSlot="primary">Finalidade</s-table-header>
                  <s-table-header>Tipo</s-table-header>
                  <s-table-header>Nome/host</s-table-header>
                  <s-table-header>Valor/destino</s-table-header>
                  <s-table-header>Prioridade</s-table-header>
                  <s-table-header>TTL</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header>Ações</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {domain.records.map((record, index) => {
                    const hostKey = `${index}:host`;
                    const valueKey = `${index}:value`;
                    return (
                    <s-table-row key={`${record.type}:${record.name}:${record.value}`}>
                      <s-table-cell>{record.purpose}</s-table-cell>
                      <s-table-cell>{record.type}</s-table-cell>
                      <s-table-cell><span className={styles.breakableValue}>{record.name}</span></s-table-cell>
                      <s-table-cell><span className={styles.breakableValue}>{record.value}</span></s-table-cell>
                      <s-table-cell>{record.priority ?? "—"}</s-table-cell>
                      <s-table-cell>{record.ttl || "—"}</s-table-cell>
                      <s-table-cell>{record.status}</s-table-cell>
                      <s-table-cell>
                        <s-button-group gap="base">
                          <s-button
                            type="button"
                            disabled={!record.name}
                            onClick={() => copy(hostKey, record.name)}
                          >
                            {copyLabel(hostKey, "Copiar host")}
                          </s-button>
                          <s-button
                            type="button"
                            disabled={!record.value}
                            onClick={() => copy(valueKey, record.value)}
                          >
                            {copyLabel(valueKey, "Copiar valor")}
                          </s-button>
                        </s-button-group>
                      </s-table-cell>
                    </s-table-row>
                  );})}
                </s-table-body>
                  </s-table>
                </div>
                <div className={styles.mobileRecords}>
                  {domain.records.map((record, index) => {
                    const hostKey = `${index}:mobile-host`;
                    const valueKey = `${index}:mobile-value`;
                    return <s-box key={`mobile:${record.type}:${record.name}:${record.value}`} padding="base" border="base" borderRadius="base">
                      <div className={styles.recordCardContent}>
                        <div className={styles.recordField}><span className={styles.recordLabel}>Finalidade</span><span className={styles.breakableValue}>{record.purpose}</span></div>
                        <div className={styles.recordField}><span className={styles.recordLabel}>Tipo</span><span className={styles.breakableValue}>{record.type}</span></div>
                        <div className={styles.recordField}><span className={styles.recordLabel}>Nome/host</span><span className={styles.breakableValue}>{record.name}</span></div>
                        <div className={styles.recordField}><span className={styles.recordLabel}>Valor/destino</span><span className={styles.breakableValue}>{record.value}</span></div>
                        {record.priority != null ? <div className={styles.recordField}><span className={styles.recordLabel}>Prioridade</span><span>{record.priority}</span></div> : null}
                        {record.ttl ? <div className={styles.recordField}><span className={styles.recordLabel}>TTL</span><span>{record.ttl}</span></div> : null}
                        <div className={styles.recordField}><span className={styles.recordLabel}>Status</span><span className={styles.breakableValue}>{record.status}</span></div>
                        <s-button-group gap="base">
                          <s-button type="button" disabled={!record.name} onClick={() => copy(hostKey, record.name)}>{copyLabel(hostKey, "Copiar host")}</s-button>
                          <s-button type="button" disabled={!record.value} onClick={() => copy(valueKey, record.value)}>{copyLabel(valueKey, "Copiar valor")}</s-button>
                        </s-button-group>
                      </div>
                    </s-box>;
                  })}
                </div>
              </div>
            ) : dns.state === "NOT_CONFIGURED" ? (
              <s-paragraph>
                {settings?.fromEmail
                  ? "Inicie a configuração DNS para criar o domínio e obter os registros."
                  : "Salve o remetente antes de iniciar a configuração DNS."}
              </s-paragraph>
            ) : <s-paragraph>Os registros ainda não foram retornados. Atualize o status para tentar novamente.</s-paragraph>}
            {domain ? <s-text color="subdued">
              Última verificação:{" "}
              {domain?.lastCheckedAt
                ? new Date(domain.lastCheckedAt).toLocaleString("pt-BR")
                : "ainda não verificado"}
            </s-text> : null}
            <s-stack direction="inline" gap="base">
              {dns.showSetup ? <Form method="post">
                <input type="hidden" name="intent" value="setup" />
                <s-button type="submit" variant="primary" loading={progress.intent === "setup"} disabled={progress.submitting}>Iniciar configuração DNS</s-button>
              </Form> : null}
              {dns.showVerify ? <Form method="post">
                <input type="hidden" name="intent" value="verify" />
                <s-button type="submit" loading={progress.intent === "verify"} disabled={progress.submitting}>Verificar DNS</s-button>
              </Form> : null}
              {dns.showRefresh ? <Form method="post">
                <input type="hidden" name="intent" value="refresh" />
                <s-button type="submit" loading={progress.intent === "refresh"} disabled={progress.submitting}>Atualizar status</s-button>
              </Form> : null}
              {dns.showTest ? <Form method="post">
                <input type="hidden" name="intent" value="test" />
                <s-button type="submit" loading={progress.intent === "test"} disabled={progress.submitting || !activeDomain?.sendingVerified || !settings?.activeFromEmail}>
                  Enviar teste para equipe
                </s-button>
              </Form> : null}
            </s-stack>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
