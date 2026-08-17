import assert from "node:assert/strict";
import test from "node:test";
import {
  contractActions,
  mutationErrorFeedback,
  resolvePageState,
} from "./subscription-page-state.js";

test("shows loading before the asynchronous query finishes", () => {
  assert.equal(resolvePageState(null, false), "loading");
});

test("shows an API error instead of a blank page", () => {
  assert.equal(resolvePageState([], true), "error");
});

test("shows the empty state when the customer has no contracts", () => {
  assert.equal(resolvePageState([], false), "empty");
});

test("an active contract exposes pause and cancel", () => {
  assert.equal(resolvePageState([{status: "ACTIVE"}], false), "ready");
  assert.deepEqual(contractActions("ACTIVE"), ["pause", "cancel"]);
});

test("a paused contract exposes activate and cancel", () => {
  assert.equal(resolvePageState([{status: "PAUSED"}], false), "ready");
  assert.deepEqual(contractActions("PAUSED"), ["activate", "cancel"]);
});

test("a mutation failure becomes visible critical feedback", () => {
  assert.deepEqual(mutationErrorFeedback(new Error("Falha da mutation")), {
    tone: "critical",
    message: "Falha da mutation",
  });
});
