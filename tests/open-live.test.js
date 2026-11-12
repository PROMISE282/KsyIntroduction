import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createLiveOpener } from "../web/open-live.js";

const NOW = 1_000_000;

function fakeClient() {
  const subs = [];
  return {
    subs,
    subscribe(sealed) {
      const s = {
        sealed, renewCalls: [], unsubscribed: false, changeFns: [], stateFns: [],
        onChange(f) { this.changeFns.push(f); },
        onStateChange(f) { this.stateFns.push(f); },
        async renew(next) { this.renewCalls.push(next); },
        unsubscribe() { this.unsubscribed = true; },
        async awaitTxId() {},
        emit(state) { this.stateFns.forEach(f => f(state)); }
      };
      subs.push(s);
      return s;
    }
  };
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function setup(sealedFor) {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const client = fakeClient(), statuses = [];
  let calls = 0;
  const fetchSealed = async () => sealedFor(calls++);
  const opener = createLiveOpener({ getClient: () => client, dropClient: () => {}, report: s => statuses.push(s) });
  const stop = opener.openLive(fetchSealed, () => {});
  return { client, statuses, stop, opener, calls: () => calls };
}

test.afterEach(() => mock.timers.reset());

test("subscribes with the sealed query and reports connecting then live", async () => {
  const { client, statuses, stop } = setup(() => ({ queryFingerprint: "A", expiresAt: Date.now() + 60_000 }));
  await flush();
  assert.equal(client.subs.length, 1);
  assert.equal(client.subs[0].sealed.queryFingerprint, "A");
  client.subs[0].emit({ status: "live" });
  assert.deepEqual(statuses, ["connecting", "live"]);
  stop();
  assert.equal(client.subs[0].unsubscribed, true);
});

test("renewal waits at least 5s even when the client clock is far ahead of the server", async () => {
  // 서버 시계 기준 만료가 클라이언트에는 이미 지난 시각으로 보이는 경우
  const { client, stop, calls } = setup(() => ({ queryFingerprint: "A", expiresAt: Date.now() - 40_000 }));
  await flush(); client.subs[0].emit({ status: "live" });
  assert.equal(calls(), 1);
  mock.timers.tick(4_999); await flush();
  assert.equal(calls(), 1);
  mock.timers.tick(1); await flush();
  assert.equal(calls(), 2);
  stop();
});

test("renewal happens within 45s even when the client clock is behind the server", async () => {
  const { client, stop, calls } = setup(() => ({ queryFingerprint: "A", expiresAt: Date.now() + 500_000 }));
  await flush(); client.subs[0].emit({ status: "live" });
  mock.timers.tick(44_999); await flush();
  assert.equal(calls(), 1);
  mock.timers.tick(1); await flush();
  assert.equal(calls(), 2);
  stop();
});

test("a renewed query with a different fingerprint resubscribes instead of renewing", async () => {
  const { client, stop } = setup(n => ({ queryFingerprint: n === 0 ? "A" : "B", expiresAt: Date.now() + 60_000 }));
  await flush(); client.subs[0].emit({ status: "live" });
  mock.timers.tick(45_000); await flush();
  assert.equal(client.subs[0].renewCalls.length, 0);
  assert.equal(client.subs[0].unsubscribed, true);
  assert.equal(client.subs.length, 2);
  assert.equal(client.subs[1].sealed.queryFingerprint, "B");
  stop();
});

test("a failed fetch keeps retrying with backoff and reports error after 3 failures", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const statuses = [];
  const opener = createLiveOpener({ getClient: () => fakeClient(), dropClient: () => {}, report: s => statuses.push(s) });
  const stop = opener.openLive(async () => { throw new Error("down"); }, () => {});
  await flush();
  mock.timers.tick(3_000); await flush();
  mock.timers.tick(6_000); await flush();
  assert.deepEqual(statuses, ["connecting", "connecting", "error"]);
  stop();
});
