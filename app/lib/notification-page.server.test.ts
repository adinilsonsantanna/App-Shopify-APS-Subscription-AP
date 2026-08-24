import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { LoaderFunctionArgs } from "react-router";
import { embeddedAppPath } from "./embedded-navigation";
import { createNotificationPageLoader } from "./notification-page.server";
import { getNotificationSettings } from "./notification-settings-api.server";

const settings = {
  shopId: "session-shop.myshopify.com",
  fromName: null,
  fromEmail: null,
  replyTo: null,
  teamEmails: [],
  teamFrequency: "NEVER",
  customerNotificationsEnabled: false,
};

const loaderArgs = (url: string) =>
  ({
    request: new Request(url),
    params: {},
    context: {},
  }) as unknown as LoaderFunctionArgs;

test("clicking Editar notificações uses an internal embedded route and preserves shop and host", () => {
  const href = embeddedAppPath(
    new Request(
      "https://app.example/app/settings?shop=betterlife.myshopify.com&host=encoded-host&embedded=1&untrusted=drop",
    ),
    "/app/notifications",
  );
  assert.equal(
    href,
    "/app/notifications?shop=betterlife.myshopify.com&host=encoded-host&embedded=1",
  );
  assert.equal(href.startsWith("https://"), false);
  const settingsRoute = readFileSync(
    new URL("../routes/app.settings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    settingsRoute,
    /<s-link href=\{notificationsUrl\}>Editar notificações<\/s-link>/,
  );
  assert.doesNotMatch(settingsRoute, /notificationsUrl[^>]*target="_top"/);
});

test("authenticated notifications loader returns renderable page data", async () => {
  const loader = createNotificationPageLoader({
    authenticateAdmin: async () => ({ session: { shop: settings.shopId } }),
    getSettings: async () => settings,
    getDomains: async () => [],
  });
  const result = await loader(
    loaderArgs("https://app.example/app/notifications"),
  );
  assert.equal(result.settings?.shopId, settings.shopId);
  assert.deepEqual(result.domains, []);
  assert.equal(result.loadError, null);
});

test("a successful API Response surfaced by an adapter is treated as data, not an ErrorBoundary response", async () => {
  const result = await getNotificationSettings(settings.shopId, {
    baseUrl: "https://central.test",
    apiKey: "secret",
    fetchFn: async () => {
      throw Response.json({ success: true, data: settings });
    },
  });
  assert.equal(result.shopId, settings.shopId);
});

test("missing session preserves the official authenticate.admin response", async () => {
  const authenticationResponse = new Response(null, {
    status: 302,
    headers: { location: "/auth/login" },
  });
  const loader = createNotificationPageLoader({
    authenticateAdmin: async () => {
      throw authenticationResponse;
    },
    getSettings: async () => settings,
    getDomains: async () => [],
  });
  await assert.rejects(
    loader(loaderArgs("https://app.example/app/notifications")),
    (error) => error === authenticationResponse,
  );
});

test("API failure becomes a recoverable message without exposing its details", async () => {
  const loader = createNotificationPageLoader({
    authenticateAdmin: async () => ({ session: { shop: settings.shopId } }),
    getSettings: async () => {
      throw new Error("provider token super-secret");
    },
    getDomains: async () => [],
  });
  const result = await loader(
    loaderArgs("https://app.example/app/notifications"),
  );
  assert.match(result.loadError || "", /Recarregue a página/);
  assert.doesNotMatch(result.loadError || "", /super-secret/);
});

test("loader scopes API calls to the authenticated session shop, never the browser shop", async () => {
  const calls: string[] = [];
  const loader = createNotificationPageLoader({
    authenticateAdmin: async () => ({ session: { shop: settings.shopId } }),
    getSettings: async (shop) => {
      calls.push(shop);
      return settings;
    },
    getDomains: async (shop) => {
      calls.push(shop);
      return [];
    },
  });
  await loader(
    loaderArgs(
      "https://app.example/app/notifications?shop=attacker.myshopify.com&host=encoded-host",
    ),
  );
  assert.deepEqual(calls, [settings.shopId, settings.shopId]);
});
