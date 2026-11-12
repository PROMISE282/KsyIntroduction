const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const len = s => [...s].length;
const bad = code => ({ ok: false, status: 400, code });

export function parseSend(body, role) {
  if (body === null || typeof body !== "object") return bad("invalid_body");
  const { text, name, contact, vid } = body;
  if (typeof text !== "string") return bad("invalid_text");
  const t = text.trim();
  if (len(t) < 1 || len(t) > 1000) return bad("invalid_text");

  let n = "방문자";
  if (name !== undefined && name !== null) {
    if (typeof name !== "string") return bad("invalid_name");
    n = name.trim() || "방문자";
    if (len(n) > 20) return bad("invalid_name");
  }

  let c = null;
  if (contact !== undefined && contact !== null) {
    if (typeof contact !== "string") return bad("invalid_contact");
    c = contact.trim() || null;
    if (c !== null && len(c) > 100) return bad("invalid_contact");
  }

  const value = { name: n, contact: c, text: t };
  if (role === "o") {
    if (typeof vid !== "string" || !UUID_RE.test(vid)) return bad("invalid_vid");
    value.vid = vid.toLowerCase();
  }
  return { ok: true, value };
}
