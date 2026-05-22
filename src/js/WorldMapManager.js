import * as THREE from "three";
import { ASSETS } from "./config.js";
import { BUILDING_DEFINITIONS, RESOURCE_DEFINITIONS, WORLD_CONFIG } from "./worldDefinitions.js";

export class WorldMapManager {
  constructor({ scene, renderScale = WORLD_CONFIG.renderScale }) {
    this.scene = scene;
    this.renderScale = renderScale;
    this.root = new THREE.Group();
    this.root.name = "world-map";
    this.scene.add(this.root);
    this.sectorBoundsGroup = new THREE.Group();
    this.sectorBoundsGroup.name = "sector-bounds";
    this.chunkBoundsGroup = new THREE.Group();
    this.chunkBoundsGroup.name = "chunk-bounds";
    this.objectsGroup = new THREE.Group();
    this.objectsGroup.name = "world-objects";
    this.root.add(this.sectorBoundsGroup, this.chunkBoundsGroup, this.objectsGroup);
    this.modelCache = new Map();
    this.animatedObjects = [];
    this.snapshot = null;
    this.chunkBoundsMode = "all";
    this.currentSectorId = null;
    this.fixedObjectPositionCache = new Map();
    this.chunksById = new Map();
    this.visibleChunkIds = new Set();
    this.lastVisibleChunkId = null;
    this.lastVisibleChunkRadius = null;
  }

  async loadAssets(resourceManager) {
    const modelEntries = Object.entries(ASSETS.worldModels);
    const results = await Promise.allSettled(
      modelEntries.map(([id, source]) => resourceManager.loadObjModel(`world:${id}`, source, {
        label: `${id}.obj`,
        targetSize: 1
      }))
    );

    results.forEach((result, index) => {
      const id = modelEntries[index][0];
      if (result.status === "fulfilled") {
        this.modelCache.set(id, result.value.object);
      }
    });

    return results;
  }

  renderWorld(snapshot, playerDataPosition = null) {
    this.clearWorld();
    this.snapshot = snapshot;
    if (!snapshot) return;
    this.rebuildFixedObjectPositionCache(snapshot);
    this.rebuildChunkIndex(snapshot);
    this.updateVisibleChunksFromPosition(playerDataPosition || { x: 0, y: 0, z: 0 }, { force: true });
  }

  setChunkBoundsMode(mode) {
    this.chunkBoundsMode = ["all", "sector", "off"].includes(mode) ? mode : "all";
    this.renderChunkBounds();
  }

  setCurrentSectorId(sectorId) {
    if (this.currentSectorId === sectorId) return;
    this.currentSectorId = sectorId || null;
    if (this.chunkBoundsMode === "sector") this.renderChunkBounds();
  }

  renderChunkBounds() {
    this.clearGroup(this.chunkBoundsGroup);
    if (!this.snapshot || this.chunkBoundsMode === "off") return;

    const chunks = this.chunkBoundsMode === "sector"
      ? this.currentSectorId
        ? this.snapshot.chunks.filter((chunk) => chunk.sector_id === this.currentSectorId)
        : []
      : this.snapshot.chunks;

    chunks
      .filter((chunk) => this.visibleChunkIds.has(chunk.chunk_id))
      .forEach((chunk) => this.chunkBoundsGroup.add(this.createChunkBounds(chunk)));
  }

  updateVisibleChunksFromPosition(dataPosition, { force = false } = {}) {
    if (!this.snapshot) return 0;

    const chunk = this.getChunkAtDataPosition(dataPosition);
    const chunkId = this.getChunkId(chunk);
    const radius = WORLD_CONFIG.renderChunkRadius ?? 1;
    if (!force && this.lastVisibleChunkId === chunkId && this.lastVisibleChunkRadius === radius) {
      return this.visibleChunkIds.size;
    }

    const nextVisibleChunkIds = new Set();
    for (let z = chunk.z - radius; z <= chunk.z + radius; z += 1) {
      for (let y = chunk.y - radius; y <= chunk.y + radius; y += 1) {
        for (let x = chunk.x - radius; x <= chunk.x + radius; x += 1) {
          const candidateId = this.getChunkId({ x, y, z });
          if (this.chunksById.has(candidateId)) nextVisibleChunkIds.add(candidateId);
        }
      }
    }

    this.visibleChunkIds = nextVisibleChunkIds;
    this.lastVisibleChunkId = chunkId;
    this.lastVisibleChunkRadius = radius;
    this.renderVisibleWorld();
    return this.visibleChunkIds.size;
  }

  renderVisibleWorld() {
    this.clearGroup(this.sectorBoundsGroup);
    this.clearGroup(this.objectsGroup);
    this.animatedObjects = [];
    if (!this.snapshot) return;

    this.snapshot.sectors
      .filter((sector) => this.visibleChunkIds.has(sector.chunk_id))
      .forEach((sector) => this.sectorBoundsGroup.add(this.createSectorBounds(sector)));

    this.renderChunkBounds();

    this.snapshot.resourceNodes
      .filter((resourceNode) => this.visibleChunkIds.has(resourceNode.chunk_id))
      .forEach((resourceNode) => {
        const mesh = this.createResourceMesh(resourceNode);
        if (mesh) this.objectsGroup.add(mesh);
      });

    this.snapshot.buildings
      .filter((building) => this.visibleChunkIds.has(building.chunk_id))
      .forEach((building) => {
        const mesh = this.createBuildingMesh(building);
        if (mesh) this.objectsGroup.add(mesh);
      });
  }

  createResourceMesh(resourceNode) {
    const definition = RESOURCE_DEFINITIONS[resourceNode.type];
    if (!definition) return null;
    const object = this.createVisualObject(resourceNode.model_id, definition.visual);
    const cachedPosition = this.getFixedObjectPosition(resourceNode.resource_instance_id);
    object.position.copy(cachedPosition.renderPosition);
    object.userData = {
      kind: "resource",
      id: resourceNode.resource_instance_id,
      type: resourceNode.type,
      model_id: resourceNode.model_id,
      sector_id: resourceNode.sector_id,
      chunk_id: resourceNode.chunk_id,
      absolute_position: cachedPosition.absolutePosition,
      chunk_center_position: cachedPosition.chunkCenterPosition,
      chunk_center_relative_position: cachedPosition.chunkCenterRelativePosition
    };
    this.animatedObjects.push({ object, spin: 0.08 + this.animatedObjects.length * 0.012 });
    return object;
  }

  createBuildingMesh(building) {
    const definition = BUILDING_DEFINITIONS[building.building_id];
    if (!definition) return null;
    const object = this.createVisualObject(building.model_id, definition.visual);
    const cachedPosition = this.getFixedObjectPosition(building.building_instance_id);
    object.position.copy(cachedPosition.renderPosition);
    object.userData = {
      kind: "building",
      id: building.building_instance_id,
      building_id: building.building_id,
      model_id: building.model_id,
      sector_id: building.sector_id,
      chunk_id: building.chunk_id,
      absolute_position: cachedPosition.absolutePosition,
      chunk_center_position: cachedPosition.chunkCenterPosition,
      chunk_center_relative_position: cachedPosition.chunkCenterRelativePosition
    };
    return object;
  }

  rebuildFixedObjectPositionCache(snapshot) {
    this.fixedObjectPositionCache.clear();
    const chunksById = new Map(snapshot.chunks.map((chunk) => [chunk.chunk_id, chunk]));
    snapshot.resourceNodes.forEach((resourceNode) => {
      this.fixedObjectPositionCache.set(
        resourceNode.resource_instance_id,
        this.createFixedObjectPositionCacheEntry(resourceNode, chunksById)
      );
      this.applyCachedPositionToObjectData(resourceNode, this.fixedObjectPositionCache.get(resourceNode.resource_instance_id));
    });
    snapshot.buildings.forEach((building) => {
      this.fixedObjectPositionCache.set(
        building.building_instance_id,
        this.createFixedObjectPositionCacheEntry(building, chunksById)
      );
      this.applyCachedPositionToObjectData(building, this.fixedObjectPositionCache.get(building.building_instance_id));
    });
  }

  rebuildChunkIndex(snapshot) {
    this.chunksById = new Map(snapshot.chunks.map((chunk) => [chunk.chunk_id, chunk]));
  }

  createFixedObjectPositionCacheEntry(objectData, chunksById) {
    const chunk = chunksById.get(objectData.chunk_id);
    const chunkCenterPosition = chunk
      ? this.getBoundsCenter(chunk.global_bounds)
      : this.getChunkCenterFromPosition(objectData.position, objectData.chunk);
    const absolutePosition = { ...objectData.position };
    const chunkCenterRelativePosition = {
      x: absolutePosition.x - chunkCenterPosition.x,
      y: absolutePosition.y - chunkCenterPosition.y,
      z: absolutePosition.z - chunkCenterPosition.z
    };

    return {
      id: objectData.resource_instance_id || objectData.building_instance_id,
      kind: objectData.resource_instance_id ? "resource" : "building",
      sector_id: objectData.sector_id,
      chunk_id: objectData.chunk_id,
      chunk: { ...objectData.chunk },
      absolutePosition,
      chunkCenterPosition,
      chunkCenterRelativePosition,
      renderPosition: this.toRenderVector(absolutePosition),
      renderChunkCenterRelativePosition: this.toRenderVector(chunkCenterRelativePosition)
    };
  }

  applyCachedPositionToObjectData(objectData, cachedPosition) {
    objectData.chunk_center_position = { ...cachedPosition.chunkCenterPosition };
    objectData.chunk_center_relative_position = { ...cachedPosition.chunkCenterRelativePosition };
  }

  getFixedObjectPosition(id) {
    const cached = this.fixedObjectPositionCache.get(id);
    if (!cached) throw new Error(`Missing fixed object position cache: ${id}`);
    return cached;
  }

  getBoundsCenter(bounds) {
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2
    };
  }

  getChunkCenterFromPosition(position, chunk) {
    const chunkPosition = chunk || {
      x: Math.floor(position.x / WORLD_CONFIG.chunkSize.x),
      y: Math.floor(position.y / WORLD_CONFIG.chunkSize.y),
      z: Math.floor(position.z / WORLD_CONFIG.chunkSize.z)
    };

    return {
      x: chunkPosition.x * WORLD_CONFIG.chunkSize.x + WORLD_CONFIG.chunkSize.x / 2,
      y: chunkPosition.y * WORLD_CONFIG.chunkSize.y + WORLD_CONFIG.chunkSize.y / 2,
      z: chunkPosition.z * WORLD_CONFIG.chunkSize.z + WORLD_CONFIG.chunkSize.z / 2
    };
  }

  getChunkAtDataPosition(position) {
    return {
      x: Math.floor(position.x / WORLD_CONFIG.chunkSize.x),
      y: Math.floor(position.y / WORLD_CONFIG.chunkSize.y),
      z: Math.floor(position.z / WORLD_CONFIG.chunkSize.z)
    };
  }

  getChunkId(chunk) {
    return `${chunk.x}:${chunk.y}:${chunk.z}`;
  }

  createVisualObject(modelId, visual) {
    const source = this.modelCache.get(modelId);
    const object = source ? source.clone(true) : this.createFallbackMesh(visual);
    object.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry = child.geometry.clone();
      if (child.isMesh && child.material) {
        child.material = Array.isArray(child.material)
          ? child.material.map((material) => material.clone())
          : child.material.clone();
      }
    });
    object.scale.setScalar(visual.scale);
    this.applyMaterial(object, visual);
    return object;
  }

  createFallbackMesh(visual) {
    return new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: visual.color })
    );
  }

  applyMaterial(object, visual) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        if (material.color) material.color.multiply(new THREE.Color(visual.color));
        if ("emissive" in material) material.emissive.setHex(visual.emissive ?? 0x000000);
        if ("emissiveIntensity" in material) material.emissiveIntensity = visual.emissiveIntensity ?? 0;
        material.needsUpdate = true;
      });
    });
  }

  createSectorBounds(sector) {
    const min = this.toRenderVector(sector.global_bounds.min);
    const max = this.toRenderVector(sector.global_bounds.max);
    const positions = new Float32Array([
      min.x, min.y, min.z, max.x, min.y, min.z,
      max.x, min.y, min.z, max.x, max.y, min.z,
      max.x, max.y, min.z, min.x, max.y, min.z,
      min.x, max.y, min.z, min.x, min.y, min.z,
      min.x, min.y, max.z, max.x, min.y, max.z,
      max.x, min.y, max.z, max.x, max.y, max.z,
      max.x, max.y, max.z, min.x, max.y, max.z,
      min.x, max.y, max.z, min.x, min.y, max.z,
      min.x, min.y, min.z, min.x, min.y, max.z,
      max.x, min.y, min.z, max.x, min.y, max.z,
      max.x, max.y, min.z, max.x, max.y, max.z,
      min.x, max.y, min.z, min.x, max.y, max.z
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: this.getSectorColor(sector.sector_id),
      transparent: true,
      opacity: 0.5,
      fog: false
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.userData = {
      kind: "sector",
      sector_id: sector.sector_id,
      name: sector.name
    };
    return lines;
  }

  createChunkBounds(chunk) {
    const lines = this.createBoxBounds(chunk.global_bounds, {
      color: 0x49657a,
      opacity: 0.28
    });
    lines.userData = {
      kind: "chunk",
      chunk_id: chunk.chunk_id,
      sector_id: chunk.sector_id
    };
    return lines;
  }

  createBoxBounds(bounds, { color, opacity }) {
    const min = this.toRenderVector(bounds.min);
    const max = this.toRenderVector(bounds.max);
    const positions = new Float32Array([
      min.x, min.y, min.z, max.x, min.y, min.z,
      max.x, min.y, min.z, max.x, max.y, min.z,
      max.x, max.y, min.z, min.x, max.y, min.z,
      min.x, max.y, min.z, min.x, min.y, min.z,
      min.x, min.y, max.z, max.x, min.y, max.z,
      max.x, min.y, max.z, max.x, max.y, max.z,
      max.x, max.y, max.z, min.x, max.y, max.z,
      min.x, max.y, max.z, min.x, min.y, max.z,
      min.x, min.y, min.z, min.x, min.y, max.z,
      max.x, min.y, min.z, max.x, min.y, max.z,
      max.x, max.y, min.z, max.x, max.y, max.z,
      min.x, max.y, min.z, min.x, max.y, max.z
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      fog: false
    });
    return new THREE.LineSegments(geometry, material);
  }

  getSectorColor(sectorId) {
    const colors = {
      "SEC-001": 0xffbc66,
      "SEC-002": 0x63d2ff,
      "SEC-003": 0x82e3bd,
      "SEC-004": 0xa6ebff
    };
    return colors[sectorId] || 0xffffff;
  }

  toRenderVector(position) {
    return new THREE.Vector3(
      position.x * this.renderScale,
      position.y * this.renderScale,
      position.z * this.renderScale
    );
  }

  toDataVector(position) {
    return new THREE.Vector3(
      position.x / this.renderScale,
      position.y / this.renderScale,
      position.z / this.renderScale
    );
  }

  update(dt) {
    for (const item of this.animatedObjects) {
      item.object.rotation.y += dt * item.spin;
    }
  }

  clearWorld() {
    this.snapshot = null;
    this.animatedObjects = [];
    this.fixedObjectPositionCache.clear();
    this.chunksById.clear();
    this.visibleChunkIds.clear();
    this.lastVisibleChunkId = null;
    this.lastVisibleChunkRadius = null;
    this.clearGroup(this.sectorBoundsGroup);
    this.clearGroup(this.chunkBoundsGroup);
    this.clearGroup(this.objectsGroup);
  }

  clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children.pop();
      this.disposeObject(child);
    }
  }

  disposeObject(object) {
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  dispose() {
    this.clearWorld();
    this.scene.remove(this.root);
    this.disposeObject(this.root);
    this.modelCache.clear();
  }
}
