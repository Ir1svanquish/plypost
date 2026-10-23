import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

let connection: DatabaseSync | undefined;

export function closeDatabase() {
  connection?.close();
  connection = undefined;
}

export function database(): DatabaseSync {
  if (connection) return connection;
  const path = resolve(/* turbopackIgnore: true */ process.env.PLYPOST_DB_PATH || "data/plypost.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS drafts_owner ON drafts(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS assisted (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL,
      scheduled_for TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assisted_owner ON assisted(user_id, scheduled_for);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL,
      scheduled_for TEXT NOT NULL, timezone TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','simulated','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
      lease_until TEXT, last_error TEXT, completed_at TEXT,
      receipts TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(user_id, scheduled_for);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL,
      subject_id TEXT, detail TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_owner ON audit(user_id, id DESC);
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_usage_owner ON ai_usage(user_id, created_at);
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY, key TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts(key, created_at);
    CREATE TABLE IF NOT EXISTS worker_heartbeat (
      id INTEGER PRIMARY KEY CHECK(id=1), seen_at TEXT NOT NULL
    );
  `);
  connection = db;
  return db;
}

export function transaction<T>(work: (db: DatabaseSync) => T): T {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function audit(userId: string, action: string, subjectId?: string, detail?: string) {
  database().prepare("INSERT INTO audit(user_id, action, subject_id, detail, created_at) VALUES (?,?,?,?,?)")
    .run(userId, action, subjectId ?? null, detail ?? null, new Date().toISOString());
}
