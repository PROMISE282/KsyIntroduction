import test from "node:test";
import assert from "node:assert/strict";
import { makeHandlers } from "../api/_lib/handlers.js";
import { ownerCookie } from "../api/_lib/session.js";

const SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
const PASSWORD = "correct-horse-battery-staple";
const OTHER_VID = "2f1b8f0e-6c3a-4a53-9a1e-0b6f6c1d9a10";
const env = { SESSION_SECRET: SECRET, OWNER_PASSWORD: PASSWORD };

function setup(state = {}) {
  const s = { insertRows: [{ txid: "42" }], count: 0, failures: 0, inserts: [], failureWrites: 0, ...state };
  const sql = {
    async query(text, params) {
      if (text.includes("INSERT INTO messages")) { s.inserts.push(params); return s.insertRows; }
      if (text.includes("FROM messages")) return [{ n: s.count }];
      if (text.includes("SELECT count(*)::int AS n FROM owner_login_failures")) return [{ n: s.failures }];
      if (text.includes("INSERT INTO owner_login_failures")) { s.failureWrites++; return []; }
      throw new Error("unexpected sql: " + text);
    }
  };
  const realtime = { async seal({ query }) { return { token: "sealed", query }; } };
  return { s, h: makeHandlers({ env, sql: () => sql, realtime: () => realtime }) };
}

const post = (path, body, { cookie, origin = "https://site.test", ip } = {}) =>
  new Request("https://site.test" + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}), ...(ip ? { "x-forwarded-for": ip } : {}) },
    body: JSON.stringify(body)
  });
const cookieOf = res => res.headers.get("set-cookie").split(";")[0];
const OWNER = { cookie: cookieOf({ headers: new Headers({ "set-cookie": ownerCookie(SECRET) }) }) };

test("live returns sealed visitor query and sets vid cookie", async () => {
  const { h } = setup();
  const res = await h.live(post("/api/live", {}));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sealed.query.parameters[0].value, body.vid);
  assert.ok(res.headers.get("set-cookie").startsWith("pf_vid="));
});

test("live owner scope without owner cookie is 401", async () => {
  const { h } = setup();
  assert.equal((await h.live(post("/api/live", { scope: "owner" }))).status, 401);
});

test("live owner scope with owner cookie seals the all-threads query", async () => {
  const { h } = setup();
  const res = await h.live(post("/api/live", { scope: "owner" }, OWNER));
  assert.equal(res.status, 200);
  assert.ok((await res.json()).sealed.query.sql.includes("LIMIT 1000"));
});

test("send as visitor uses cookie vid not body vid", async () => {
  const { h, s } = setup();
  const live = await h.live(post("/api/live", {}));
  const { vid } = await live.json();
  const res = await h.send(post("/api/send", { text: "hello", vid: OTHER_VID }, { cookie: cookieOf(live) }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { kind: "committed", txid: "42" });
  assert.equal(s.inserts[0][0], vid);
  assert.equal(s.inserts[0][1], "v");
});

test("send as owner without vid is 400", async () => {
  const { h } = setup();
  assert.equal((await h.send(post("/api/send", { text: "hi", as: "owner" }, OWNER))).status, 400);
});

test("send as owner with non-uuid vid is 400", async () => {
  const { h } = setup();
  assert.equal((await h.send(post("/api/send", { text: "hi", as: "owner", vid: "nope" }, OWNER))).status, 400);
});

test("send as owner with vid inserts an owner reply", async () => {
  const { h, s } = setup();
  const res = await h.send(post("/api/send", { text: "hi", as: "owner", vid: OTHER_VID }, OWNER));
  assert.equal(res.status, 200);
  assert.deepEqual([s.inserts[0][0], s.inserts[0][1]], [OTHER_VID, "o"]);
});

test("send as owner without owner cookie is 401", async () => {
  const { h } = setup();
  assert.equal((await h.send(post("/api/send", { text: "hi", as: "owner", vid: OTHER_VID }))).status, 401);
});

test("send with foreign Origin is 403", async () => {
  const { h, s } = setup();
  const res = await h.send(post("/api/send", { text: "hi" }, { origin: "https://evil.test" }));
  assert.equal(res.status, 403);
  assert.equal(s.inserts.length, 0);
});

test("send returns 429 too_fast", async () => {
  const { h } = setup({ insertRows: [], count: 1 });
  const cookie = cookieOf(await h.live(post("/api/live", {})));
  const res = await h.send(post("/api/send", { text: "hi" }, { cookie }));
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: "too_fast" });
});

test("send without a vid cookie is 403 cookie_required and inserts nothing", async () => {
  const { h, s } = setup();
  const res = await h.send(post("/api/send", { text: "hi" }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "cookie_required" });
  assert.equal(s.inserts.length, 0);
});

test("send with a forged vid cookie is 403 cookie_required", async () => {
  const { h, s } = setup();
  const res = await h.send(post("/api/send", { text: "hi" }, { cookie: "pf_vid=forged.token" }));
  assert.equal(res.status, 403);
  assert.equal(s.inserts.length, 0);
});

test("send returns 400 for invalid text", async () => {
  const { h } = setup();
  assert.equal((await h.send(post("/api/send", { text: "   " }))).status, 400);
});

test("login with wrong password is 401 login_failed and is recorded", async () => {
  const { h, s } = setup();
  const res = await h.ownerLogin(post("/api/owner/login", { password: "wrong" }, { ip: "1.2.3.4" }));
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "login_failed" });
  assert.equal(s.failureWrites, 1);
});

test("login with correct password sets owner cookie", async () => {
  const { h } = setup();
  const res = await h.ownerLogin(post("/api/owner/login", { password: PASSWORD }));
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("set-cookie").startsWith("pf_owner="));
});

test("login is 429 after 5 failures even with the right password", async () => {
  const { h } = setup({ failures: 5 });
  const res = await h.ownerLogin(post("/api/owner/login", { password: PASSWORD }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("session reports owner true only with owner cookie", async () => {
  const { h } = setup();
  const get = cookie => new Request("https://site.test/api/owner/session", { headers: cookie ? { cookie } : {} });
  assert.deepEqual(await (await h.ownerSession(get(null))).json(), { owner: false });
  assert.deepEqual(await (await h.ownerSession(get(OWNER.cookie))).json(), { owner: true });
});

test("missing SESSION_SECRET gives 500 without leaking details", async () => {
  const h = makeHandlers({ env: {}, sql: () => ({}), realtime: () => ({}) });
  const res = await h.live(post("/api/live", {}));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "server_error" });
});
