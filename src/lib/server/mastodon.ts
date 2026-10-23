import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { owner } from "./auth";
import { audit, database, transaction } from "./db";

const OAUTH_COOKIE = "plypost_mastodon_oauth";
const OAUTH_LIFETIME_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DISCONNECT_LEASE_MS = 30_000;
const MAX_PROVIDER_JSON_BYTES = 256 * 1024;
const OAUTH_SCOPE = "profile write:statuses";
const UUID_PATTERN = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

type Configuration = { instance: string; publicOrigin: string; key: Buffer; redirectUri: string };
type StateRow = {
  state_hash: string; user_id: string; instance: string; redirect_uri: string;
  client_id_cipher: string; client_secret_cipher: string; verifier_cipher: string;
  nonce_hash: string; session_hash: string | null; expires_at: string;
};
type ConnectionRow = {
  user_id: string; instance: string; account_id: string; username: string;
  account_url: string; access_token_cipher: string; client_id_cipher: string;
  client_secret_cipher: string; connected_at: string;
  disconnecting: number; disconnect_started_at: string | null;
};
type AttemptStatus = "inflight" | "posted" | "unknown" | "rejected";
type AttemptRow = {
  client_request_id: string; user_id: string; instance: string; account_id: string;
  content_hash: string; status: AttemptStatus; remote_id: string | null;
  remote_url: string | null; last_error: string | null; created_at: string;
  text_excerpt: string | null; resolution: "found" | "absent" | null; resolved_at: string | null;
};

export class MastodonError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function parsedOrigin(value: string, { allowLoopbackHttp = false }: { allowLoopbackHttp?: boolean } = {}): string | null {
  try {
    const url = new URL(value);
    const loopback = allowLoopbackHttp && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
        (isIP(url.hostname) && !loopback) || (!allowLoopbackHttp && url.hostname === "localhost")) return null;
    return url.origin;
  } catch { return null; }
}

function parseKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  if (!/^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43})$/.test(trimmed)) return null;
  const normalized = trimmed.replaceAll("-", "+").replaceAll("_", "/");
  const key = Buffer.from(normalized, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")) return null;
  return key;
}

function configuration(): Configuration | null {
  const instance = parsedOrigin(process.env.PLYPOST_MASTODON_INSTANCE || "");
  const publicOrigin = parsedOrigin(process.env.PLYPOST_PUBLIC_ORIGIN || "", { allowLoopbackHttp: true });
  const key = parseKey(process.env.PLYPOST_MASTODON_SECRET);
  if (!instance || !publicOrigin || !key) return null;
  return { instance, publicOrigin, key, redirectUri: `${publicOrigin}/api/mastodon/callback` };
}

function requireConfiguration(): Configuration {
  const value = configuration();
  if (!value) throw new MastodonError("Mastodon connection is not configured.", 503);
  return value;
}

function encrypt(value: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`plypost:mastodon:${context}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
}

function decrypt(value: string, key: Buffer, context: string): string {
  try {
    if (!value.startsWith("v1.")) throw new Error("format");
    const packed = Buffer.from(value.slice(3), "base64url");
    if (packed.length < 29) throw new Error("length");
    const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(`plypost:mastodon:${context}`));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
  } catch { throw new MastodonError("Stored Mastodon credentials cannot be read. Check the encryption key.", 503); }
}

async function providerRequest(config: Configuration, path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, `${config.instance}/`);
  if (url.origin !== config.instance || !path.startsWith("/")) throw new MastodonError("Invalid Mastodon endpoint.", 500);
  try {
    return await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch { throw new MastodonError("Could not reach the configured Mastodon server.", 502); }
}

async function providerJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("empty");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PROVIDER_JSON_BYTES) { await reader.cancel(); throw new Error("large"); }
      chunks.push(value);
    }
    const json: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("object");
    return json as Record<string, unknown>;
  } catch { throw new MastodonError("The Mastodon server returned an invalid response.", 502); }
}

function safeProviderUrl(value: unknown, instance: string): string | null {
  if (typeof value !== "string" || value.length > 1024) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === instance && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function cleanString(value: unknown, max = 512): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function currentConnection(userId: string): ConnectionRow | null {
  return (database().prepare("SELECT * FROM mastodon_connections WHERE user_id=?").get(userId) as ConnectionRow | undefined) ?? null;
}

export function mastodonConnection(userId: string) {
  const config = configuration();
  const connected = currentConnection(userId);
  return {
    configured: Boolean(config && (!connected || connected.instance === config.instance)),
    instance: connected?.instance ?? config?.instance,
    connected: Boolean(connected),
    ...(connected ? { account: { id: connected.account_id, username: connected.username, url: connected.account_url } } : {}),
  };
}

export async function beginMastodonConnect(userId: string, sessionToken: string): Promise<{ authorizeUrl: string; nonce: string; secureCookie: boolean }> {
  const config = requireConfiguration();
  const sessionHash = digest(sessionToken);
  if (!sessionToken || !database().prepare("SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at > ?")
    .get(sessionHash, userId, new Date().toISOString())) throw new MastodonError("Sign in to continue.", 401);
  if (currentConnection(userId)) throw new MastodonError("Disconnect the current Mastodon account before connecting another.", 409);
  const metadataResponse = await providerRequest(config, "/.well-known/oauth-authorization-server");
  if (!metadataResponse.ok) throw new MastodonError("This Mastodon server does not support the required OAuth security features.", 400);
  const metadata = await providerJson(metadataResponse);
  const challengeMethods = metadata.code_challenge_methods_supported;
  const scopes = metadata.scopes_supported;
  if (parsedOrigin(String(metadata.issuer || "")) !== config.instance ||
      !Array.isArray(challengeMethods) || !challengeMethods.includes("S256") ||
      !Array.isArray(scopes) || !scopes.includes("profile") || !scopes.includes("write:statuses") ||
      safeProviderUrl(metadata.authorization_endpoint, config.instance) !== `${config.instance}/oauth/authorize` ||
      safeProviderUrl(metadata.token_endpoint, config.instance) !== `${config.instance}/oauth/token`) {
    throw new MastodonError("This Mastodon server does not support the required OAuth security features.", 400);
  }
  const registrationResponse = await providerRequest(config, "/api/v1/apps", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Plypost", redirect_uris: config.redirectUri, scopes: OAUTH_SCOPE }),
  });
  if (!registrationResponse.ok) throw new MastodonError("Mastodon could not register this connection.", 502);
  const registration = await providerJson(registrationResponse);
  const clientId = cleanString(registration.client_id);
  const clientSecret = cleanString(registration.client_secret);
  if (!clientId || !clientSecret) throw new MastodonError("Mastodon returned incomplete app credentials.", 502);

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const now = new Date();
  transaction((db) => {
    db.prepare("DELETE FROM mastodon_oauth_states WHERE expires_at <= ? OR user_id=?")
      .run(now.toISOString(), userId);
    db.prepare(`INSERT INTO mastodon_oauth_states
      (state_hash,user_id,instance,redirect_uri,client_id_cipher,client_secret_cipher,verifier_cipher,nonce_hash,session_hash,expires_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        digest(state), userId, config.instance, config.redirectUri,
        encrypt(clientId, config.key, `state:${userId}:client_id`),
        encrypt(clientSecret, config.key, `state:${userId}:client_secret`),
        encrypt(verifier, config.key, `state:${userId}:verifier`), digest(nonce), sessionHash,
        new Date(now.getTime() + OAUTH_LIFETIME_MS).toISOString(), now.toISOString(),
      );
    audit(userId, "mastodon.connect_started");
  });
  const authorize = new URL(`${config.instance}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("scope", OAUTH_SCOPE);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return { authorizeUrl: authorize.href, nonce, secureCookie: config.publicOrigin.startsWith("https://") };
}

export function mastodonOAuthCookie() { return OAUTH_COOKIE; }

function consumeOAuthState(state: string, nonce: string, config: Configuration): StateRow {
  if (state.length > 128 || nonce.length > 128 || !/^[A-Za-z0-9_-]+$/.test(state) || !/^[A-Za-z0-9_-]+$/.test(nonce)) {
    throw new MastodonError("Mastodon authorization could not be verified.", 400);
  }
  return transaction((db) => {
    const row = db.prepare("SELECT * FROM mastodon_oauth_states WHERE state_hash=?")
      .get(digest(state)) as StateRow | undefined;
    if (!row || row.expires_at <= new Date().toISOString() || row.nonce_hash !== digest(nonce) ||
        row.instance !== config.instance || row.redirect_uri !== config.redirectUri ||
        row.user_id !== owner() || !row.session_hash ||
        !db.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at > ?")
          .get(row.session_hash, row.user_id, new Date().toISOString())) {
      throw new MastodonError("Mastodon authorization could not be verified.", 400);
    }
    db.prepare("DELETE FROM mastodon_oauth_states WHERE state_hash=?").run(row.state_hash);
    return row;
  });
}

export async function completeMastodonConnect(state: string, code: string, nonce: string): Promise<void> {
  const config = requireConfiguration();
  if (!code || code.length > 2048) throw new MastodonError("Mastodon authorization was incomplete.", 400);
  const pending = consumeOAuthState(state, nonce, config);
  const clientId = decrypt(pending.client_id_cipher, config.key, `state:${pending.user_id}:client_id`);
  const clientSecret = decrypt(pending.client_secret_cipher, config.key, `state:${pending.user_id}:client_secret`);
  const verifier = decrypt(pending.verifier_cipher, config.key, `state:${pending.user_id}:verifier`);
  const tokenResponse = await providerRequest(config, "/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      client_secret: clientSecret, redirect_uri: pending.redirect_uri, code_verifier: verifier }),
  });
  if (!tokenResponse.ok) throw new MastodonError("Mastodon did not authorize this account.", 400);
  const tokenBody = await providerJson(tokenResponse);
  const accessToken = cleanString(tokenBody.access_token, 4096);
  let saved = false;
  try {
    const grantedScopes = typeof tokenBody.scope === "string" ? tokenBody.scope.split(/\s+/) : [];
    if (!accessToken || !grantedScopes.includes("profile") || !grantedScopes.includes("write:statuses")) {
      throw new MastodonError("Mastodon granted insufficient permissions.", 400);
    }
    const accountResponse = await providerRequest(config, "/api/v1/accounts/verify_credentials", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!accountResponse.ok) throw new MastodonError("Mastodon could not verify this account.", 502);
    const account = await providerJson(accountResponse);
    const accountId = cleanString(account.id);
    const username = cleanString(account.acct ?? account.username);
    const accountUrl = safeProviderUrl(account.url, config.instance);
    if (!accountId || !username || !accountUrl) throw new MastodonError("Mastodon returned incomplete account details.", 502);
    transaction((db) => {
      if (db.prepare("SELECT 1 FROM mastodon_connections WHERE user_id=?").get(pending.user_id)) {
        throw new MastodonError("A Mastodon account is already connected.", 409);
      }
      db.prepare(`INSERT INTO mastodon_connections
        (user_id,instance,account_id,username,account_url,access_token_cipher,client_id_cipher,client_secret_cipher,connected_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
          pending.user_id, config.instance, accountId, username, accountUrl,
          encrypt(accessToken, config.key, `connection:${pending.user_id}:token`),
          encrypt(clientId, config.key, `connection:${pending.user_id}:client_id`),
          encrypt(clientSecret, config.key, `connection:${pending.user_id}:client_secret`),
          new Date().toISOString(),
        );
      audit(pending.user_id, "mastodon.connected", accountId, config.instance);
    });
    saved = true;
  } finally {
    // An exchanged token that cannot be attached to an owner must not be left active.
    if (!saved && accessToken) {
      try {
        await providerRequest(config, "/oauth/revoke", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token: accessToken }),
        });
      } catch { /* The provider may be unavailable; the owner has no stored session. */ }
    }
  }
}

export function mastodonCallbackRedirect(success: boolean): string {
  const config = requireConfiguration();
  return `${config.publicOrigin}/?mastodon=${success ? "connected" : "error"}#account`;
}

function ageInflight(userId: string) {
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  database().prepare(`UPDATE mastodon_publish_attempts SET status='unknown',
    last_error='Publishing result was not confirmed. Check Mastodon before trying again.',updated_at=?
    WHERE user_id=? AND status='inflight' AND created_at < ?`)
    .run(new Date().toISOString(), userId, cutoff);
}

export function listMastodonPublications(userId: string) {
  ageInflight(userId);
  // Keep every unresolved attempt visible so an older uncertain result can still be checked.
  const rows = database().prepare(`SELECT client_request_id,status,created_at,remote_url,remote_id,last_error,
      text_excerpt,resolution,resolved_at
    FROM mastodon_publish_attempts WHERE user_id=? AND (
      (status='unknown' AND resolution IS NULL) OR status='inflight' OR client_request_id IN (
        SELECT client_request_id FROM mastodon_publish_attempts WHERE user_id=? ORDER BY created_at DESC LIMIT 30
      )
    ) ORDER BY created_at DESC`).all(userId, userId) as
    Pick<AttemptRow, "client_request_id" | "status" | "created_at" | "remote_url" | "remote_id" | "last_error" | "text_excerpt" | "resolution" | "resolved_at">[];
  return rows.map((row) => ({
    clientRequestId: row.client_request_id, status: row.status, createdAt: row.created_at,
    ...(row.remote_url ? { url: row.remote_url } : {}),
    ...(row.remote_id ? { id: row.remote_id } : {}),
    ...(row.last_error ? { error: row.last_error } : {}),
    ...(row.text_excerpt ? { excerpt: row.text_excerpt } : {}),
    ...(row.resolution ? { resolution: row.resolution } : {}),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
  }));
}

export function resolveMastodonPublication(userId: string, body: unknown): { ok: true } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new MastodonError("Invalid resolution request.", 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "clientRequestId" && key !== "resolution") ||
      typeof input.clientRequestId !== "string" || !UUID_PATTERN.test(input.clientRequestId) ||
      (input.resolution !== "found" && input.resolution !== "absent")) {
    throw new MastodonError("Invalid resolution request.", 400);
  }
  const clientRequestId = input.clientRequestId as string;
  const resolution = input.resolution as "found" | "absent";
  transaction((db) => {
    const attempt = db.prepare("SELECT status,resolution FROM mastodon_publish_attempts WHERE client_request_id=? AND user_id=?")
      .get(clientRequestId, userId) as Pick<AttemptRow, "status" | "resolution"> | undefined;
    if (!attempt) throw new MastodonError("Mastodon attempt was not found.", 404);
    if (attempt.status !== "unknown" || attempt.resolution) {
      throw new MastodonError("Only an unresolved, uncertain attempt can be checked off.", 409);
    }
    const now = new Date().toISOString();
    const changed = db.prepare(`UPDATE mastodon_publish_attempts SET resolution=?,resolved_at=?,updated_at=?
      WHERE client_request_id=? AND user_id=? AND status='unknown' AND resolution IS NULL`)
      .run(resolution, now, now, clientRequestId, userId);
    if (changed.changes !== 1) throw new MastodonError("Mastodon attempt changed during resolution.", 409);
    audit(userId, "mastodon.publish_resolved", clientRequestId, resolution);
  });
  return { ok: true };
}

export async function disconnectMastodon(userId: string): Promise<{ ok: true; revoked: boolean }> {
  ageInflight(userId);
  const connected = transaction((db) => {
    const row = db.prepare("SELECT * FROM mastodon_connections WHERE user_id=?").get(userId) as ConnectionRow | undefined;
    if (!row) return null;
    const now = new Date();
    db.prepare(`UPDATE mastodon_scheduled_posts SET status='unknown',
      last_error='Publishing result was not confirmed. Check Mastodon before trying again.',updated_at=?
      WHERE user_id=? AND status='inflight' AND claimed_at <= ?`)
      .run(now.toISOString(), userId, new Date(now.getTime() - 2 * 60_000).toISOString());
    if (db.prepare("SELECT 1 FROM mastodon_scheduled_posts WHERE user_id=? AND status='inflight' LIMIT 1").get(userId)) {
      throw new MastodonError("Wait for the current scheduled Mastodon post to finish before disconnecting.", 409);
    }
    if (db.prepare("SELECT 1 FROM mastodon_publish_attempts WHERE user_id=? AND status='inflight' LIMIT 1").get(userId)) {
      throw new MastodonError("Wait for the current Mastodon publishing request to finish before disconnecting.", 409);
    }
    const startedAt = row.disconnect_started_at ? Date.parse(row.disconnect_started_at) : 0;
    if (row.disconnecting && Number.isFinite(startedAt) && startedAt > Date.now() - DISCONNECT_LEASE_MS) {
      throw new MastodonError("Mastodon disconnection is already in progress. Try again shortly.", 409);
    }
    db.prepare("UPDATE mastodon_connections SET disconnecting=1,disconnect_started_at=? WHERE user_id=?")
      .run(new Date().toISOString(), userId);
    const cancelled = db.prepare(`UPDATE mastodon_scheduled_posts SET status='cancelled',updated_at=?
      WHERE user_id=? AND instance=? AND account_id=? AND status='queued'`)
      .run(now.toISOString(), userId, row.instance, row.account_id);
    if (cancelled.changes) audit(userId, "mastodon.schedule_cancelled_on_disconnect", undefined, String(cancelled.changes));
    return row;
  });
  if (!connected) return { ok: true, revoked: true };
  const config = configuration();
  let revoked = false;
  if (config && config.instance === connected.instance) {
    try {
      const token = decrypt(connected.access_token_cipher, config.key, `connection:${userId}:token`);
      const clientId = decrypt(connected.client_id_cipher, config.key, `connection:${userId}:client_id`);
      const clientSecret = decrypt(connected.client_secret_cipher, config.key, `connection:${userId}:client_secret`);
      const response = await providerRequest(config, "/oauth/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
      });
      revoked = response.ok;
    } catch { revoked = false; }
  }
  transaction((db) => {
    db.prepare("DELETE FROM mastodon_connections WHERE user_id=?").run(userId);
    audit(userId, "mastodon.disconnected", connected.account_id, revoked ? "remote-revoked" : "remote-revocation-unconfirmed");
  });
  return { ok: true, revoked };
}

function validPublishText(value: unknown): string {
  if (typeof value !== "string" || value.length > 10_000) throw new MastodonError("Enter a shorter text-only post.", 400);
  const text = value.trim();
  if (!text) throw new MastodonError("Enter text before publishing.", 400);
  return text;
}

async function instanceCharacterLimit(config: Configuration, token: string): Promise<number> {
  const response = await providerRequest(config, "/api/v2/instance", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new MastodonError("Could not check this Mastodon server's post limit.", 502);
  const body = await providerJson(response);
  const statuses = body.configuration && typeof body.configuration === "object" && !Array.isArray(body.configuration)
    ? (body.configuration as Record<string, unknown>).statuses : null;
  const max = statuses && typeof statuses === "object" && !Array.isArray(statuses)
    ? (statuses as Record<string, unknown>).max_characters : null;
  if (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 100_000) {
    throw new MastodonError("This Mastodon server did not provide a reliable post limit.", 502);
  }
  return max as number;
}

function publishResult(row: AttemptRow): { status: "posted" | "unknown"; url?: string; id?: string } {
  if (row.status === "posted" && row.remote_id) {
    return { status: "posted", id: row.remote_id, ...(row.remote_url ? { url: row.remote_url } : {}) };
  }
  return { status: "unknown" };
}

export async function publishMastodonText(userId: string, body: unknown, expectedAccountId?: string): Promise<{ status: "posted" | "unknown"; url?: string; id?: string }> {
  const config = requireConfiguration();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new MastodonError("Invalid publishing request.", 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "text" && key !== "clientRequestId")) {
    throw new MastodonError("Live Mastodon publishing currently supports text only.", 400);
  }
  const text = validPublishText(input.text);
  const requestId = input.clientRequestId;
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) throw new MastodonError("Invalid publishing request ID.", 400);
  const contentHash = digest(text);
  const now = new Date().toISOString();
  ageInflight(userId);
  const reservation = transaction((db) => {
    const connected = db.prepare("SELECT * FROM mastodon_connections WHERE user_id=?")
      .get(userId) as ConnectionRow | undefined;
    if (!connected || connected.instance !== config.instance || connected.disconnecting ||
        (expectedAccountId && connected.account_id !== expectedAccountId)) {
      throw new MastodonError("Connect a Mastodon account before publishing.", 409);
    }
    const scheduledRequest = db.prepare("SELECT * FROM mastodon_scheduled_posts WHERE client_request_id=?")
      .get(requestId) as { user_id: string; instance: string; account_id: string; content_hash: string; status: string } | undefined;
    if (scheduledRequest && (!expectedAccountId || scheduledRequest.status !== "inflight" ||
        scheduledRequest.user_id !== userId || scheduledRequest.instance !== connected.instance ||
        scheduledRequest.account_id !== connected.account_id || scheduledRequest.content_hash !== contentHash)) {
      throw new MastodonError("This request ID belongs to a scheduled post and cannot be sent manually.", 409);
    }
    const prior = db.prepare("SELECT * FROM mastodon_publish_attempts WHERE client_request_id=?")
      .get(requestId) as AttemptRow | undefined;
    if (prior) {
      if (prior.user_id !== userId || prior.instance !== connected.instance ||
          prior.account_id !== connected.account_id || prior.content_hash !== contentHash) {
        throw new MastodonError("This publishing request ID has already been used.", 409);
      }
      if (prior.status === "rejected") {
        throw new MastodonError(prior.last_error || "This publishing request was rejected. Review the post before trying again.", 409);
      }
      return { prior };
    }
    if (db.prepare(`SELECT 1 FROM mastodon_publish_attempts WHERE user_id=? AND instance=? AND account_id=?
      AND content_hash=? AND (status='inflight' OR (status='unknown' AND (resolution IS NULL OR resolution='found'))) LIMIT 1`)
      .get(userId, connected.instance, connected.account_id, contentHash)) {
      throw new MastodonError("A previous attempt for this text has an unconfirmed result. Check Mastodon before trying again.", 409);
    }
    if (db.prepare(`SELECT 1 FROM mastodon_scheduled_posts WHERE user_id=? AND instance=? AND account_id=?
      AND content_hash=? AND client_request_id<>? AND
      ((status='queued' AND ?=0) OR status='inflight' OR
       (status='unknown' AND (resolution IS NULL OR resolution='found')))
      LIMIT 1`).get(userId, connected.instance, connected.account_id, contentHash, requestId,
        expectedAccountId ? 1 : 0)) {
      throw new MastodonError("This text is already scheduled or has an uncertain scheduled result. Check it first.", 409);
    }
    db.prepare(`INSERT INTO mastodon_publish_attempts
      (client_request_id,user_id,instance,account_id,content_hash,text_excerpt,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'inflight',?,?)`).run(requestId, userId, connected.instance, connected.account_id,
        contentHash, Array.from(text).slice(0, 160).join(""), now, now);
    audit(userId, "mastodon.publish_started", requestId);
    return { connected };
  });
  if ("prior" in reservation && reservation.prior) return publishResult(reservation.prior);
  const connected = reservation.connected;
  if (!connected) throw new MastodonError("Mastodon publishing could not be prepared.", 500);

  let token: string;
  try {
    token = decrypt(connected.access_token_cipher, config.key, `connection:${userId}:token`);
    const limit = await instanceCharacterLimit(config, token);
    if (Array.from(text).length > limit) throw new MastodonError(`This Mastodon server allows at most ${limit} characters.`, 400);
  } catch (error) {
    const known = error instanceof MastodonError ? error : new MastodonError("Mastodon publishing could not be prepared.", 500);
    transaction((db) => {
      db.prepare(`UPDATE mastodon_publish_attempts SET status='rejected',last_error=?,updated_at=?
        WHERE client_request_id=? AND user_id=? AND status='inflight'`)
        .run(known.message, new Date().toISOString(), requestId, userId);
      audit(userId, "mastodon.publish_rejected", requestId, "preflight");
    });
    throw known;
  }

  let nextStatus: AttemptStatus = "unknown";
  let rejectedHttpStatus = 400;
  let errorMessage = "Publishing result was not confirmed. Check Mastodon before trying again.";
  let remoteId: string | null = null;
  let remoteUrl: string | null = null;
  try {
    const response = await providerRequest(config, "/api/v1/statuses", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": requestId },
      body: new URLSearchParams({ status: text }),
    });
    if (response.ok) {
      const post = await providerJson(response);
      remoteId = cleanString(post.id);
      remoteUrl = safeProviderUrl(post.url, connected.instance);
      const postAccount = post.account && typeof post.account === "object" && !Array.isArray(post.account)
        ? cleanString((post.account as Record<string, unknown>).id) : null;
      if (remoteId && postAccount === connected.account_id) {
        nextStatus = "posted";
        errorMessage = "";
      }
    } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      nextStatus = "rejected";
      rejectedHttpStatus = response.status === 429 ? 429 : 400;
      errorMessage = response.status === 429 ? "Mastodon is rate limiting posts. Try again later with a new request." :
        response.status === 401 || response.status === 403 ? "Mastodon authorization was rejected. Reconnect the account." :
          "Mastodon rejected this post. Check its text and account settings.";
    }
  } catch { /* A request may have reached Mastodon before the connection failed. */ }

  transaction((db) => {
    db.prepare(`UPDATE mastodon_publish_attempts SET status=?,remote_id=?,remote_url=?,last_error=?,updated_at=?
      WHERE client_request_id=? AND user_id=? AND status='inflight'`).run(
        nextStatus, remoteId, remoteUrl, errorMessage || null, new Date().toISOString(), requestId, userId,
      );
    audit(userId, `mastodon.publish_${nextStatus}`, requestId, remoteId ?? undefined);
  });
  if (nextStatus === "rejected") throw new MastodonError(errorMessage, rejectedHttpStatus);
  return nextStatus === "posted" && remoteId
    ? { status: "posted", id: remoteId, ...(remoteUrl ? { url: remoteUrl } : {}) }
    : { status: "unknown" };
}
