import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { copyDnsValue } from "./notification-clipboard";
import { buildNotificationDnsState } from "./notification-dns-ui";

const routeSource = readFileSync(
  new URL("../routes/app.notifications.tsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(
  new URL("../styles/notification-dns.module.css", import.meta.url),
  "utf8",
);

test("long DKIM remains complete and is never truncated", async () => {
  const dkim = `p=${"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/".repeat(24)}==`;
  let copied = "";
  const result = await copyDnsValue(dkim, {
    writeText: async (value) => {
      copied = value;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(copied, dkim);
  assert.doesNotMatch(routeSource, /\.slice\(|text-overflow|ellipsis/);
});

test("DNS host and value use safe wrapping without horizontal record scrolling", () => {
  assert.match(cssSource, /overflow-wrap:\s*anywhere/);
  assert.match(cssSource, /word-break:\s*break-word/);
  assert.match(cssSource, /white-space:\s*normal/);
  assert.match(cssSource, /\.recordsContainer[\s\S]*overflow:\s*hidden/);
  assert.match(cssSource, /@media\s*\(max-width:\s*64rem\)/);
  assert.match(cssSource, /\.desktopRecords[\s\S]*display:\s*none/);
  assert.match(cssSource, /\.mobileRecords[\s\S]*display:\s*grid/);
});

test("Copiar host writes the exact host without normalization", async () => {
  const host = "Resend._domainkey.Example.COM.";
  const values: string[] = [];
  await copyDnsValue(host, {
    writeText: async (value) => {
      values.push(value);
    },
  });
  assert.deepEqual(values, [host]);
});

test("Copiar valor writes the exact DNS value including spaces and symbols", async () => {
  const value = "v=DKIM1; k=rsa; p=ABC+/==  exact";
  const values: string[] = [];
  await copyDnsValue(value, {
    writeText: async (copied) => {
      values.push(copied);
    },
  });
  assert.deepEqual(values, [value]);
});

test("successful copy returns visual feedback and route restores labels", async () => {
  const result = await copyDnsValue("host", {
    writeText: async () => undefined,
  });
  assert.deepEqual(result, { ok: true, message: "Copiado" });
  assert.match(routeSource, /copyFeedback\?\.ok/);
  assert.match(routeSource, /setTimeout\(\(\) => setCopyFeedback\(null\), 2_000\)/);
  assert.match(routeSource, /Copiar host/);
  assert.match(routeSource, /Copiar valor/);
});

test("Clipboard API failure becomes a recoverable message", async () => {
  const result = await copyDnsValue("host", {
    writeText: async () => {
      throw new Error("denied");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Selecione o valor manualmente/);
  assert.match(routeSource, /Não foi possível copiar/);
});

test("empty DNS values cannot be copied", async () => {
  let calls = 0;
  const result = await copyDnsValue("", {
    writeText: async () => {
      calls++;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
  assert.match(routeSource, /disabled=\{!record\.value\}/);
  assert.match(routeSource, /disabled=\{!record\.name\}/);
});

test("record without priority or TTL omits optional mobile fields and remains readable", () => {
  assert.match(routeSource, /record\.priority != null \?/);
  assert.match(routeSource, /record\.ttl \?/);
  assert.match(routeSource, /record\.priority \?\? "—"/);
  assert.match(routeSource, /record\.ttl \|\| "—"/);
});

test("PENDING verify and refresh actions remain enabled and no private secret is rendered", () => {
  const state = buildNotificationDnsState(
    {
      shopId: "shop",
      fromName: "Loja",
      fromEmail: "mail@example.com",
      replyTo: null,
      teamEmails: [],
      teamFrequency: "NEVER",
      customerNotificationsEnabled: false,
    },
    [
      {
        id: "domain",
        domain: "example.com",
        status: "pending",
        sendingVerified: false,
        records: [],
      },
    ],
  );
  assert.equal(state.state, "PENDING");
  assert.equal(state.showVerify, true);
  assert.equal(state.showRefresh, true);
  assert.match(routeSource, />Verificar DNS<\/s-button>/);
  assert.match(routeSource, />Atualizar status<\/s-button>/);
  assert.match(routeSource, /heading="Notificações transacionais"/);
  assert.match(routeSource, /title: "Notificações transacionais"/);
  for (const secret of [
    "RESEND_API_KEY",
    "apiKeyId",
    "providerDomainId",
    "webhookSecret",
    "encryptedApiKey",
  ]) {
    assert.equal(routeSource.includes(secret), false);
  }
});
