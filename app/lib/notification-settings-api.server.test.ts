import assert from "node:assert/strict";
import test from "node:test";
import {
  getNotificationSettings,
  saveNotificationSettings,
  domainAction,
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
