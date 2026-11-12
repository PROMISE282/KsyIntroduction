import { createHash, timingSafeEqual } from "node:crypto";
import { getVisitor, isOwner, ownerCookie } from "./session.js";
import { parseSend } from "./validate.js";
import { insertMessage, checkLoginThrottle, recordLoginFailure } from "./db.js";
import { visitorThreadQuery, ownerAllQuery } from "./queries.js";
import { json, sameOrigin } from "./http.js";
import { isEmail } from "./mail.js";

const digest = s => createHash("sha256").update(String(s)).digest();
const clientIp = request => (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
const readJson = async request => { try { return await request.json(); } catch { return null; } };

// deps: { env, sql: () => sql, realtime: () => realtime, mail: async ({to, text}) | null } so tests can swap the DB, Realtime and mail.
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

  const mailReply = async (vid, text) => {
    if (!deps.mail) return "disabled";
    try {
      const rows = await deps.sql().query(
        "SELECT contact FROM messages WHERE vid = $1::uuid AND from_role = 'v' AND contact IS NOT NULL ORDER BY ts DESC LIMIT 1", [vid]);
      const to = rows[0]?.contact;
      if (!isEmail(to)) return "no_contact";
      await deps.mail({ to, text });
      return "sent";
    } catch (e) { console.error("mail error:", e.message); return "failed"; }
  };

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
    // 오너 답장은 방문자가 남긴 이메일로도 보낸다. 메일이 실패해도 메시지는 이미 저장됐으므로 전송 자체는 성공으로 둔다
    const mail = asOwner ? await mailReply(visitor.vid, text) : undefined;
    return json(200, { kind: "committed", txid: result.txid, ...(mail ? { mail } : {}) }, visitor.setCookie);
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
