import { BETA_VOID_API_BASE_URL } from "./firebaseConfig.js";

export class OnlineApiClient {
  constructor({
    identity,
    baseUrl = BETA_VOID_API_BASE_URL,
    fetchImpl = globalThis.fetch.bind(globalThis)
  } = {}) {
    if (!identity) throw new Error("OnlineApiClient requires an identity manager.");
    this.identity = identity;
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async getWorldBootstrap() {
    const payload = await this.request("/v1/world/bootstrap");
    return normalizeWorldBootstrap(payload?.world, payload?.server_time);
  }

  async getPlayerState() {
    const payload = await this.request("/v1/player/state");
    return normalizePlayerState(payload?.state, payload?.server_time);
  }

  async commitPlayerAssets({ expectedRevision, assets, docking = null, reason }) {
    const payload = await this.request("/v1/player/assets", {
      method: "POST",
      body: {
        expected_revision: expectedRevision,
        assets,
        docking,
        reason
      }
    });
    return normalizePlayerState(payload?.state, payload?.server_time);
  }

  async savePlayerShipState(shipState) {
    const payload = await this.request("/v1/player/ship-state", {
      method: "POST",
      body: { ship_state: shipState }
    });
    return normalizePlayerState(payload?.state, payload?.server_time);
  }

  async updateProfile(displayName) {
    const payload = await this.request("/v1/profile", {
      method: "POST",
      body: { displayName }
    });
    return payload?.profile || null;
  }

  async request(path, {
    method = "GET",
    body = null,
    forceTokenRefresh = false
  } = {}) {
    const token = await this.identity.getIdToken(forceTokenRefresh);
    if (!token) throw new OnlineApiError("AUTH_REQUIRED", "Authentication is required.", 401);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body == null ? {} : { "Content-Type": "application/json" })
      },
      body: body == null ? undefined : JSON.stringify(body)
    });

    if (response.status === 401 && !forceTokenRefresh) {
      return this.request(path, {
        method,
        body,
        forceTokenRefresh: true
      });
    }

    const payload = await readJsonResponse(response);
    if (!response.ok || payload?.ok === false) {
      throw new OnlineApiError(
        payload?.error || "API_REQUEST_FAILED",
        payload?.message || `Online API request failed (${response.status}).`,
        response.status
      );
    }
    return payload;
  }
}

export class OnlineApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "OnlineApiError";
    this.code = code;
    this.status = status;
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    throw new OnlineApiError(
      "API_RESPONSE_INVALID",
      `Online API returned an invalid response (${response.status}).`,
      response.status
    );
  }
}

function normalizeWorldBootstrap(world, serverTime) {
  const revision = Number(world?.revision);
  const generatedAt = Number(world?.generated_at);
  const normalized = {
    worldId: String(world?.world_id || ""),
    seed: String(world?.seed || ""),
    dataSourceKey: String(world?.data_source_key || ""),
    revision,
    generatedAt,
    serverTime: Number(serverTime)
  };

  if (
    !normalized.worldId
    || !normalized.seed
    || !normalized.dataSourceKey
    || !Number.isInteger(revision)
    || revision < 1
    || !Number.isFinite(generatedAt)
    || generatedAt <= 0
  ) {
    throw new OnlineApiError("WORLD_BOOTSTRAP_INVALID", "Server returned an invalid world bootstrap.");
  }

  return Object.freeze(normalized);
}

function normalizePlayerState(state, serverTime) {
  const assetsRevision = Number(state?.assets_revision);
  const shipRevision = Number(state?.ship_revision);
  const normalized = {
    characterId: String(state?.character_id || ""),
    schemaVersion: Number(state?.schema_version),
    assetsRevision,
    shipRevision,
    assets: state?.assets,
    shipState: state?.ship_state || null,
    docking: state?.docking || null,
    updatedAt: Number(state?.updated_at),
    serverTime: Number(serverTime)
  };

  if (
    !normalized.characterId
    || !normalized.assets
    || typeof normalized.assets !== "object"
    || !Number.isInteger(assetsRevision)
    || assetsRevision < 1
    || !Number.isInteger(shipRevision)
    || shipRevision < 0
  ) {
    throw new OnlineApiError("PLAYER_STATE_INVALID", "Server returned an invalid player state.");
  }

  return normalized;
}
