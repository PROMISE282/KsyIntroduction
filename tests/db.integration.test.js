import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSql, insertMessage, checkLoginThrottle, recordLoginFailure } from "../api/_lib/db.js";

const opts = { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" };
const msg = (vid, from = "v", text = "hi") => ({ vid, from, name: "방문자", contact: null, text });

async function withVid(fn) {
  const sql = getSql(), vid = randomUUID();
  try { await fn(sql, vid); } finally { await sql.query("delete from messages where vid = $1::uuid", [vid]); }
}

test("inserts and returns txid", opts, () => withVid(async (sql, vid) => {
  const r = await insertMessage(sql, msg(vid));
  assert.equal(r.ok, true);
  assert.match(r.txid, /^\d+$/);
}));

test("visitor second message within 2s returns too_fast", opts, () => withVid(async (sql, vid) => {
  assert.equal((await insertMessage(sql, msg(vid))).ok, true);
  assert.deepEqual(await insertMessage(sql, msg(vid)), { ok: false, code: "too_fast" });
}));

test("visitor 201st message returns limit", opts, () => withVid(async (sql, vid) => {
  await sql.query(
    "insert into messages (vid, from_role, text, ts) select $1::uuid, 'v', 'm' || g, now() - interval '1 hour' from generate_series(1, 200) g",
    [vid]
  );
  assert.deepEqual(await insertMessage(sql, msg(vid)), { ok: false, code: "limit" });
}));

test("owner reply is not rate limited", opts, () => withVid(async (sql, vid) => {
  assert.equal((await insertMessage(sql, msg(vid, "v"))).ok, true);
  assert.equal((await insertMessage(sql, msg(vid, "o", "r1"))).ok, true);
  assert.equal((await insertMessage(sql, msg(vid, "o", "r2"))).ok, true);
}));

test("login throttle blocks after 5 failures", opts, async () => {
  const sql = getSql(), ip = "test-" + randomUUID();
  try {
    for (let i = 0; i < 4; i++) await recordLoginFailure(sql, ip);
    assert.equal(await checkLoginThrottle(sql, ip), true);
    await recordLoginFailure(sql, ip);
    assert.equal(await checkLoginThrottle(sql, ip), false);
  } finally { await sql.query("delete from owner_login_failures where ip = $1", [ip]); }
});
