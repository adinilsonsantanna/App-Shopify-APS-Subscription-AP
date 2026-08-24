import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ActionFunctionArgs } from "react-router";
import {
  buildNotificationDnsState,
  notificationActionProgress,
} from "./notification-dns-ui";
import { createNotificationPageAction } from "./notification-page-action.server";
import {
  getSendingDomains,
  type NotificationSettings,
  type SendingDomain,
} from "./notification-settings-api.server";

const settings = (overrides: Partial<NotificationSettings> = {}) => ({
  shopId: "session-shop.myshopify.com",
  fromName: "Loja",
  fromEmail: "mail@example.com",
  replyTo: "reply@example.com",
  teamEmails: ["team@example.com"],
  teamFrequency: "NEVER",
  customerNotificationsEnabled: false,
  ...overrides,
});

const pendingDomain = (overrides: Partial<SendingDomain> = {}) => ({
  id: "domain-public-id",
  domain: "example.com",
  status: "pending",
  sendingVerified: false,
  lastCheckedAt: "2026-08-24T12:00:00.000Z",
  records: [
    {
      purpose: "DKIM",
      type: "CNAME",
      name: "resend._domainkey",
      value: "example.dkim.resend.com",
      priority: 10,
      ttl: "Auto",
      status: "pending",
    },
  ],
  ...overrides,
});

const actionArgs = (intent: string) =>
  ({
    request: new Request("https://app.example/app/notifications", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ intent }),
    }),
    params: {},
    context: {},
  }) as unknown as ActionFunctionArgs;

test("NOT_CONFIGURED shows Iniciar configuração DNS only after sender is saved", () => {
  const ready = buildNotificationDnsState(settings(), []);
  const missingSender = buildNotificationDnsState(
    settings({ fromEmail: null }),
    [],
  );
  assert.equal(ready.state, "NOT_CONFIGURED");
  assert.equal(ready.showSetup, true);
  assert.equal(ready.showPendingSender, false);
  assert.equal(missingSender.showSetup, false);
  const source = readFileSync(
    new URL("../routes/app.notifications.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, />Iniciar configuração DNS<\/s-button>/);
});

test("clicking Iniciar configuração DNS submits setup for the authenticated session shop", async () => {
  const calls: Array<{ shop: string; intent: string }> = [];
  const action = createNotificationPageAction({
    authenticateAdmin: async () => ({
      session: { shop: "session-shop.myshopify.com" },
    }),
    domainAction: async (shop, intent) => {
      calls.push({ shop, intent });
    },
    saveSettings: async () => settings(),
    sendTest: async () => undefined,
  });
  const result = await action(actionArgs("setup"));
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { shop: "session-shop.myshopify.com", intent: "setup" },
  ]);
});

test("PENDING exposes public records plus verify and refresh actions", () => {
  const state = buildNotificationDnsState(settings(), [pendingDomain()]);
  assert.equal(state.state, "PENDING");
  assert.equal(state.showVerify, true);
  assert.equal(state.showRefresh, true);
  assert.equal(state.showTest, false);
  assert.deepEqual(state.domain?.records[0], pendingDomain().records[0]);
});

test("public DNS records survive the allowlist and provider secrets do not", async () => {
  const domains = await getSendingDomains("session-shop.myshopify.com", {
    baseUrl: "https://central.test",
    apiKey: "internal-app-key",
    fetchFn: async () =>
      Response.json({
        success: true,
        data: [
          {
            ...pendingDomain(),
            providerDomainId: "provider-secret",
            apiKeyId: "key-secret",
            encryptedApiKey: "cipher-secret",
            webhookSecret: "webhook-secret",
          },
        ],
      }),
  });
  assert.deepEqual(domains[0].records, pendingDomain().records);
  const serialized = JSON.stringify(domains);
  for (const secret of [
    "providerDomainId",
    "apiKeyId",
    "encryptedApiKey",
    "webhookSecret",
    "provider-secret",
    "key-secret",
    "cipher-secret",
    "webhook-secret",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("VERIFIED shows active sender and enables test action", () => {
  const domain = pendingDomain({ status: "verified", sendingVerified: true });
  const state = buildNotificationDnsState(
    settings({
      activeFromEmail: "mail@example.com",
      activeSendingDomain: {
        id: domain.id,
        domain: domain.domain,
        status: domain.status,
        sendingVerified: true,
      },
    }),
    [domain],
  );
  assert.equal(state.state, "VERIFIED");
  assert.equal(state.showTest, true);
  assert.equal(state.showVerify, false);
});

test("FAILED and TEMPORARY_ERROR remain recoverable with records and actions", () => {
  for (const status of ["failed", "temporary_error"]) {
    const state = buildNotificationDnsState(settings(), [
      pendingDomain({ status }),
    ]);
    assert.equal(state.state, "RECOVERABLE_ERROR");
    assert.equal(state.recoverableError, true);
    assert.equal(state.showVerify, true);
    assert.equal(state.showRefresh, true);
    assert.equal(state.domain?.records.length, 1);
  }
});

test("API action failure returns a readable recoverable error without secrets", async () => {
  const action = createNotificationPageAction({
    authenticateAdmin: async () => ({
      session: { shop: "session-shop.myshopify.com" },
    }),
    domainAction: async () => {
      throw new Error("RESEND_API_KEY=re_secret");
    },
    saveSettings: async () => settings(),
    sendTest: async () => undefined,
  });
  const result = await action(actionArgs("verify"));
  assert.equal(result.ok, false);
  assert.match(result.message, /Tente novamente/);
  assert.doesNotMatch(result.message, /re_secret|RESEND_API_KEY/);
});

test("submitting one DNS intent blocks duplicate actions and marks only it loading", () => {
  const form = new FormData();
  form.set("intent", "setup");
  const progress = notificationActionProgress("submitting", form);
  assert.equal(progress.submitting, true);
  assert.equal(progress.intent, "setup");
  assert.equal(progress.intent === "setup", true);
  assert.notEqual(progress.intent, "verify");
});

test("public route source and state JSON contain no credential fields", () => {
  const source = readFileSync(
    new URL("../routes/app.notifications.tsx", import.meta.url),
    "utf8",
  );
  const publicJson = JSON.stringify(
    buildNotificationDnsState(settings(), [pendingDomain()]),
  );
  for (const field of [
    "RESEND_API_KEY",
    "apiKeyId",
    "providerDomainId",
    "webhookSecret",
    "encryptedApiKey",
  ]) {
    assert.equal(source.includes(field), false);
    assert.equal(publicJson.includes(field), false);
  }
});
