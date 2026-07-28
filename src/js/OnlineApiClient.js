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

  async request(path, { forceTokenRefresh = false } = {}) {
    const token = await this.identity.getIdToken(forceTokenRefresh);
    if (!token) throw new OnlineApiError("AUTH_REQUIRED", "Authentication is required.", 401);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    if (response.status === 401 && !forceTokenRefresh) {
      return this.request(path, { forceTokenRefresh: true });
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
