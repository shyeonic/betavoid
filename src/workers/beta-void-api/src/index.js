import {
  commitPlayerAssets,
  getOrCreatePlayerState,
  savePlayerShipState
} from "./player-state.js";
import {
  getOrCreateWorldState,
  getWorldAdminSummary,
  listWorldAdminEntities,
  processBetaVoidEntity,
  rebuildWorldState
} from "./world-state.js";
import {
  checkpointPlayerShip,
  dockPlayerShip,
  enterPlayerBetaSpace,
  exitPlayerBetaSpace,
  getNavigationAdminSummary,
  getPlayerCommandResult,
  getPlayerNavigationState,
  listNavigationAdminHistory,
  listNavigationAdminShips,
  listZoneShipPeers,
  overridePlayerNavigation,
  startPlayerNavigation,
  undockPlayerShip
} from "./navigation-state.js";
import { reconcileResourceLifecycle } from "./resource-lifecycle.js";
export { PresenceShard } from "./presence-shard.js";

const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const KEY_CACHE_TTL_MS = 55 * 60 * 1000;
const PRIMARY_WORLD_ID = "primary";

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
        const profile = await getOrCreatePlayerProfile(env.LEGACY_DB, auth);
        return json({ ok: true, auth, profile }, { request, env });
      }

      if (url.pathname === "/v1/world/bootstrap" && request.method === "GET") {
        await requireFirebaseUser(request, env);
        const world = await getOrCreateWorldState(env.WORLD_DB);
        return json({ ok: true, world, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/world/reconcile" && request.method === "POST") {
        await requireFirebaseUser(request, env);
        const reconciliation = await reconcileResourceLifecycle(env.WORLD_DB);
        const serverTime = Date.now();
        const world = await getOrCreateWorldState(env.WORLD_DB, serverTime);
        return json({
          ok: true,
          reconciliation,
          world,
          server_time: serverTime
        }, { request, env });
      }

      if (url.pathname === "/v1/world/beta-voids/process" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const body = await readJsonBody(request);
        const result = await processBetaVoidEntity(env.WORLD_DB, {
          betaVoidId: body?.beta_void_id,
          expectedGeneration: body?.expected_generation,
          clientActionId: body?.client_action_id,
          actorCharacterId: context.characterId,
          actorShipUid: context.shipUid,
          issuedAt: body?.issued_at,
          expiresAt: body?.expires_at
        });
        const serverTime = Date.now();
        const world = await getOrCreateWorldState(env.WORLD_DB, serverTime);
        return json({ ok: true, result, world, server_time: serverTime }, { request, env });
      }

      if (url.pathname === "/v1/admin/session" && request.method === "GET") {
        const auth = requireAdmin(await requireFirebaseUser(request, env), env);
        return json({
          ok: true,
          admin: {
            uid: auth.uid,
            email: auth.email,
            name: auth.name,
            picture: auth.picture
          },
          server_time: Date.now()
        }, { request, env });
      }

      if (url.pathname === "/v1/admin/world/summary" && request.method === "GET") {
        requireAdmin(await requireFirebaseUser(request, env), env);
        const [summary, navigation] = await Promise.all([
          getWorldAdminSummary(env.WORLD_DB),
          getNavigationAdminSummary(env.WORLD_DB)
        ]);
        summary.navigation = navigation;
        return json({ ok: true, summary, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/admin/navigation/ships" && request.method === "GET") {
        requireAdmin(await requireFirebaseUser(request, env), env);
        const ships = await listNavigationAdminShips(env.WORLD_DB);
        return json({ ok: true, ships, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/admin/navigation/history" && request.method === "GET") {
        requireAdmin(await requireFirebaseUser(request, env), env);
        const movements = await listNavigationAdminHistory(env.WORLD_DB, {
          shipUid: url.searchParams.get("ship_uid"),
          ownerCharacterId: url.searchParams.get("owner_character_id"),
          routeType: url.searchParams.get("route_type"),
          status: url.searchParams.get("status"),
          limit: url.searchParams.get("limit")
        });
        return json({ ok: true, movements, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/admin/world/entities" && request.method === "GET") {
        requireAdmin(await requireFirebaseUser(request, env), env);
        const result = await listWorldAdminEntities(env.WORLD_DB, {
          entityType: url.searchParams.get("type"),
          sectorId: url.searchParams.get("sector_id"),
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit")
        });
        return json({ ok: true, ...result, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/admin/world/rebuild" && request.method === "POST") {
        requireAdmin(await requireFirebaseUser(request, env), env);
        const body = await readJsonBody(request);
        if (body?.confirmation !== "REBUILD PRIMARY WORLD") {
          throw httpError(400, "WORLD_REBUILD_CONFIRMATION_REQUIRED", "World rebuild confirmation is invalid.");
        }
        const world = await rebuildWorldState(env.WORLD_DB, {
          expectedRevision: body?.expected_revision
        });
        return json({ ok: true, world, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/player/state" && request.method === "GET") {
        const auth = await requireFirebaseUser(request, env);
        const profile = await getOrCreatePlayerProfile(env.LEGACY_DB, auth);
        const state = await getOrCreatePlayerState(env.LEGACY_DB, auth, profile);
        return json({ ok: true, state, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/player/assets" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const profile = await getOrCreatePlayerProfile(env.LEGACY_DB, auth);
        const body = await readJsonBody(request);
        const state = await commitPlayerAssets(env.LEGACY_DB, auth, profile, body);
        await getPlayerNavigationState(
          env.WORLD_DB,
          navigationContextFromPlayerState(profile, state)
        );
        return json({ ok: true, state, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/player/ship-state" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const profile = await getOrCreatePlayerProfile(env.LEGACY_DB, auth);
        const body = await readJsonBody(request);
        const state = await savePlayerShipState(env.LEGACY_DB, auth, profile, body);
        return json({ ok: true, state, server_time: Date.now() }, { request, env });
      }

      if (url.pathname === "/v1/navigation/state" && request.method === "GET") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const navigation = await getPlayerNavigationState(env.WORLD_DB, context);
        return json({ ok: true, navigation }, { request, env });
      }

      if (url.pathname === "/v1/navigation/start" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const navigation = await startPlayerNavigation(
          env.WORLD_DB,
          context,
          await readJsonBody(request)
        );
        return json({ ok: true, navigation }, { request, env });
      }

      if (url.pathname === "/v1/navigation/manual-override" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const navigation = await overridePlayerNavigation(
          env.WORLD_DB,
          context,
          await readJsonBody(request)
        );
        return json({ ok: true, navigation }, { request, env });
      }

      if (url.pathname === "/v1/navigation/checkpoint" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const navigation = await checkpointPlayerShip(
          env.WORLD_DB,
          context,
          await readJsonBody(request)
        );
        return json({ ok: true, navigation }, { request, env });
      }

      if (url.pathname === "/v1/navigation/dock" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const navigation = await dockPlayerShip(
          env.WORLD_DB,
          context,
          await readJsonBody(request)
        );
        return json({ ok: true, navigation }, { request, env });
      }

      if (url.pathname === "/v1/navigation/undock" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const navigation = await undockPlayerShip(
          env.WORLD_DB,
          context,
          await readJsonBody(request)
        );
        return json({ ok: true, navigation }, { request, env });
      }

      if (url.pathname === "/v1/navigation/beta-space/enter" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const navigation = await enterPlayerBetaSpace(
          env.WORLD_DB,
          context,
          await readJsonBody(request)
        );
        return json({ ok: true, navigation }, { request, env });
      }

      if (url.pathname === "/v1/navigation/beta-space/exit" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const navigation = await exitPlayerBetaSpace(
          env.WORLD_DB,
          context,
          await readJsonBody(request)
        );
        return json({ ok: true, navigation }, { request, env });
      }

      const commandResultMatch = url.pathname.match(/^\/v1\/navigation\/commands\/([^/]+)$/);
      if (commandResultMatch && request.method === "GET") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const result = await getPlayerCommandResult(
          env.WORLD_DB,
          context,
          decodeURIComponent(commandResultMatch[1])
        );
        if (!result) {
          throw httpError(404, "MOVEMENT_COMMAND_NOT_FOUND", "Movement command was not recorded.");
        }
        return json({ ok: true, result }, { request, env });
      }

      if (url.pathname === "/v1/space/ships" && request.method === "GET") {
        const auth = await requireFirebaseUser(request, env);
        const context = await getNavigationContext(env, auth);
        const result = await listZoneShipPeers(
          env.WORLD_DB,
          url.searchParams.get("zone_id"),
          { excludedCharacterId: context.characterId }
        );
        return json({ ok: true, ...result }, { request, env });
      }

      if (url.pathname === "/v1/presence/connect" && request.method === "GET") {
        return await connectPresence(request, env, url);
      }

      if (url.pathname === "/v1/profile" && request.method === "POST") {
        const auth = await requireFirebaseUser(request, env);
        const body = await readJsonBody(request);
        const profile = await upsertPlayerProfile(env.LEGACY_DB, auth, {
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
  const profile = await getOrCreatePlayerProfile(env.LEGACY_DB, auth);
  const state = await getOrCreatePlayerState(env.LEGACY_DB, auth, profile);
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

async function getNavigationContext(env, auth) {
  const profile = await getOrCreatePlayerProfile(env.LEGACY_DB, auth);
  const state = await getOrCreatePlayerState(env.LEGACY_DB, auth, profile);
  return navigationContextFromPlayerState(profile, state);
}

function navigationContextFromPlayerState(profile, state) {
  return {
    characterId: profile.character_id,
    displayName: profile.display_name,
    shipUid: state.assets?.profile?.active_ship_uid
      || `ship-${profile.character_id}-ship_01-001`,
    shipDefinitionId: state.assets?.profile?.selected_ship_id || "ship_01"
  };
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
    emailVerified: payload.email_verified === true,
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

function requireAdmin(auth, env) {
  const allowedEmails = new Set(
    String(env?.BETA_VOID_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  const email = String(auth?.email || "").trim().toLowerCase();
  if (!email || !auth.emailVerified || !allowedEmails.has(email)) {
    throw httpError(403, "ADMIN_REQUIRED", "Administrator access is required.");
  }
  return auth;
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

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
