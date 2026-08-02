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

  async reconcileWorld() {
    const payload = await this.request("/v1/world/reconcile", {
      method: "POST",
      body: {}
    });
    return normalizeWorldBootstrap(payload?.world, payload?.server_time);
  }

  async processBetaVoid({
    betaVoidId,
    expectedGeneration,
    clientActionId,
    issuedAt,
    expiresAt
  }) {
    const payload = await this.request("/v1/world/beta-voids/process", {
      method: "POST",
      body: {
        beta_void_id: betaVoidId,
        expected_generation: expectedGeneration,
        client_action_id: clientActionId,
        issued_at: issuedAt,
        expires_at: expiresAt
      },
      timeoutMs: 4_000
    });
    return {
      result: payload?.result || null,
      world: normalizeWorldBootstrap(payload?.world, payload?.server_time)
    };
  }

  async getPlayerState() {
    const payload = await this.request("/v1/player/state");
    return normalizePlayerState(payload?.state, payload?.server_time);
  }

  async getNavigationState() {
    const payload = await this.request("/v1/navigation/state");
    return normalizeNavigationState(payload?.navigation);
  }

  async startNavigation({
    clientActionId,
    expectedRevision,
    issuedAt,
    expiresAt,
    routeType,
    target = null,
    observedShip,
    keepalive = false
  }) {
    const payload = await this.request("/v1/navigation/start", {
      method: "POST",
      body: {
        client_action_id: clientActionId,
        expected_revision: expectedRevision,
        issued_at: issuedAt,
        expires_at: expiresAt,
        route_type: routeType,
        target,
        observed_ship: observedShip
      },
      keepalive,
      timeoutMs: 4_000
    });
    return normalizeNavigationState(payload?.navigation);
  }

  async manualOverride({
    clientActionId,
    expectedRevision,
    issuedAt,
    expiresAt,
    contractId,
    desiredSpeed = null
  }) {
    const payload = await this.request("/v1/navigation/manual-override", {
      method: "POST",
      body: {
        client_action_id: clientActionId,
        expected_revision: expectedRevision,
        issued_at: issuedAt,
        expires_at: expiresAt,
        contract_id: contractId,
        desired_speed: desiredSpeed
      },
      timeoutMs: 4_000
    });
    return normalizeNavigationState(payload?.navigation);
  }

  async dockShip({
    clientActionId,
    expectedRevision,
    issuedAt,
    expiresAt,
    buildingId,
    observedShip
  }) {
    const payload = await this.request("/v1/navigation/dock", {
      method: "POST",
      body: {
        client_action_id: clientActionId,
        expected_revision: expectedRevision,
        issued_at: issuedAt,
        expires_at: expiresAt,
        building_id: buildingId,
        observed_ship: observedShip
      },
      timeoutMs: 4_000
    });
    return normalizeNavigationState(payload?.navigation);
  }

  async undockShip({ clientActionId, expectedRevision, issuedAt, expiresAt, buildingId }) {
    const payload = await this.request("/v1/navigation/undock", {
      method: "POST",
      body: {
        client_action_id: clientActionId,
        expected_revision: expectedRevision,
        issued_at: issuedAt,
        expires_at: expiresAt,
        building_id: buildingId
      },
      timeoutMs: 4_000
    });
    return normalizeNavigationState(payload?.navigation);
  }

  async enterBetaSpace({
    clientActionId,
    expectedRevision,
    issuedAt,
    expiresAt,
    betaVoidId,
    expectedGeneration,
    observedShip
  }) {
    const payload = await this.request("/v1/navigation/beta-space/enter", {
      method: "POST",
      body: {
        client_action_id: clientActionId,
        expected_revision: expectedRevision,
        issued_at: issuedAt,
        expires_at: expiresAt,
        beta_void_id: betaVoidId,
        expected_generation: expectedGeneration,
        observed_ship: observedShip
      },
      timeoutMs: 4_000
    });
    return normalizeNavigationState(payload?.navigation);
  }

  async exitBetaSpace({ clientActionId, expectedRevision, issuedAt, expiresAt }) {
    const payload = await this.request("/v1/navigation/beta-space/exit", {
      method: "POST",
      body: {
        client_action_id: clientActionId,
        expected_revision: expectedRevision,
        issued_at: issuedAt,
        expires_at: expiresAt
      },
      timeoutMs: 4_000
    });
    return normalizeNavigationState(payload?.navigation);
  }

  async getNavigationCommandResult(clientActionId) {
    const payload = await this.request(
      `/v1/navigation/commands/${encodeURIComponent(clientActionId)}`,
      { timeoutMs: 2_000 }
    );
    return {
      status: String(payload?.result?.status || ""),
      commandType: String(payload?.result?.command_type || ""),
      navigation: normalizeNavigationState(payload?.result?.navigation),
      recordedAt: Number(payload?.result?.recorded_at) || 0,
      checkedAt: Number(payload?.result?.checked_at) || 0
    };
  }

  async observeSpace({ zoneId = null, characterId = null, shipUid = null, limit = 64 } = {}) {
    const query = new URLSearchParams();
    if (zoneId) query.set("zone_id", String(zoneId));
    if (characterId) query.set("character_id", String(characterId));
    if (shipUid) query.set("ship_uid", String(shipUid));
    query.set("limit", String(limit));
    const payload = await this.request(`/v1/space/observe?${query}`);
    return {
      scope: payload?.scope === "ship" ? "ship" : "zone",
      zoneId: String(payload?.zone_id || ""),
      selector: payload?.selector && typeof payload.selector === "object"
        ? payload.selector
        : null,
      serverTime: Number(payload?.server_time) || Date.now(),
      peers: Array.isArray(payload?.peers) ? payload.peers : []
    };
  }

  listZoneShips(zoneId) {
    return this.observeSpace({ zoneId });
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

  async updateProfile(displayName) {
    const payload = await this.request("/v1/profile", {
      method: "POST",
      body: { displayName }
    });
    return payload?.profile || null;
  }

  async getAdminSession() {
    const payload = await this.request("/v1/admin/session");
    return payload?.admin || null;
  }

  async getAdminWorldSummary() {
    const payload = await this.request("/v1/admin/world/summary");
    return payload?.summary || null;
  }

  async listAdminNavigationShips() {
    const payload = await this.request("/v1/admin/navigation/ships");
    return Array.isArray(payload?.ships) ? payload.ships : [];
  }

  async listAdminNavigationHistory({
    shipUid = "",
    ownerCharacterId = "",
    routeType = "",
    status = "",
    limit = 100
  } = {}) {
    const query = new URLSearchParams();
    if (shipUid) query.set("ship_uid", shipUid);
    if (ownerCharacterId) query.set("owner_character_id", ownerCharacterId);
    if (routeType) query.set("route_type", routeType);
    if (status) query.set("status", status);
    query.set("limit", String(limit));
    const payload = await this.request(`/v1/admin/navigation/history?${query}`);
    return Array.isArray(payload?.movements) ? payload.movements : [];
  }

  async listAdminWorldEntities({
    entityType = "",
    sectorId = "",
    cursor = "",
    limit = 50
  } = {}) {
    const query = new URLSearchParams();
    if (entityType) query.set("type", entityType);
    if (sectorId) query.set("sector_id", sectorId);
    if (cursor) query.set("cursor", cursor);
    query.set("limit", String(limit));
    const payload = await this.request(`/v1/admin/world/entities?${query}`);
    return {
      entities: Array.isArray(payload?.entities) ? payload.entities : [],
      nextCursor: String(payload?.next_cursor || "")
    };
  }

  async rebuildAdminWorld({ expectedRevision, confirmation }) {
    const payload = await this.request("/v1/admin/world/rebuild", {
      method: "POST",
      body: {
        expected_revision: expectedRevision,
        confirmation
      }
    });
    return normalizeWorldBootstrap(payload?.world, payload?.server_time);
  }

  async request(path, {
    method = "GET",
    body = null,
    forceTokenRefresh = false,
    keepalive = false,
    timeoutMs = 0
  } = {}) {
    const token = await this.identity.getIdToken(forceTokenRefresh);
    if (!token) throw new OnlineApiError("AUTH_REQUIRED", "Authentication is required.", 401);

    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(body == null ? {} : { "Content-Type": "application/json" })
        },
        body: body == null ? undefined : JSON.stringify(body),
        keepalive,
        signal: controller?.signal
      });
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new OnlineApiError("NETWORK_TIMEOUT", "Online API request timed out.", 0);
      }
      throw error;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }

    const isNavigationMutation = method !== "GET" && path.startsWith("/v1/navigation/");
    if (response.status === 401 && !forceTokenRefresh && !isNavigationMutation) {
      return this.request(path, {
        method,
        body,
        keepalive,
        timeoutMs,
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
  const source = world?.snapshot;
  const snapshot = {
    sectors: Array.isArray(source?.sectors) ? source.sectors : [],
    resourceNodes: Array.isArray(source?.resource_nodes) ? source.resource_nodes : [],
    buildings: Array.isArray(source?.buildings) ? source.buildings : [],
    betaVoids: Array.isArray(source?.beta_voids) ? source.beta_voids : [],
    resourceManager: source?.resource_manager || null,
    buildingStorages: Array.isArray(source?.building_storages) ? source.building_storages : []
  };
  const normalized = {
    worldId: String(world?.world_id || ""),
    seed: String(world?.seed || ""),
    dataSourceKey: String(world?.data_source_key || ""),
    revision,
    generatedAt,
    serverTime: Number(serverTime),
    snapshot
  };

  if (
    !normalized.worldId
    || !normalized.seed
    || !normalized.dataSourceKey
    || !Number.isInteger(revision)
    || revision < 1
    || !Number.isFinite(generatedAt)
    || generatedAt <= 0
    || snapshot.sectors.length === 0
    || !snapshot.resourceManager
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

function normalizeNavigationState(value) {
  const ship = value?.ship;
  const revision = Number(ship?.revision);
  const normalized = {
    characterId: String(value?.character_id || ""),
    ship: {
      shipUid: String(ship?.ship_uid || ""),
      worldId: String(ship?.world_id || ""),
      ownerCharacterId: String(ship?.owner_character_id || ""),
      displayName: String(ship?.display_name || "Pilot"),
      shipDefinitionId: String(ship?.ship_definition_id || "ship_01"),
      spatialMode: String(ship?.spatial_mode || ""),
      position: ship?.position == null ? null : normalizeVector(ship.position),
      resolvedPosition: ship?.resolved_position == null
        ? null
        : normalizeVector(ship.resolved_position),
      rotation: normalizeQuaternion(ship?.rotation),
      speed: Number(ship?.speed) || 0,
      desiredSpeed: Number(ship?.desired_speed) || 0,
      sectorId: ship?.sector_id == null ? null : String(ship.sector_id),
      chunkId: ship?.chunk_id == null ? null : String(ship.chunk_id),
      phase: String(ship?.phase || "manual"),
      revision,
      checkpointAt: Number(ship?.checkpoint_at) || 0,
      updatedAt: Number(ship?.updated_at) || 0
    },
    custody: value?.custody
      ? {
          type: String(value.custody.type || ""),
          id: String(value.custody.id || ""),
          slot: Number(value.custody.slot),
          sinceAt: Number(value.custody.since_at) || 0,
          revision: Number(value.custody.revision) || 1,
          resolvedPosition: normalizeVector(value.custody.resolved_position)
        }
      : null,
    betaSpaceSession: value?.beta_space_session
      ? normalizeBetaSpaceSession(value.beta_space_session)
      : null,
    activeContract: value?.active_contract
      ? normalizeMovementContract(value.active_contract)
      : null,
    serverTime: Number(value?.server_time) || Date.now()
  };
  if (
    !normalized.characterId
    || !normalized.ship.shipUid
    || normalized.ship.ownerCharacterId !== normalized.characterId
    || (normalized.ship.spatialMode === "DOCKED" && !normalized.custody)
    || (normalized.ship.spatialMode !== "DOCKED" && !normalized.ship.position)
    || !Number.isInteger(revision)
    || revision < 1
  ) {
    throw new OnlineApiError(
      "NAVIGATION_STATE_INVALID",
      "Server returned an invalid navigation state."
    );
  }
  return normalized;
}

function normalizeBetaSpaceSession(value) {
  return {
    sessionId: String(value?.session_id || ""),
    sourceBetaVoidId: String(value?.source_beta_void_id || ""),
    sourceGeneration: Number(value?.source_generation) || 0,
    enteredAt: Number(value?.entered_at) || 0,
    expiresAt: Number(value?.expires_at) || 0,
    returnAnchor: {
      position: normalizeVector(value?.return_anchor?.position),
      rotation: normalizeQuaternion(value?.return_anchor?.rotation),
      speed: Number(value?.return_anchor?.speed) || 0,
      desiredSpeed: Number(value?.return_anchor?.desired_speed) || 0
    }
  };
}

function normalizeMovementContract(value) {
  return {
    contractId: String(value?.contract_id || ""),
    clientActionId: String(value?.client_action_id || ""),
    routeType: String(value?.route_type || ""),
    status: String(value?.status || ""),
    startPosition: normalizeVector(value?.start_position),
    startHeading: normalizeVector(value?.start_heading),
    startSpeed: Number(value?.start_speed) || 0,
    fromPosition: normalizeVector(value?.from_position),
    target: normalizeVector(value?.target),
    heading: normalizeVector(value?.heading),
    stopStartAt: Number(value?.stop_start_at) || 0,
    alignStartAt: Number(value?.align_start_at) || 0,
    cooldownStartAt: value?.cooldown_start_at == null
      ? null
      : Number(value.cooldown_start_at),
    flightAt: Number(value?.flight_at) || 0,
    arriveAt: Number(value?.arrive_at) || 0,
    stopDuration: Number(value?.stop_duration) || 0,
    alignDuration: Number(value?.align_duration) || 0,
    cooldownDuration: Number(value?.cooldown_duration) || 0,
    flightDuration: Number(value?.flight_duration) || 0,
    warpEntryDuration: Number(value?.warp_entry_duration) || 0,
    warpCruiseDuration: Number(value?.warp_cruise_duration) || 0,
    warpExitDuration: Number(value?.warp_exit_duration) || 0,
    peakSpeed: Number(value?.peak_speed) || 0,
    desiredSpeed: Number(value?.desired_speed) || 0,
    coastDuration: Number(value?.coast_duration) || 0,
    physics: normalizeMovementPhysics(value?.physics),
    revision: Number(value?.revision) || 1,
    issuedAt: Number(value?.issued_at) || 0,
    canceledAt: value?.canceled_at == null ? null : Number(value.canceled_at),
    settledAt: value?.settled_at == null ? null : Number(value.settled_at),
    updatedAt: Number(value?.updated_at) || 0
  };
}

function normalizeMovementPhysics(value) {
  return {
    maxSpeed: Number(value?.maxSpeed) || 0,
    minSpeed: Number(value?.minSpeed) || 0,
    accelerationRate: Number(value?.accelerationRate) || 0,
    decelerationRate: Number(value?.decelerationRate) || 0,
    arrivalRadius: Number(value?.arrivalRadius) || 0,
    deactivationCoastDuration: Number(value?.deactivationCoastDuration) || 0,
    pitchRate: Number(value?.pitchRate) || 0,
    yawRate: Number(value?.yawRate) || 0,
    strafeRate: Number(value?.strafeRate) || 0,
    verticalRate: Number(value?.verticalRate) || 0,
    hyperdrive: {
      cooldownDuration: Number(value?.hyperdrive?.cooldownDuration) || 0,
      warpEntryDuration: Number(value?.hyperdrive?.warpEntryDuration) || 0,
      warpExitDuration: Number(value?.hyperdrive?.warpExitDuration) || 0,
      warpMinFlightDuration: Number(value?.hyperdrive?.warpMinFlightDuration) || 0,
      warpFlightSpeed: Number(value?.hyperdrive?.warpFlightSpeed) || 0
    }
  };
}

function normalizeVector(value) {
  return {
    x: Number(value?.x) || 0,
    y: Number(value?.y) || 0,
    z: Number(value?.z) || 0
  };
}

function normalizeQuaternion(value) {
  const quaternion = {
    x: Number(value?.x) || 0,
    y: Number(value?.y) || 0,
    z: Number(value?.z) || 0,
    w: Number.isFinite(Number(value?.w)) ? Number(value.w) : 1
  };
  const magnitude = Math.hypot(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w
  ) || 1;
  return {
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
    w: quaternion.w / magnitude
  };
}
