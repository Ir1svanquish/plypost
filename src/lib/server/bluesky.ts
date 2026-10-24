import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  NodeOAuthClient, buildAtprotoLoopbackClientMetadata, requestLocalLock,
  type NodeSavedSession, type NodeSavedSessionStore, type NodeSavedState, type NodeSavedStateStore,
  type OAuthSession,
} from "@atproto/oauth-client-node";
import { owner } from "./auth";
import { audit, database, transaction } from "./db";
import { validatePlatformText } from "../platform-validation";

const SCOPE = "atproto repo:app.bsky.feed.post?action=create";
const OAUTH_COOKIE = "plypost_bluesky_oauth";
const OAUTH_LIFETIME_MS = 10 * 60_000;
const INFLIGHT_LIFETIME_MS = 2 * 60_000;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const DID = /^did:(?:plc:[a-z2-7]{24}|web:[a-z0-9.:%-]+)$/i;

type Configuration = { origin: string; key: Buffer; redirectUri: string };
type PendingRow = {
  nonce_hash: string; app_state_hash: string; user_id: string; session_hash: string; expires_at: string;
};
type ConnectionRow = { user_id: string; did: string; disconnecting: number; connected_at: string };
type AttemptRow = {
  client_request_id: string; user_id: string; did: string; content_hash: string;
  status: "inflight" | "posted" | "unknown" | "rejected";
  remote_uri: string | null; remote_cid: string | null; last_error: string | null;
  resolution: "found" | "absent" | null;
};

export class BlueskyError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function configuration(): Configuration | null {
  try {
    const origin = new URL(process.env.PLYPOST_BLUESKY_ORIGIN || "");
    const secret = process.env.PLYPOST_BLUESKY_SECRET?.trim() || "";
    // The SDK's loopback client ID works for local development. Public HTTPS
    // deployments need separately hosted metadata and a confidential client.
    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" ||
        !origin.port || origin.pathname !== "/" || origin.search || origin.hash ||
        origin.username || origin.password || !/^[a-f0-9]{64}$/i.test(secret)) return null;
    return { origin: origin.origin, key: Buffer.from(secret, "hex"),
      redirectUri: `${origin.origin}/api/bluesky/callback` };
  } catch { return null; }
}

function requireConfiguration(): Configuration {
  const config = configuration();
  if (!config) throw new BlueskyError("Bluesky OAuth is not configured for this local app.", 503);
  return config;
}

export function blueskyConfiguredOrigin(): string | null { return configuration()?.origin ?? null; }
export function blueskyOAuthCookie() { return OAUTH_COOKIE; }

function seal<T>(value: T, config: Configuration, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(Buffer.from(`plypost:bluesky:${context}`));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url")}`;
}

function open<T>(value: string, config: Configuration, context: string): T {
  try {
    if (!value.startsWith("v1.")) throw new Error("version");
    const packed = Buffer.from(value.slice(3), "base64url");
    if (packed.length < 29) throw new Error("length");
    const decipher = createDecipheriv("aes-256-gcm", config.key, packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(`plypost:bluesky:${context}`));
    decipher.setAuthTag(packed.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch { throw new BlueskyError("Stored Bluesky credentials cannot be read. Check the encryption key.", 503); }
}

export function blueskyStores(config: Configuration = requireConfiguration()): {
  stateStore: NodeSavedStateStore; sessionStore: NodeSavedSessionStore;
} {
  const stateStore: NodeSavedStateStore = {
    get(key) {
      const row = database().prepare("SELECT payload_cipher,created_at FROM bluesky_oauth_states WHERE state_key=?")
        .get(key) as { payload_cipher: string; created_at: string } | undefined;
      if (!row) return undefined;
      if (Date.parse(row.created_at) + OAUTH_LIFETIME_MS < Date.now()) {
        database().prepare("DELETE FROM bluesky_oauth_states WHERE state_key=?").run(key);
        return undefined;
      }
      return open<NodeSavedState>(row.payload_cipher, config, `state:${key}`);
    },
    set(key, value) {
      database().prepare(`INSERT INTO bluesky_oauth_states(state_key,payload_cipher,created_at) VALUES (?,?,?)
        ON CONFLICT(state_key) DO UPDATE SET payload_cipher=excluded.payload_cipher,created_at=excluded.created_at`)
        .run(key, seal(value, config, `state:${key}`), new Date().toISOString());
    },
    del(key) { database().prepare("DELETE FROM bluesky_oauth_states WHERE state_key=?").run(key); },
  };
  const sessionStore: NodeSavedSessionStore = {
    get(did) {
      const row = database().prepare("SELECT payload_cipher FROM bluesky_sessions WHERE did=?")
        .get(did) as { payload_cipher: string } | undefined;
      return row ? open<NodeSavedSession>(row.payload_cipher, config, `session:${did}`) : undefined;
    },
    set(did, value) {
      database().prepare(`INSERT INTO bluesky_sessions(did,payload_cipher,updated_at) VALUES (?,?,?)
        ON CONFLICT(did) DO UPDATE SET payload_cipher=excluded.payload_cipher,updated_at=excluded.updated_at`)
        .run(did, seal(value, config, `session:${did}`), new Date().toISOString());
    },
    del(did) { database().prepare("DELETE FROM bluesky_sessions WHERE did=?").run(did); },
  };
  return { stateStore, sessionStore };
}

type Client = Pick<NodeOAuthClient, "authorize" | "callback" | "restore" | "revoke">;
function client(config: Configuration): Client {
  return new NodeOAuthClient({
    clientMetadata: buildAtprotoLoopbackClientMetadata({ scope: SCOPE, redirect_uris: [config.redirectUri] }),
    ...blueskyStores(config), requestLock: requestLocalLock,
  });
}

function connection(userId: string): ConnectionRow | null {
  return (database().prepare("SELECT * FROM bluesky_connections WHERE user_id=?")
    .get(userId) as ConnectionRow | undefined) ?? null;
}

export function blueskyConnection(userId: string) {
  const connected = connection(userId);
  return { configured: Boolean(configuration()), connected: Boolean(connected && !connected.disconnecting),
    ...(connected ? { account: { did: connected.did } } : {}) };
}

function cleanHandle(value: unknown): string {
  if (typeof value !== "string") throw new BlueskyError("Enter a Bluesky handle.");
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  if (handle.length < 3 || handle.length > 253 || !handle.includes(".") ||
      !handle.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new BlueskyError("Enter a valid Bluesky handle, such as alice.bsky.social.");
  }
  return handle;
}

export async function beginBlueskyConnect(userId: string, sessionToken: string, handleInput: unknown,
  oauthClient?: Client): Promise<{ authorizeUrl: string; nonce: string }> {
  const config = requireConfiguration();
  const handle = cleanHandle(handleInput);
  const sessionHash = digest(sessionToken);
  if (!sessionToken || !database().prepare("SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?")
    .get(sessionHash, userId, new Date().toISOString())) throw new BlueskyError("Sign in to continue.", 401);
  if (connection(userId)) throw new BlueskyError("Disconnect the current Bluesky account first.", 409);
  const nonce = randomBytes(32).toString("base64url");
  const appState = randomBytes(32).toString("base64url");
  transaction((db) => {
    db.prepare("DELETE FROM bluesky_oauth_states WHERE created_at<?")
      .run(new Date(Date.now() - OAUTH_LIFETIME_MS).toISOString());
    db.prepare("DELETE FROM bluesky_oauth_pending WHERE expires_at<=? OR user_id=?")
      .run(new Date().toISOString(), userId);
    db.prepare(`INSERT INTO bluesky_oauth_pending(nonce_hash,app_state_hash,user_id,session_hash,expires_at,created_at)
      VALUES (?,?,?,?,?,?)`).run(digest(nonce), digest(appState), userId, sessionHash,
        new Date(Date.now() + OAUTH_LIFETIME_MS).toISOString(), new Date().toISOString());
  });
  try {
    const authorize = await (oauthClient ?? client(config)).authorize(handle, { scope: SCOPE, state: appState });
    if (authorize.protocol !== "https:") throw new Error("non-HTTPS authorization URL");
    audit(userId, "bluesky.connect_started");
    return { authorizeUrl: authorize.href, nonce };
  } catch {
    database().prepare("DELETE FROM bluesky_oauth_pending WHERE nonce_hash=?").run(digest(nonce));
    throw new BlueskyError("Could not start Bluesky authorization. Check the handle and try again.", 502);
  }
}

function consumePending(nonce: string, config: Configuration): PendingRow {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(nonce)) throw new BlueskyError("Bluesky authorization could not be verified.");
  return transaction((db) => {
    const row = db.prepare("SELECT * FROM bluesky_oauth_pending WHERE nonce_hash=?")
      .get(digest(nonce)) as PendingRow | undefined;
    if (!row || row.expires_at <= new Date().toISOString() || row.user_id !== owner() ||
        !db.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?")
          .get(row.session_hash, row.user_id, new Date().toISOString()) ||
        !config.redirectUri) throw new BlueskyError("Bluesky authorization could not be verified.");
    db.prepare("DELETE FROM bluesky_oauth_pending WHERE nonce_hash=?").run(row.nonce_hash);
    return row;
  });
}

export async function completeBlueskyConnect(params: URLSearchParams, nonce: string,
  oauthClient?: Client): Promise<void> {
  const config = requireConfiguration();
  const pending = consumePending(nonce, config);
  if (!params.get("state") || !params.get("code") || params.get("error") ||
      params.toString().length > 4096) throw new BlueskyError("Bluesky authorization was incomplete.");
  const oauth = oauthClient ?? client(config);
  let did: string | null = null;
  try {
    const result = await oauth.callback(params, { redirect_uri: config.redirectUri as `http://127.0.0.1:${string}` });
    did = result.session.did;
    if (!DID.test(did) || !result.state || digest(result.state) !== pending.app_state_hash) {
      throw new BlueskyError("Bluesky authorization could not be verified.");
    }
    const info = await result.session.getTokenInfo(false);
    const granted = String(info.scope).split(/\s+/).filter(Boolean).sort();
    if (granted.join(" ") !== SCOPE.split(" ").sort().join(" ") || info.sub !== did) {
      throw new BlueskyError("Bluesky did not grant the requested posting permission.");
    }
    transaction((db) => {
      if (db.prepare("SELECT 1 FROM bluesky_connections WHERE user_id=? OR did=?").get(pending.user_id, did)) {
        throw new BlueskyError("A Bluesky account is already connected.", 409);
      }
      db.prepare("INSERT INTO bluesky_connections(user_id,did,connected_at) VALUES (?,?,?)")
        .run(pending.user_id, did, new Date().toISOString());
      audit(pending.user_id, "bluesky.connected", did ?? undefined);
    });
  } catch (error) {
    if (did) {
      // The SDK saves credentials during callback, before our owner/state/scope
      // checks. Revoke the newly granted session when any app check fails.
      try { await oauth.revoke(did); } catch { /* Still remove local credentials. */ }
      await blueskyStores(config).sessionStore.del(did);
    }
    if (error instanceof BlueskyError) throw error;
    throw new BlueskyError("Bluesky did not authorize this connection.");
  }
}

export function blueskyCallbackRedirect(success: boolean): string {
  return `${requireConfiguration().origin}/?bluesky=${success ? "connected" : "error"}#account`;
}

function ageInflight(userId: string): void {
  database().prepare(`UPDATE bluesky_publish_attempts SET status='unknown',
    last_error='The posting result was not confirmed. Check Bluesky before trying again.',updated_at=?
    WHERE user_id=? AND status='inflight' AND created_at<?`)
    .run(new Date().toISOString(), userId, new Date(Date.now() - INFLIGHT_LIFETIME_MS).toISOString());
}

export function listBlueskyPublications(userId: string) {
  ageInflight(userId);
  return database().prepare(`SELECT client_request_id AS clientRequestId,did,text_excerpt AS textExcerpt,
    status,remote_uri AS uri,remote_cid AS cid,last_error AS error,
    resolution,resolved_at AS resolvedAt,created_at AS createdAt
    FROM bluesky_publish_attempts WHERE user_id=? ORDER BY created_at DESC LIMIT 30`)
    .all(userId);
}

export function resolveBlueskyPublication(userId: string, body: unknown): { ok: true } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BlueskyError("Invalid resolution request.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "clientRequestId" && key !== "resolution") ||
      typeof input.clientRequestId !== "string" || !UUID.test(input.clientRequestId) ||
      (input.resolution !== "found" && input.resolution !== "absent")) {
    throw new BlueskyError("Invalid resolution request.");
  }
  const requestId = input.clientRequestId as string;
  const resolution = input.resolution as "found" | "absent";
  ageInflight(userId);
  transaction((db) => {
    const attempt = db.prepare("SELECT status,resolution FROM bluesky_publish_attempts WHERE client_request_id=? AND user_id=?")
      .get(requestId, userId) as Pick<AttemptRow, "status" | "resolution"> | undefined;
    if (!attempt || attempt.status !== "unknown" || attempt.resolution) {
      throw new BlueskyError("Only an unchecked unknown result can be marked after reviewing Bluesky.", 409);
    }
    db.prepare(`UPDATE bluesky_publish_attempts SET resolution=?,resolved_at=?,updated_at=?
      WHERE client_request_id=? AND user_id=? AND status='unknown' AND resolution IS NULL`)
      .run(resolution, new Date().toISOString(), new Date().toISOString(), requestId, userId);
    audit(userId, `bluesky.publish_checked_${resolution}`, requestId);
  });
  return { ok: true };
}

export async function disconnectBluesky(userId: string, oauthClient?: Client): Promise<{ ok: true; revoked: boolean }> {
  const config = configuration();
  ageInflight(userId);
  const connected = transaction((db) => {
    const row = db.prepare("SELECT * FROM bluesky_connections WHERE user_id=?")
      .get(userId) as ConnectionRow | undefined;
    if (!row) throw new BlueskyError("No Bluesky account is connected.", 409);
    if (row.disconnecting || db.prepare(`SELECT 1 FROM bluesky_publish_attempts
      WHERE user_id=? AND status='inflight' LIMIT 1`).get(userId)) {
      throw new BlueskyError("A Bluesky post or disconnection is still in progress.", 409);
    }
    db.prepare("UPDATE bluesky_connections SET disconnecting=1 WHERE user_id=?").run(userId);
    return row;
  });
  let revoked = false;
  if (config) {
    try { await (oauthClient ?? client(config)).revoke(connected.did); revoked = true; }
    catch { /* Local credentials are still removed. */ }
  }
  transaction((db) => {
    db.prepare("DELETE FROM bluesky_connections WHERE user_id=? AND did=?").run(userId, connected.did);
    db.prepare("DELETE FROM bluesky_sessions WHERE did=?").run(connected.did);
    audit(userId, "bluesky.disconnected", connected.did, revoked ? "revoked" : "local-only");
  });
  return { ok: true, revoked };
}

function result(row: AttemptRow): { status: "posted" | "unknown"; uri?: string; cid?: string; url?: string } {
  if (row.status !== "posted" || !row.remote_uri || !row.remote_cid) return { status: "unknown" };
  const rkey = row.remote_uri.split("/").at(-1) || "";
  return { status: "posted", uri: row.remote_uri, cid: row.remote_cid,
    url: `https://bsky.app/profile/${encodeURIComponent(row.did)}/post/${encodeURIComponent(rkey)}` };
}

async function boundedPostResponse(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 64 * 1024) { await reader.cancel(); throw new Error("large response"); }
    chunks.push(value);
  }
  const json: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("invalid response");
  return json as Record<string, unknown>;
}

export async function publishBlueskyText(userId: string, body: unknown, oauthClient?: Client):
  Promise<{ status: "posted" | "unknown"; uri?: string; cid?: string; url?: string }> {
  requireConfiguration();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BlueskyError("Invalid publishing request.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "text" && key !== "clientRequestId" && key !== "accountDid")) {
    throw new BlueskyError("Live Bluesky publishing currently supports plain text only.");
  }
  if (typeof input.text !== "string" || input.text.length > 3000 ||
      !validatePlatformText("bluesky", input.text).valid) throw new BlueskyError("Invalid Bluesky post text.");
  const text = input.text;
  const requestId = input.clientRequestId;
  if (typeof requestId !== "string" || !UUID.test(requestId)) throw new BlueskyError("Invalid publishing request ID.");
  if (typeof input.accountDid !== "string" || !DID.test(input.accountDid)) {
    throw new BlueskyError("Review and confirm the connected Bluesky account before publishing.");
  }
  const accountDid = input.accountDid;
  const contentHash = digest(text);
  ageInflight(userId);
  const reservation = transaction((db) => {
    const connected = db.prepare("SELECT * FROM bluesky_connections WHERE user_id=?")
      .get(userId) as ConnectionRow | undefined;
    if (!connected || connected.disconnecting || connected.did !== accountDid) {
      throw new BlueskyError("The connected Bluesky account changed. Review the post again before publishing.", 409);
    }
    const prior = db.prepare("SELECT * FROM bluesky_publish_attempts WHERE client_request_id=?")
      .get(requestId) as AttemptRow | undefined;
    if (prior) {
      if (prior.user_id !== userId || prior.did !== connected.did || prior.content_hash !== contentHash)
        throw new BlueskyError("This publishing request ID has already been used.", 409);
      if (prior.status === "rejected") throw new BlueskyError(prior.last_error || "Bluesky rejected this request.", 409);
      return { prior };
    }
    if (db.prepare(`SELECT 1 FROM bluesky_publish_attempts WHERE user_id=? AND did=? AND content_hash=?
      AND (status='inflight' OR (status='unknown' AND (resolution IS NULL OR resolution='found')))`)
      .get(userId, connected.did, contentHash)) {
      throw new BlueskyError("A previous attempt for this text has an unconfirmed result. Check Bluesky first.", 409);
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO bluesky_publish_attempts
      (client_request_id,user_id,did,content_hash,text_excerpt,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'inflight',?,?)`).run(requestId, userId, connected.did, contentHash,
        [...text].slice(0, 160).join(""), now, now);
    audit(userId, "bluesky.publish_started", requestId);
    return { connected };
  });
  if ("prior" in reservation && reservation.prior) return result(reservation.prior);
  const connected = reservation.connected;
  if (!connected) throw new BlueskyError("Bluesky publishing could not be prepared.", 500);

  let status: AttemptRow["status"] = "unknown";
  let message = "Publishing result was not confirmed. Check Bluesky before trying again.";
  let uri: string | null = null;
  let cid: string | null = null;
  let rejectedStatus = 400;
  try {
    const session: OAuthSession = await (oauthClient ?? client(requireConfiguration())).restore(connected.did);
    if (session.did !== connected.did) throw new Error("wrong account");
    const response = await session.fetchHandler("/xrpc/com.atproto.repo.createRecord", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: connected.did, collection: "app.bsky.feed.post",
        record: { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString() } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const post = await boundedPostResponse(response);
      if (typeof post.uri === "string" &&
          post.uri.startsWith(`at://${connected.did}/app.bsky.feed.post/`) &&
          /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[a-z0-9]+$/.test(post.uri) &&
          typeof post.cid === "string" && /^[a-zA-Z0-9]+$/.test(post.cid)) {
        uri = post.uri; cid = post.cid; status = "posted"; message = "";
      }
    } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      status = "rejected";
      rejectedStatus = response.status === 429 ? 429 : 400;
      message = response.status === 429 ? "Bluesky is rate limiting posts. Try again later with a new request." :
        response.status === 401 || response.status === 403 ? "Bluesky authorization was rejected. Reconnect the account." :
          "Bluesky rejected this post. Check its text and account settings.";
    }
  } catch { /* A request may have reached Bluesky before the connection failed. */ }
  transaction((db) => {
    db.prepare(`UPDATE bluesky_publish_attempts SET status=?,remote_uri=?,remote_cid=?,last_error=?,updated_at=?
      WHERE client_request_id=? AND user_id=? AND status='inflight'`)
      .run(status, uri, cid, message || null, new Date().toISOString(), requestId, userId);
    audit(userId, `bluesky.publish_${status}`, requestId, uri ?? undefined);
  });
  if (status === "rejected") throw new BlueskyError(message, rejectedStatus);
  return status === "posted" ? result({ did: connected.did, status, remote_uri: uri, remote_cid: cid } as AttemptRow) : { status: "unknown" };
}
