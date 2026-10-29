import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS example_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action_id TEXT NOT NULL, sku TEXT NOT NULL, callback_url TEXT NOT NULL, status TEXT NOT NULL, result TEXT, UNIQUE(user_id, action_id));
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action_id TEXT NOT NULL, mode TEXT NOT NULL, unit TEXT, amount INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, result TEXT, UNIQUE(user_id, action_id));
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_job ON jobs(user_id) WHERE status IN ('NEW','UNKNOWN','CONFIRMED');
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_purchase ON purchases(user_id) WHERE status IN ('NEW','UNKNOWN');
    CREATE TABLE IF NOT EXISTS receipts (job_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mock_balances (user_id TEXT PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS mock_paid (purchase_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS mock_consumed (id TEXT PRIMARY KEY, result TEXT NOT NULL);
  `);
  return db;
}
export function atomic(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
