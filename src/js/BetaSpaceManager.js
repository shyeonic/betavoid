import { WORLD_CONFIG } from "./worldDefinitions.js";

const BETA_SPACE_ID = "BETA-SPACE";
const BETA_SPACE_CHUNK_SPAN = 5;
const BETA_SPACE_OUT_OF_BOUNDS_GRACE_MS = 10000;
const BETA_SPACE_FALLBACK_DURATION_MS = 30 * 60 * 1000;

function cloneVector(position = {}) {
  return {
    x: Number(position.x) || 0,
    y: Number(position.y) || 0,
    z: Number(position.z) || 0
  };
}

function clampChunkIndex(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(BETA_SPACE_CHUNK_SPAN - 1, Math.floor(value)));
}

export class BetaSpaceManager {
  constructor({ worldConfig = WORLD_CONFIG } = {}) {
    this.worldConfig = worldConfig || WORLD_CONFIG;
    this.navLogSequence = 0;
  }

  enter({ sourceBetaVoid, returnState, now = Date.now() }) {
    const expiresAt = Number(sourceBetaVoid?.activeResetAt ?? sourceBetaVoid?.active_reset_at)
      || now + BETA_SPACE_FALLBACK_DURATION_MS;
    const session = {
      id: `BETA-SPACE-${sourceBetaVoid?.id || now}`,
      spaceType: "beta",
      sourceBetaVoidId: sourceBetaVoid?.id || null,
      sourceSectorId: sourceBetaVoid?.sectorId || sourceBetaVoid?.sector_id || null,
      sourceActiveResetAt: expiresAt,
      enteredAt: now,
      expiresAt,
      returnState,
      navLogs: new Map(),
      outOfBoundsSince: null,
      gameOverAssumed: false,
      gameOverToastShown: false,
      boundaryToastState: "inside",
      safeBounds: this.getSafeBounds(),
      spawnPosition: this.getSpawnPosition()
    };

    session.snapshot = this.createSnapshot(session);
    return session;
  }

  createSnapshot(session) {
    const now = session.enteredAt || Date.now();
    const chunks = this.createChunks(now);
    return {
      seed: session.id,
      generatedAt: now,
      sectors: [this.createSector(now)],
      chunks,
      resourceNodes: [],
      buildings: [],
      betaVoids: []
    };
  }

  createSector(createdAt) {
    return {
      sector_id: BETA_SPACE_ID,
      name: "Beta Space",
      theme: "beta",
      theme_music_id: "bgm_danger_01",
      chunk_id: "2:2:2",
      chunk: { x: 2, y: 2, z: 2 },
      global_bounds: this.getSafeBounds(),
      chunk_bounds: this.getSafeBounds(),
      created_at: createdAt
    };
  }

  createChunks(createdAt) {
    const chunks = [];
    const { x: sizeX, y: sizeY, z: sizeZ } = this.worldConfig.chunkSize;
    for (let z = 0; z < BETA_SPACE_CHUNK_SPAN; z += 1) {
      for (let y = 0; y < BETA_SPACE_CHUNK_SPAN; y += 1) {
        for (let x = 0; x < BETA_SPACE_CHUNK_SPAN; x += 1) {
          chunks.push({
            chunk_id: this.getChunkId({ x, y, z }),
            position: { x, y, z },
            sector_id: BETA_SPACE_ID,
            global_bounds: {
              min: { x: x * sizeX, y: y * sizeY, z: z * sizeZ },
              max: { x: (x + 1) * sizeX, y: (y + 1) * sizeY, z: (z + 1) * sizeZ }
            },
            object_counts: { resources: 0, buildings: 0, betaVoids: 0 },
            created_at: createdAt
          });
        }
      }
    }
    return chunks;
  }

  getChunkId(chunk) {
    return `${chunk.x}:${chunk.y}:${chunk.z}`;
  }

  getSafeBounds() {
    const { x, y, z } = this.worldConfig.chunkSize;
    return {
      min: { x: 0, y: 0, z: 0 },
      max: {
        x: x * BETA_SPACE_CHUNK_SPAN,
        y: y * BETA_SPACE_CHUNK_SPAN,
        z: z * BETA_SPACE_CHUNK_SPAN
      }
    };
  }

  getSpawnPosition() {
    const { x, y, z } = this.worldConfig.chunkSize;
    return {
      x: x * (BETA_SPACE_CHUNK_SPAN / 2),
      y: y * (BETA_SPACE_CHUNK_SPAN / 2),
      z: z * (BETA_SPACE_CHUNK_SPAN / 2)
    };
  }

  getChunkAtPosition(position) {
    const { x: sizeX, y: sizeY, z: sizeZ } = this.worldConfig.chunkSize;
    return {
      x: clampChunkIndex(position.x / sizeX),
      y: clampChunkIndex(position.y / sizeY),
      z: clampChunkIndex(position.z / sizeZ)
    };
  }

  isInsideSafeBounds(position) {
    const bounds = this.getSafeBounds();
    return position.x >= bounds.min.x && position.x <= bounds.max.x
      && position.y >= bounds.min.y && position.y <= bounds.max.y
      && position.z >= bounds.min.z && position.z <= bounds.max.z;
  }

  update(session, { position, now = Date.now() } = {}) {
    if (!session) return null;
    const dataPosition = cloneVector(position);
    const inside = this.isInsideSafeBounds(dataPosition);
    let boundaryEvent = null;

    if (inside) {
      if (session.outOfBoundsSince !== null) boundaryEvent = "returned";
      session.outOfBoundsSince = null;
      session.boundaryToastState = "inside";
    } else {
      if (session.outOfBoundsSince === null) {
        session.outOfBoundsSince = now;
        boundaryEvent = "left";
        session.boundaryToastState = "outside";
      }

      if (!session.gameOverAssumed && now - session.outOfBoundsSince >= BETA_SPACE_OUT_OF_BOUNDS_GRACE_MS) {
        session.gameOverAssumed = true;
        boundaryEvent = "gameOverAssumed";
      }
    }

    return {
      expired: now >= session.expiresAt,
      remainingMs: Math.max(0, session.expiresAt - now),
      insideBounds: inside,
      outOfBoundsRemainingMs: inside
        ? null
        : Math.max(0, BETA_SPACE_OUT_OF_BOUNDS_GRACE_MS - (now - session.outOfBoundsSince)),
      gameOverAssumed: session.gameOverAssumed,
      boundaryEvent
    };
  }

  getSummary(session, position) {
    const dataPosition = cloneVector(position);
    const chunk = this.getChunkAtPosition(dataPosition);
    const chunkId = this.getChunkId(chunk);
    const currentSector = session?.snapshot?.sectors?.[0] || this.createSector(session?.enteredAt || Date.now());
    return {
      seed: session?.id || BETA_SPACE_ID,
      generatedAt: session?.enteredAt || Date.now(),
      sectorCount: 1,
      chunkCount: BETA_SPACE_CHUNK_SPAN ** 3,
      resourceCount: 0,
      buildingCount: 0,
      currentSector,
      currentChunk: chunkId
    };
  }

  createNavLog(session, log) {
    if (!session) return null;
    this.navLogSequence += 1;
    const id = `BETA-NAV-${this.navLogSequence}`;
    session.navLogs.set(id, {
      ...log,
      id,
      status: log.status || "active",
      created_at: Date.now()
    });
    return id;
  }

  updateNavLog(session, id, patch = {}) {
    if (!session || !id || !session.navLogs.has(id)) return;
    const current = session.navLogs.get(id);
    session.navLogs.set(id, { ...current, ...patch, updated_at: Date.now() });
  }
}
