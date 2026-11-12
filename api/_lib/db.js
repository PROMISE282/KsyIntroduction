import { neon } from "@neondatabase/serverless";

export const getSql = () => neon(process.env.DATABASE_URL);

const MAX_PER_VISITOR = 200;
const MIN_GAP_SECONDS = 2;
const LOGIN_WINDOW_MINUTES = 10;
const LOGIN_MAX_FAILURES = 5;

// Visitor limits are checked inside the INSERT itself so the write stays one statement.
const INSERT_SQL = `
  INSERT INTO messages (vid, from_role, name, contact, text)
  SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text
  WHERE $2::text <> 'v' OR (
    (SELECT count(*) FROM messages WHERE vid = $1::uuid) < ${MAX_PER_VISITOR}
    AND NOT EXISTS (
      SELECT 1 FROM messages
      WHERE vid = $1::uuid AND from_role = 'v' AND ts > now() - interval '${MIN_GAP_SECONDS} seconds'
    )
  )
  RETURNING pg_current_xact_id()::text AS txid`;

export async function insertMessage(sql, m) {
  const rows = await sql.query(INSERT_SQL, [m.vid, m.from, m.name, m.contact, m.text]);
  if (rows.length) return { ok: true, txid: rows[0].txid };
  const [{ n }] = await sql.query("SELECT count(*)::int AS n FROM messages WHERE vid = $1::uuid", [m.vid]);
  return { ok: false, code: n >= MAX_PER_VISITOR ? "limit" : "too_fast" };
}

export async function checkLoginThrottle(sql, ip) {
  const [{ n }] = await sql.query(
    `SELECT count(*)::int AS n FROM owner_login_failures WHERE ip = $1 AND ts > now() - interval '${LOGIN_WINDOW_MINUTES} minutes'`,
    [ip]
  );
  return n < LOGIN_MAX_FAILURES;
}

export async function recordLoginFailure(sql, ip) {
  await sql.query("INSERT INTO owner_login_failures (ip) VALUES ($1)", [ip]);
}
