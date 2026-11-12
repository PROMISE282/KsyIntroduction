import { createRealtime } from "@neon/realtime/server";
import { getSql } from "./db.js";

export function json(status, body, setCookie) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

// Browsers always send Origin on cross-site POSTs; a missing Origin means a non-browser client.
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export const makeRealtime = (env = process.env) =>
  createRealtime({ secret: env.NEON_REALTIME_SECRET, db: new URL(env.DATABASE_URL).pathname.slice(1) });

export const defaultDeps = () => ({ env: process.env, sql: getSql, realtime: () => makeRealtime() });
