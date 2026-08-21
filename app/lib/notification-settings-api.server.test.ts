import assert from "node:assert/strict";
import test from "node:test";
import {
  getNotificationSettings,
  saveNotificationSettings,
  domainAction,
  getSendingDomains,
  sendNotificationTest,
} from "./notification-settings-api.server";
const deps = (calls: any[]) => ({
  baseUrl: "https://central.test",
  apiKey: "secret",
  fetchFn: async (input: any, init?: any) => {
    calls.push({ input: String(input), init });
    return Response.json({ success: true, data: { shopId: "one" } });
  },
});
test("notification API scopes every request to the authenticated server shop", async () => {
  const calls: any[] = [],
    d = deps(calls);
  await getNotificationSettings("one.myshopify.com", d);
  await saveNotificationSettings("one.myshopify.com", { fromName: "One" }, d);
  await domainAction("one.myshopify.com", "verify", d);
  await sendNotificationTest("one.myshopify.com", d);
  assert.equal(
    calls.every((call) => call.input.includes("one.myshopify.com")),
    true,
  );
  assert.equal(
    calls.every((call) => call.init.headers["x-api-key"] === "secret"),
    true,
  );
});
test("notification API does not expose provider payload on error", async () => {
  await assert.rejects(
    getNotificationSettings("one.myshopify.com", {
      baseUrl: "https://central.test",
      apiKey: "secret",
      fetchFn: async () =>
        Response.json(
          {
            success: false,
            error: "sender_not_verified",
            provider: { token: "secret" },
          },
          { status: 409 },
        ),
    }),
    /sender_not_verified/,
  );
});
test("domain response is recursively allowlisted before it can reach the loader", async () => { const domains = await getSendingDomains("one.myshopify.com", { baseUrl: "https://central.test", apiKey: "secret", fetchFn: async () => Response.json({ success: true, data: [{ id: "d1", domain: "example.com", status: "verified", sendingVerified: true, providerDomainId: "provider-secret", encryptedApiKey: "ciphertext", apiKeyId: "key-secret", records: [{ id: "internal", purpose: "DKIM", type: "CNAME", name: "key", value: "target", status: "verified", token: "secret" }] }] }) }); const serialized = JSON.stringify(domains); for (const field of ["providerDomainId", "encryptedApiKey", "apiKeyId", "token", "internal"]) assert.equal(serialized.includes(field), false); assert.equal(domains[0].records[0].value, "target"); });
