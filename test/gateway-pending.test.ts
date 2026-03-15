const test = require("node:test");
const assert = require("node:assert/strict");

const { PendingRequestStore } = require("../src/gateway-pending.ts");

test("PendingRequestStore rejects on timeout and clears the pending entry", async () => {
  const pending = new PendingRequestStore();
  let timedOut = null;

  await assert.rejects(
    new Promise((resolve, reject) => {
      pending.add("1", "connect", 20, resolve, reject, (method, timeoutMs) => {
        timedOut = { method, timeoutMs };
      });
    }),
    /timed out/
  );

  assert.deepEqual(timedOut, { method: "connect", timeoutMs: 20 });
  assert.equal(pending.size, 0);
});

test("PendingRequestStore.take clears the timer and removes the entry", async () => {
  const pending = new PendingRequestStore();

  const promise = new Promise((resolve, reject) => {
    pending.add("2", "node.invoke.result", 100, resolve, reject);
  });
  const entry = pending.take("2");
  assert.ok(entry);
  entry.resolve({ ok: true });

  const result = await promise;
  assert.deepEqual(result, { ok: true });
  assert.equal(pending.size, 0);
});
