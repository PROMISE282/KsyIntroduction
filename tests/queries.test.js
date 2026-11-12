import test from "node:test";
import assert from "node:assert/strict";
import { visitorThreadQuery, ownerAllQuery } from "../api/_lib/queries.js";

const UUID = "2f1b8f0e-6c3a-4a53-9a1e-0b6f6c1d9a10";
const COLS = "id, vid, from_role, name, contact, text, ts";

test("visitorThreadQuery filters by the given vid only", () => {
  const q = visitorThreadQuery(UUID);
  assert.ok(q.sql.includes(`SELECT ${COLS} FROM messages`));
  assert.ok(q.sql.includes("WHERE vid = $1::uuid"));
  assert.ok(q.sql.includes("LIMIT 200"));
  assert.equal(q.parameters.length, 1);
  assert.equal(q.parameters[0].value, UUID);
});

test("ownerAllQuery selects all threads without parameters", () => {
  const q = ownerAllQuery();
  assert.ok(q.sql.includes(`SELECT ${COLS} FROM messages`));
  assert.ok(q.sql.includes("ORDER BY ts DESC LIMIT 1000"));
  assert.ok(!q.sql.includes("WHERE"));
  assert.equal(q.parameters.length, 0);
});
