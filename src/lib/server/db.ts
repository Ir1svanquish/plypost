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
    CREATE TABLE IF NOT EXISTS brand_briefs (
      user_id TEXT PRIMARY KEY, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS slot_settings (
      user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS weekly_plans (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS weekly_plans_owner ON weekly_plans(user_id, created_at DESC);
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
    CREATE TABLE IF NOT EXISTS mastodon_worker_heartbeat (
      id INTEGER PRIMARY KEY CHECK(id=1), seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mastodon_oauth_states (
      state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      instance TEXT NOT NULL, redirect_uri TEXT NOT NULL,
      client_id_cipher TEXT NOT NULL, client_secret_cipher TEXT NOT NULL,
      verifier_cipher TEXT NOT NULL, nonce_hash TEXT NOT NULL,
      session_hash TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mastodon_oauth_states_expiry ON mastodon_oauth_states(expires_at);
    CREATE TABLE IF NOT EXISTS mastodon_connections (
      user_id TEXT PRIMARY KEY, instance TEXT NOT NULL,
      account_id TEXT NOT NULL, username TEXT NOT NULL,
      account_url TEXT NOT NULL, access_token_cipher TEXT NOT NULL,
      client_id_cipher TEXT NOT NULL, client_secret_cipher TEXT NOT NULL,
      connected_at TEXT NOT NULL, disconnecting INTEGER NOT NULL DEFAULT 0,
      disconnect_started_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mastodon_publish_attempts (
      client_request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      instance TEXT NOT NULL, account_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('inflight','posted','unknown','rejected')),
      remote_id TEXT, remote_url TEXT, last_error TEXT,
      text_excerpt TEXT,
      resolution TEXT CHECK(resolution IN ('found','absent') OR resolution IS NULL),
      resolved_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mastodon_attempts_owner
      ON mastodon_publish_attempts(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS mastodon_scheduled_posts (
      client_request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      instance TEXT NOT NULL, account_id TEXT NOT NULL,
      account_username TEXT NOT NULL, account_url TEXT NOT NULL,
      text TEXT NOT NULL, content_hash TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','inflight','posted','unknown','rejected','cancelled')),
      dispatch_authorized INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_authorized IN (0,1)),
      claimed_at TEXT, remote_id TEXT, remote_url TEXT, last_error TEXT,
      resolution TEXT CHECK(resolution IN ('found','absent') OR resolution IS NULL),
      resolved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mastodon_scheduled_due
      ON mastodon_scheduled_posts(status, scheduled_for);
    CREATE INDEX IF NOT EXISTS mastodon_scheduled_owner
      ON mastodon_scheduled_posts(user_id, scheduled_for DESC);
    CREATE TABLE IF NOT EXISTS bluesky_oauth_states (
      state_key TEXT PRIMARY KEY, payload_cipher TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bluesky_sessions (
      did TEXT PRIMARY KEY, payload_cipher TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bluesky_oauth_pending (
      nonce_hash TEXT PRIMARY KEY, app_state_hash TEXT NOT NULL,
      user_id TEXT NOT NULL, session_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bluesky_oauth_pending_owner ON bluesky_oauth_pending(user_id);
    CREATE TABLE IF NOT EXISTS bluesky_connections (
      user_id TEXT PRIMARY KEY, did TEXT NOT NULL UNIQUE,
      connected_at TEXT NOT NULL, disconnecting INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bluesky_publish_attempts (
      client_request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, did TEXT NOT NULL,
      content_hash TEXT NOT NULL, text_excerpt TEXT,
      status TEXT NOT NULL CHECK(status IN ('inflight','posted','unknown','rejected')),
      remote_uri TEXT, remote_cid TEXT, last_error TEXT,
      resolution TEXT CHECK(resolution IN ('found','absent') OR resolution IS NULL),
      resolved_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bluesky_attempts_owner
      ON bluesky_publish_attempts(user_id, created_at DESC);
  `);
  const oauthColumns = db.prepare("PRAGMA table_info(mastodon_oauth_states)").all() as { name: string }[];
  if (!oauthColumns.some((column) => column.name === "session_hash")) {
    db.exec("ALTER TABLE mastodon_oauth_states ADD COLUMN session_hash TEXT");
  }
  const connectionColumns = db.prepare("PRAGMA table_info(mastodon_connections)").all() as { name: string }[];
  if (!connectionColumns.some((column) => column.name === "disconnecting")) {
    db.exec("ALTER TABLE mastodon_connections ADD COLUMN disconnecting INTEGER NOT NULL DEFAULT 0");
  }
  if (!connectionColumns.some((column) => column.name === "disconnect_started_at")) {
    db.exec("ALTER TABLE mastodon_connections ADD COLUMN disconnect_started_at TEXT");
  }
  const attemptColumns = db.prepare("PRAGMA table_info(mastodon_publish_attempts)").all() as { name: string }[];
  if (!attemptColumns.some((column) => column.name === "text_excerpt")) {
    db.exec("ALTER TABLE mastodon_publish_attempts ADD COLUMN text_excerpt TEXT");
  }
  if (!attemptColumns.some((column) => column.name === "resolution")) {
    db.exec("ALTER TABLE mastodon_publish_attempts ADD COLUMN resolution TEXT CHECK(resolution IN ('found','absent') OR resolution IS NULL)");
  }
  if (!attemptColumns.some((column) => column.name === "resolved_at")) {
    db.exec("ALTER TABLE mastodon_publish_attempts ADD COLUMN resolved_at TEXT");
  }
  const scheduledColumns = db.prepare("PRAGMA table_info(mastodon_scheduled_posts)").all() as { name: string }[];
  if (!scheduledColumns.some((column) => column.name === "dispatch_authorized")) {
    db.exec("ALTER TABLE mastodon_scheduled_posts ADD COLUMN dispatch_authorized INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_authorized IN (0,1))");
  }
  const blueskyAttemptColumns = db.prepare("PRAGMA table_info(bluesky_publish_attempts)").all() as { name: string }[];
  if (!blueskyAttemptColumns.some((column) => column.name === "resolution")) {
    db.exec("ALTER TABLE bluesky_publish_attempts ADD COLUMN resolution TEXT CHECK(resolution IN ('found','absent') OR resolution IS NULL)");
  }
  if (!blueskyAttemptColumns.some((column) => column.name === "resolved_at")) {
    db.exec("ALTER TABLE bluesky_publish_attempts ADD COLUMN resolved_at TEXT");
  }
  const blueskyIndex = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='bluesky_attempts_unresolved_content'")
    .get() as { sql: string } | undefined;
  if (!blueskyIndex?.sql.includes("resolution='found'")) {
    db.exec(`DROP INDEX IF EXISTS bluesky_attempts_unresolved_content;
      CREATE UNIQUE INDEX bluesky_attempts_unresolved_content
      ON bluesky_publish_attempts(user_id,did,content_hash)
      WHERE status='inflight' OR (status='unknown' AND (resolution IS NULL OR resolution='found'));`);
  }
  // A record from before real scheduling was enabled must never start publishing after an upgrade.
  db.prepare(`UPDATE mastodon_scheduled_posts SET status='cancelled',
    last_error='This entry predates authorized automatic publishing. Schedule it again to send it.',updated_at=?
    WHERE status='queued' AND dispatch_authorized=0`).run(new Date().toISOString());
  const unresolvedIndex = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='mastodon_attempts_unresolved_content'")
    .get() as { sql: string } | undefined;
  if (!unresolvedIndex?.sql.includes("resolution='found'")) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        DROP INDEX IF EXISTS mastodon_attempts_unresolved_content;
        CREATE UNIQUE INDEX mastodon_attempts_unresolved_content
          ON mastodon_publish_attempts(user_id, instance, account_id, content_hash)
          WHERE status='inflight' OR (status='unknown' AND (resolution IS NULL OR resolution='found'));
      `);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
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
