import test from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, getVisitor, ownerCookie, isOwner } from "../api/_lib/session.js";

const SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
const cookieHeader = setCookie => setCookie.split(";")[0];
const reqWith = cookie => new Request("https://example.test/api/live", { headers: cookie ? { cookie } : {} });

test("verifyToken rejects tampered signature", () => {
  const t = signToken({ vid: "x" }, SECRET);
  const bad = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
  assert.equal(verifyToken(bad, SECRET), null);
});

test("verifyToken rejects expired token", () => {
  const t = signToken({ vid: "x", exp: 1000 }, SECRET);
  assert.equal(verifyToken(t, SECRET, 1000), null);
  assert.deepEqual(verifyToken(t, SECRET, 999), { vid: "x", exp: 1000 });
});

test("getVisitor reuses a valid cookie", () => {
  const first = getVisitor(reqWith(null), SECRET);
  const second = getVisitor(reqWith(cookieHeader(first.setCookie)), SECRET);
  assert.equal(second.vid, first.vid);
  assert.equal(second.setCookie, null);
});

test("getVisitor issues a new vid for a forged cookie", () => {
  const forged = getVisitor(reqWith(null), "another-secret-bbbbbbbbbbbbbbbbbbbbbb");
  const res = getVisitor(reqWith(cookieHeader(forged.setCookie)), SECRET);
  assert.notEqual(res.vid, forged.vid);
  assert.ok(res.setCookie);
});

test("getVisitor issues a new vid when no cookie", () => {
  const res = getVisitor(reqWith(null), SECRET);
  assert.match(res.vid, /^[0-9a-f-]{36}$/);
  assert.ok(res.setCookie.startsWith("pf_vid="));
});

test("ownerCookie is httpOnly Secure SameSite=Lax", () => {
  const c = ownerCookie(SECRET);
  assert.ok(c.startsWith("pf_owner="));
  for (const attr of ["HttpOnly", "Secure", "SameSite=Lax"]) assert.ok(c.includes(attr), attr);
});

test("isOwner is false for visitor cookie and true for owner cookie", () => {
  const visitor = getVisitor(reqWith(null), SECRET);
  assert.equal(isOwner(reqWith(cookieHeader(visitor.setCookie)), SECRET), false);
  assert.equal(isOwner(reqWith(cookieHeader(ownerCookie(SECRET))), SECRET), true);
  assert.equal(isOwner(reqWith(null), SECRET), false);
});
