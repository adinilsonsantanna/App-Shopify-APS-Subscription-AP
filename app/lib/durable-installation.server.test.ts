import test from "node:test";
import assert from "node:assert/strict";
import { syncAuthenticatedInstallation } from "./durable-installation.server";

const session = { shop: "one.myshopify.com", accessToken: "secret-token", scope: "read_products" };
function admin(shop = { id: "gid://shopify/Shop/1", name: "One", myshopifyDomain: "one.myshopify.com" }) { return { graphql: async () => Response.json({ data: { shop } }) }; }

test("instalação autenticada sincroniza domínio e shopId validados", async () => { let payload: any; await syncAuthenticatedInstallation(session, admin(), { syncShop: async (value) => { payload = value; return value; } }); assert.equal(payload.shopifyShopId, "gid://shopify/Shop/1"); assert.equal(payload.domain, session.shop); assert.equal(payload.accessToken, session.accessToken); });
test("reinstalação autenticada reutiliza a mesma identidade", async () => { const calls: any[] = []; const sync = { syncShop: async (value: any) => { calls.push(value); return value; } }; await syncAuthenticatedInstallation(session, admin(), sync); await syncAuthenticatedInstallation(session, admin(), sync); assert.deepEqual(calls[0], calls[1]); });
test("sessão inválida nunca sincroniza instalação", async () => { let calls = 0; await assert.rejects(syncAuthenticatedInstallation({ ...session, accessToken: undefined }, admin(), { syncShop: async () => { calls += 1; } } as any), /no access token/); assert.equal(calls, 0); });
test("domínio autenticado incompatível com shopId nunca sincroniza", async () => { let calls = 0; await assert.rejects(syncAuthenticatedInstallation(session, admin({ id: "gid://shopify/Shop/1", name: "Other", myshopifyDomain: "other.myshopify.com" }), { syncShop: async () => { calls += 1; } } as any), /does not match/); assert.equal(calls, 0); });
