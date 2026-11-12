import { rawSql } from "@neon/realtime/server";

const COLS = "id, vid, from_role, name, contact, text, ts";

export const visitorThreadQuery = vid =>
  rawSql(`SELECT ${COLS} FROM messages WHERE vid = $1::uuid ORDER BY ts DESC LIMIT 200`, [vid]);

export const ownerAllQuery = () =>
  rawSql(`SELECT ${COLS} FROM messages ORDER BY ts DESC LIMIT 1000`);
