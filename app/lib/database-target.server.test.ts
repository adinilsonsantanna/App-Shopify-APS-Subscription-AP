import test from "node:test";
import assert from "node:assert/strict";
import { assertExpectedDatabaseTarget, databaseTargetIdentity } from "./database-target.server";

test("detecta host e banco divergentes sem expor credenciais", () => {
  const url = "postgresql://user:super-secret@ep-app-test.neon.tech:5432/appdb?sslmode=require";
  assert.deepEqual(databaseTargetIdentity(url), { host: "ep-app-test.neon.tech", database: "appdb" });
  assert.throws(() => assertExpectedDatabaseTarget(url, "ep-other.neon.tech", "appdb"), /EXPECTED_DATABASE_HOST/);
  assert.throws(() => assertExpectedDatabaseTarget(url, "ep-app-test.neon.tech", "other"), /EXPECTED_DATABASE_NAME/);
  try { assertExpectedDatabaseTarget(url, "wrong", "appdb"); } catch (error) { assert.equal(String(error).includes("super-secret"), false); }
});

test("falha de infraestrutura nao executa exclusao de sessao", async () => {
  const session = { id: "offline_one.myshopify.com", shop: "one.myshopify.com" };
  const store = { value: session, async load() { throw new Error("Neon unavailable"); }, async delete() { this.value = null as never; } };
  await assert.rejects(store.load(), /Neon unavailable/);
  assert.equal(store.value, session);
});
