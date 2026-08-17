import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
  createLatestRequestCoordinator,
  customerAccountRequest,
} from "./customer-account-request.js";

const API_URL = "shopify://customer-account/api/2026-07/graphql.json";

function response(data) {
  return {
    ok: true,
    async json() {
      return {data};
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

test("bootstrap renders the main tree directly without queueMicrotask", async () => {
  const source = await readFile(
    new URL("./MinhaAssinatura.jsx", import.meta.url),
    "utf8",
  );
  const bootstrap = source.slice(
    source.indexOf("export function bootstrapExtension"),
    source.indexOf("function renderInitializationError"),
  );

  assert.doesNotMatch(source, /queueMicrotask/);
  assert.match(
    bootstrap,
    /render\(\s*<ExtensionErrorBoundary>\s*<MinhaAssinatura \/>/,
  );
  assert.match(bootstrap, /catch \(error\) \{\s*renderInitializationError/);
});

test("a query that succeeds before the deadline returns its data", async () => {
  const data = await customerAccountRequest(API_URL, "query Test { customer { id } }", {}, {
    timeoutMs: 50,
    fetchImpl: async () => response({customer: {id: "gid://shopify/Customer/1"}}),
  });

  assert.equal(data.customer.id, "gid://shopify/Customer/1");
});

test("a pending query becomes a clear timeout error", async () => {
  await assert.rejects(
    customerAccountRequest(API_URL, "query Pending { customer { id } }", {}, {
      timeoutMs: 10,
      fetchImpl: () => new Promise(() => {}),
    }),
    /demorou mais de 8 segundos.*Tente novamente/,
  );
});

test("an API failure reaches the visible error callback", async () => {
  const states = [];
  const coordinator = createLatestRequestCoordinator();
  const result = await coordinator.run({
    request: async () => {
      throw new Error("Customer Account API: 500");
    },
    onLoading: () => states.push("loading"),
    onSuccess: () => states.push("ready"),
    onError: (error) => states.push(`error:${error.message}`),
  });

  assert.equal(result.status, "error");
  assert.deepEqual(states, ["loading", "error:Customer Account API: 500"]);
});

test("retry returns to loading and can complete", async () => {
  const states = [];
  const coordinator = createLatestRequestCoordinator();
  const callbacks = {
    onLoading: () => states.push("loading"),
    onSuccess: () => states.push("ready"),
    onError: () => states.push("error"),
  };

  await coordinator.run({
    ...callbacks,
    request: async () => {
      throw new Error("first attempt failed");
    },
  });
  await coordinator.run({...callbacks, request: async () => ["contract"]});

  assert.deepEqual(states, ["loading", "error", "loading", "ready"]);
});

test("a late response cannot overwrite a newer attempt", async () => {
  const first = deferred();
  const second = deferred();
  const values = [];
  const coordinator = createLatestRequestCoordinator();
  const callbacks = {
    onLoading: () => {},
    onSuccess: (value) => values.push(value),
    onError: (error) => values.push(error.message),
  };

  const firstRun = coordinator.run({
    ...callbacks,
    request: () => first.promise,
  });
  const secondRun = coordinator.run({
    ...callbacks,
    request: () => second.promise,
  });

  second.resolve("newest");
  await secondRun;
  first.resolve("stale");
  await firstRun;

  assert.deepEqual(values, ["newest"]);
});
