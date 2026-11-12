import test from "node:test";
import assert from "node:assert/strict";
import { parseSend } from "../api/_lib/validate.js";

const UUID = "2f1b8f0e-6c3a-4a53-9a1e-0b6f6c1d9a10";

test("rejects whitespace-only text", () => {
  const r = parseSend({ text: "  \n\t " }, "v");
  assert.deepEqual([r.ok, r.status], [false, 400]);
});

test("rejects 1001 code points", () => {
  assert.equal(parseSend({ text: "a".repeat(1001) }, "v").ok, false);
  assert.equal(parseSend({ text: "a".repeat(1000) }, "v").ok, true);
});

test("accepts 1000 emoji as 1000 code points", () => {
  assert.equal(parseSend({ text: "😀".repeat(1000) }, "v").ok, true);
  assert.equal(parseSend({ text: "😀".repeat(1001) }, "v").ok, false);
});

test("rejects 21-char name", () => {
  assert.equal(parseSend({ text: "hi", name: "가".repeat(21) }, "v").ok, false);
  assert.equal(parseSend({ text: "hi", name: "가".repeat(20) }, "v").ok, true);
});

test("defaults empty name to 방문자 and empty contact to null", () => {
  const r = parseSend({ text: "hi", name: "  ", contact: "" }, "v");
  assert.equal(r.value.name, "방문자");
  assert.equal(r.value.contact, null);
});

test("rejects 101-char contact", () => {
  assert.equal(parseSend({ text: "hi", contact: "c".repeat(101) }, "v").ok, false);
});

test("owner send requires uuid vid", () => {
  assert.equal(parseSend({ text: "hi" }, "o").ok, false);
  assert.equal(parseSend({ text: "hi", vid: "not-a-uuid" }, "o").ok, false);
  const r = parseSend({ text: "hi", vid: UUID }, "o");
  assert.equal(r.ok, true);
  assert.equal(r.value.vid, UUID);
});

test("visitor send ignores body vid", () => {
  const r = parseSend({ text: "hi", vid: UUID }, "v");
  assert.equal(r.ok, true);
  assert.equal(r.value.vid, undefined);
});

test("rejects non-object body and non-string text", () => {
  assert.equal(parseSend(null, "v").ok, false);
  assert.equal(parseSend({ text: 123 }, "v").ok, false);
});
