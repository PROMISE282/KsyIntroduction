import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

const VISITOR_TTL = 365 * 24 * 3600 * 1000;
const OWNER_TTL = 7 * 24 * 3600 * 1000;

const sign = (body, secret) => createHmac("sha256", secret).update(body).digest("base64url");

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const want = Buffer.from(sign(parts[0], secret)), got = Buffer.from(parts[1]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString()); } catch { return null; }
  if (payload === null || typeof payload !== "object") return null;
  if (payload.exp !== undefined && payload.exp <= now) return null;
  return payload;
}

const readCookie = (request, name) => {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
};

const setCookie = (name, token, ttlMs) =>
  `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}`;

export function getVisitor(request, secret, now = Date.now()) {
  const p = verifyToken(readCookie(request, "pf_vid"), secret, now);
  if (p && typeof p.vid === "string") return { vid: p.vid, setCookie: null };
  const vid = randomUUID();
  return { vid, setCookie: setCookie("pf_vid", signToken({ vid, exp: now + VISITOR_TTL }, secret), VISITOR_TTL) };
}

export function ownerCookie(secret, now = Date.now()) {
  return setCookie("pf_owner", signToken({ role: "o", exp: now + OWNER_TTL }, secret), OWNER_TTL);
}

export function isOwner(request, secret, now = Date.now()) {
  const p = verifyToken(readCookie(request, "pf_owner"), secret, now);
  return !!p && p.role === "o";
}
