import {
  commitPlayerAssets,
  getOrCreatePlayerState,
  savePlayerShipState
} from "./player-state.js";
export { PresenceShard } from "./presence-shard.js";

const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const KEY_CACHE_TTL_MS = 55 * 60 * 1000;
const PRIMARY_WORLD_ID = "primary";
const WORLD_DATA_SOURCE_KEY = "beta-void-world-v1";

let keyCache = {
  expiresAt: 0,
  keysById: null
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        return json({ ok: true, service: "beta-void-api" }, { request, env });
      }

      if (url.pathname === "/v1/me" && request.method === "GET") {
        const auth = await requireFirebaseUser(request, env);
        const profile = await getOrCreatePlayerProfile(env.DB, auth);
        return json({ ok: true, auth, profile }, { request, env });
      }

      if (url.pathname === "/v1/world/bootstrap" && request.method === "GET") {
        await requireFirebaseUser(request, env);
        const world = await getOrCreateWorldBootstrap(env.DB);
        return json({ ok: true, world, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/player/state" && request.method === "GET") {
        const auth = await requireFirebaseUser(request, env);
        const profile = await getOrCreatePlayerProfile(env.DB, auth);
        const state = await getOrCreatePlayerState(env.DB, auth, profile);
        return json({ ok: true, state, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/player/assets" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const profile = await getOrCreatePlayerProfile(env.DB, auth);
        const body = await readJsonBody(request);
        const state = await commitPlayerAssets(env.DB, auth, profile, body);
        return json({ ok: true, state, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/player/ship-state" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const profile = await getOrCreatePlayerProfile(env.DB, auth);
        const body = await readJsonBody(request);
        const state = await savePlayerShipState(env.DB, auth, profile, body);
        return json({ ok: true, state, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/presence/connect" && request.method === "GET") {
        return connectPresence(request, env, url);
      }

      if (url.pathname === "/v1/profile" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const body = await readJsonBody(request);
        const profile = await upsertPlayerProfile(env.DB, auth, {
          displayName: normalizeDisplayName(body?.displayName)
        });
        return json({ ok: true, profile }, { request, env });
      }

      return json({ ok: false, error: "NOT_FOUND" }, { status: 404, request, env });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      return json({
        ok: false,
        error: error.code || "INTERNAL_ERROR",
        message: status >= 500 ? "Internal error" : error.message
      }, { status, request, env });
    }
  }
};

async function connectPresence(request, env, url) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw httpError(426, "WEBSOCKET_REQUIRED", "WebSocket upgrade required.");
  }
  if (!env.PRESENCE) {
    throw httpError(500, "PRESENCE_CONFIG_MISSING", "Presence service is not configured.");
  }

  const auth = await requireFirebaseWebSocketUser(request, env);
  const profile = await getOrCreatePlayerProfile(env.DB, auth);
  const state = await getOrCreatePlayerState(env.DB, auth, profile);
  const worldId = normalizePresenceId(url.searchParams.get("world_id") || PRIMARY_WORLD_ID, "world");
  const zoneId = normalizePresenceId(url.searchParams.get("zone_id"), "zone");
  const shipId = normalizePresenceId(
    state.assets?.profile?.selected_ship_id || "ship_01",
    "ship"
  );
  const objectId = env.PRESENCE.idFromName(`${worldId}:${zoneId}`);
  const stub = env.PRESENCE.get(objectId);

  return stub.fetch(new Request("https://presence.internal/connect", {
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": "beta-void.v1",
      "X-Beta-Void-Character": profile.character_id,
      "X-Beta-Void-Display-Name": encodeURIComponent(profile.display_name),
      "X-Beta-Void-Ship": shipId,
      "X-Beta-Void-Zone": zoneId
    }
  }));
}

async function requireFirebaseUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw httpError(401, "AUTH_REQUIRED", "Missing Firebase ID token.");
  const auth = await verifyFirebaseIdToken(match[1], env.FIREBASE_PROJECT_ID);
  if (auth.provider !== "google.com") {
    throw httpError(403, "GOOGLE_AUTH_REQUIRED", "Google authentication is required.");
  }
  return auth;
}

async function requireFirebaseWebSocketUser(request, env) {
  const protocols = String(request.headers.get("Sec-WebSocket-Protocol") || "")
    .split(",")
    .map((value) => value.trim());
  if (!protocols.includes("beta-void.v1")) {
    throw httpError(400, "PRESENCE_PROTOCOL_INVALID", "Presence protocol is required.");
  }
  const authProtocol = protocols.find((value) => value.startsWith("firebase."));
  const token = authProtocol?.slice("firebase.".length);
  if (!token) throw httpError(401, "AUTH_REQUIRED", "Missing Firebase ID token.");
  const auth = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
  if (auth.provider !== "google.com") {
    throw httpError(403, "GOOGLE_AUTH_REQUIRED", "Google authentication is required.");
  }
  return auth;
}

async function verifyFirebaseIdToken(token, projectId) {
  if (!projectId) throw httpError(500, "AUTH_CONFIG_MISSING", "FIREBASE_PROJECT_ID is not configured.");

  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw httpError(401, "AUTH_TOKEN_INVALID", "Malformed Firebase ID token.");
  }

  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);
  const kid = header.kid;
  const alg = header.alg;
  if (alg !== "RS256" || !kid) throw httpError(401, "AUTH_TOKEN_INVALID", "Unsupported token header.");

  const keysById = await getFirebaseKeys();
  const jwk = keysById[kid];
  if (!jwk) throw httpError(401, "AUTH_TOKEN_INVALID", "Unknown token key id.");

  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    await importRsaPublicKey(jwk),
    base64UrlToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  if (!verified) throw httpError(401, "AUTH_TOKEN_INVALID", "Invalid token signature.");

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw httpError(401, "AUTH_TOKEN_INVALID", "Token audience mismatch.");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw httpError(401, "AUTH_TOKEN_INVALID", "Token issuer mismatch.");
  }
  if (!payload.sub || typeof payload.sub !== "string") {
    throw httpError(401, "AUTH_TOKEN_INVALID", "Token subject missing.");
  }
  if (payload.exp <= now) throw httpError(401, "AUTH_TOKEN_EXPIRED", "Token has expired.");
  if (payload.iat > now + 300) throw httpError(401, "AUTH_TOKEN_INVALID", "Token issued in the future.");

  return {
    uid: payload.sub,
    provider: payload.firebase?.sign_in_provider || null,
    email: payload.email || null,
    name: payload.name || null,
    picture: payload.picture || null,
    isAnonymous: payload.firebase?.sign_in_provider === "anonymous"
  };
}

async function getFirebaseKeys() {
  const now = Date.now();
  if (keyCache.keysById && keyCache.expiresAt > now) return keyCache.keysById;

  const response = await fetch(FIREBASE_JWKS_URL);
  if (!response.ok) throw httpError(503, "AUTH_KEYS_UNAVAILABLE", "Firebase public keys unavailable.");

  const maxAgeMatch = (response.headers.get("Cache-Control") || "").match(/max-age=(\d+)/);
  const ttl = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : KEY_CACHE_TTL_MS;
  const payload = await response.json();
  keyCache = {
    keysById: Object.fromEntries((payload.keys || []).map((key) => [key.kid, key])),
    expiresAt: now + Math.max(60_000, ttl)
  };
  return keyCache.keysById;
}

async function importRsaPublicKey(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

async function getOrCreatePlayerProfile(db, auth) {
  const existing = await db.prepare(
    "SELECT firebase_uid, character_id, display_name, is_anonymous, created_at, updated_at FROM player_profiles WHERE firebase_uid = ?"
  ).bind(auth.uid).first();

  if (existing) return normalizeProfileRow(existing);
  return upsertPlayerProfile(db, auth, { displayName: auth.name || "Pilot" });
}

async function getOrCreateWorldBootstrap(db) {
  const now = Date.now();
  const seed = crypto.randomUUID();
  const [, selected] = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO world_instances (
        world_id,
        seed,
        data_source_key,
        revision,
        generated_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 1, ?, ?, ?)
    `).bind(PRIMARY_WORLD_ID, seed, WORLD_DATA_SOURCE_KEY, now, now, now),
    db.prepare(`
      SELECT world_id, seed, data_source_key, revision, generated_at, created_at, updated_at
      FROM world_instances
      WHERE world_id = ?
    `).bind(PRIMARY_WORLD_ID)
  ]);

  const row = selected?.results?.[0];
  if (!row) throw httpError(500, "WORLD_BOOTSTRAP_UNAVAILABLE", "World bootstrap unavailable.");
  return normalizeWorldRow(row);
}

async function upsertPlayerProfile(db, auth, { displayName }) {
  const now = Date.now();
  const characterId = characterIdFromUid(auth.uid);
  const name = normalizeDisplayName(displayName || auth.name || "Pilot");

  await db.prepare(`
    INSERT INTO player_profiles (firebase_uid, character_id, display_name, is_anonymous, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(firebase_uid) DO UPDATE SET
      display_name = excluded.display_name,
      is_anonymous = excluded.is_anonymous,
      updated_at = excluded.updated_at
  `).bind(auth.uid, characterId, name, auth.isAnonymous ? 1 : 0, now, now).run();

  return normalizeProfileRow(await db.prepare(
    "SELECT firebase_uid, character_id, display_name, is_anonymous, created_at, updated_at FROM player_profiles WHERE firebase_uid = ?"
  ).bind(auth.uid).first());
}

function characterIdFromUid(uid) {
  return `firebase-${String(uid || "").replace(/[^\w-]/g, "_")}`;
}

function normalizeDisplayName(value) {
  return String(value || "Pilot").trim().replace(/\s+/g, " ").slice(0, 32) || "Pilot";
}

function normalizePresenceId(value, label) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || !/^[A-Za-z0-9_.:-]+$/.test(text)) {
    throw httpError(400, "PRESENCE_ZONE_INVALID", `Invalid presence ${label}.`);
  }
  return text;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "BAD_JSON", "Request body must be JSON.");
  }
}

function json(value, { status = 200, request, env } = {}) {
  return withCors(new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  }), request, env);
}

function withCors(response, request, env) {
  const origin = request?.headers.get("Origin") || "";
  const allowed = String(env?.BETA_VOID_ALLOWED_ORIGINS || "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes("*") || allowed.includes(origin) ? (origin || "*") : allowed[0] || "*";

  response.headers.set("Access-Control-Allow-Origin", allowOrigin);
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
  response.headers.set("Vary", "Origin");
  return response;
}

function decodeJwtPart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return base64ToBytes(base64);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeProfileRow(row) {
  return {
    firebase_uid: row.firebase_uid,
    character_id: row.character_id,
    display_name: row.display_name,
    is_anonymous: Boolean(row.is_anonymous),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeWorldRow(row) {
  return {
    world_id: row.world_id,
    seed: row.seed,
    data_source_key: row.data_source_key,
    revision: Number(row.revision),
    generated_at: Number(row.generated_at),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at)
  };
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
