import { createHash, timingSafeEqual } from "node:crypto";
import { getVisitor, isOwner, ownerCookie } from "./session.js";
import { parseSend } from "./validate.js";
import { insertMessage, checkLoginThrottle, recordLoginFailure } from "./db.js";
import { visitorThreadQuery, ownerAllQuery } from "./queries.js";
import { json, sameOrigin } from "./http.js";

const digest = s => createHash("sha256").update(String(s)).digest();
const clientIp = request => (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
const readJson = async request => { try { return await request.json(); } catch { return null; } };

// deps: { env, sql: () => sql, realtime: () => realtime } so tests can swap the DB and Realtime.
export function makeHandlers(deps) {
  const secret = () => {
    if (!deps.env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
    return deps.env.SESSION_SECRET;
  };
  const guard = fn => async request => {
    try { return await fn(request); }
    catch (e) { console.error("api error:", e.message); return json(500, { error: "server_error" }); }
  };
  const post = fn => guard(async request => (sameOrigin(request) ? fn(request) : json(403, { error: "forbidden" })));

  const live = post(async request => {
    const body = await readJson(request);
    if (body?.scope === "owner") {
      if (!isOwner(request, secret())) return json(401, { error: "unauthorized" });
      return json(200, { sealed: await deps.realtime().seal({ query: ownerAllQuery() }) });
    }
    const { vid, setCookie } = getVisitor(request, secret());
    return json(200, { sealed: await deps.realtime().seal({ query: visitorThreadQuery(vid) }), vid }, setCookie);
  });

  const send = post(async request => {
    const body = await readJson(request);
    const asOwner = body?.as === "owner";
    if (asOwner && !isOwner(request, secret())) return json(401, { error: "unauthorized" });
    const role = asOwner ? "o" : "v";
    const parsed = parseSend(body, role);
    if (!parsed.ok) return json(parsed.status, { error: parsed.code });
    const visitor = asOwner ? { vid: parsed.value.vid, setCookie: null } : getVisitor(request, secret());
    // 방문자는 /api/live 로 받은 서명 쿠키가 있어야 보낼 수 있다. 쿠키 없이 요청마다 새 vid 를 만들어 제한을 피하는 것을 막는다
    if (!asOwner && visitor.setCookie) return json(403, { error: "cookie_required" });
    const { name, contact, text } = parsed.value;
    const result = await insertMessage(deps.sql(), { vid: visitor.vid, from: role, name, contact, text });
    if (!result.ok) return json(429, { error: result.code });
    return json(200, { kind: "committed", txid: result.txid }, visitor.setCookie);
  });

  const ownerLogin = post(async request => {
    if (!deps.env.OWNER_PASSWORD) throw new Error("OWNER_PASSWORD is not set");
    const sql = deps.sql(), ip = clientIp(request);
    if (!(await checkLoginThrottle(sql, ip))) return json(429, { error: "too_many_attempts" });
    const body = await readJson(request);
    const ok = typeof body?.password === "string" && timingSafeEqual(digest(body.password), digest(deps.env.OWNER_PASSWORD));
    if (!ok) {
      await recordLoginFailure(sql, ip);
      return json(401, { error: "login_failed" });
    }
    return json(200, { ok: true }, ownerCookie(secret()));
  });

  const ownerSession = guard(async request => json(200, { owner: isOwner(request, secret()) }));

  return { live, send, ownerLogin, ownerSession };
}
