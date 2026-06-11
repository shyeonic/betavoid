import * as THREE from "three";
import { WORLD_CONFIG } from "./worldDefinitions.js";

const DEFAULT_WORLD_MAP_VISUALS = {
  bounds: {
    chunk: { color: 0xe7f2f9, opacity: 1 },
    sector: {
      opacity: 0.5,
      colors: {
        "SEC-001": 0xffbc66,
        "SEC-002": 0x63d2ff,
        "SEC-003": 0x82e3bd,
        "SEC-004": 0xa6ebff,
        "SEC-005": 0xb896ff,
        "SEC-006": 0xff6b6b,
        "SEC-007": 0xffd166,
        "SEC-008": 0x9ee7ff,
        "SEC-009": 0x7ee081,
        "SEC-010": 0xd9d9d9
      },
      fallbackColor: 0xffffff
    }
  },
  betaVoid: {
    particleHue: 0.94,
    particleHueRange: 0.04,
    particleSaturation: 0.96,
    particleMinLightness: 0.31,
    particleMaxLightness: 0.67,
    particleBlending: "normal",
    coreColor: [1, 0.08, 0.22],
    coreCenterColor: [0, 0, 0]
  }
};

const BETA_VOID_VISUAL = {
  radius: 22,
  pointsPerBranch: 18,
  branchCount: 5,
  coreRadius: 3,
  farFadeStart: 2300,
  farFadeEnd: 3600,
  nearDistance: 900
};

export class WorldMapManager {
  constructor({
    scene,
    camera = null,
    worldConfig = WORLD_CONFIG,
    renderScale = null,
    renderResolutionScale = 1,
    environmentVisuals = DEFAULT_WORLD_MAP_VISUALS,
    buildingDefinitions = null,
    resourceDefinitions = null,
    assetRegistry = null,
    assetBaseUrl = null,
    onRenderMutation = null
  }) {
    this.scene = scene;
    this.camera = camera;
    this.worldConfig = worldConfig || WORLD_CONFIG;
    this.renderScale = renderScale ?? this.worldConfig.renderScale;
    this.renderResolutionScale = renderResolutionScale;
    this.environmentVisuals = environmentVisuals;
    this.buildingDefinitions = buildingDefinitions || {};
    this.resourceDefinitions = resourceDefinitions || {};
    this.assetRegistry = assetRegistry;
    this.assetBaseUrl = assetBaseUrl;
    this.onRenderMutation = onRenderMutation;
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
    this.animationsCache = new Map();
    this.animatedObjects = [];
    this.snapshot = null;
    this.chunkBoundsMode = "all";
    this.currentSectorId = null;
    this.fixedObjectPositionCache = new Map();
    this.chunksById = new Map();
    this.visibleChunkIds = new Set();
    this.lastVisibleChunkId = null;
    this.lastVisibleChunkRadius = null;
    this.objectBuildQueue = [];
    this.pendingObjectKeys = new Set();
    this.objectBuildBatchSize = 8;
    this.objectBuildBudgetMs = 3;
  }

  async loadAssets(resourceManager) {
    const registry = this.assetRegistry?.models;
    if (!registry) return [];

    const baseUrl = this.assetBaseUrl;
    const modelEntries = Object.entries(registry);
    const results = await Promise.allSettled(
      modelEntries.map(([id, path]) => {
        const url = baseUrl ? new URL(path, baseUrl).href : path;
        return resourceManager.loadGlbModel(`world:${id}`, { glb: url }, { label: `${id}.glb`, targetSize: 1 });
      })
    );

    results.forEach((result, index) => {
      const id = modelEntries[index][0];
      if (result.status === "fulfilled") {
        this.modelCache.set(id, result.value.object);
        if (result.value.animations?.length) {
          this.animationsCache.set(id, result.value.animations);
        }
      } else {
        console.warn(`[world-assets] ${id} rejected:`, result.reason?.message ?? result.reason);
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
    if (this.chunkBoundsMode === "off") this.clearGroup(this.sectorBoundsGroup);
    this.renderChunkBounds();
  }

  setCurrentSectorId(sectorId) {
    if (this.currentSectorId === sectorId) return;
    this.currentSectorId = sectorId || null;
    if (this.chunkBoundsMode === "sector") this.renderChunkBounds();
  }

  setEnvironmentVisuals(environmentVisuals = DEFAULT_WORLD_MAP_VISUALS) {
    this.environmentVisuals = environmentVisuals;
    this.updateBoundsMaterials();
    this.rebuildBetaVoidObjects();
  }

  rebuildBetaVoidObjects() {
    if (!this.snapshot) return;

    for (let i = this.objectsGroup.children.length - 1; i >= 0; i--) {
      const child = this.objectsGroup.children[i];
      if (child.name?.startsWith("beta-void:")) {
        this.objectsGroup.remove(child);
        this.disposeObject(child);
      }
    }

    for (let i = this.animatedObjects.length - 1; i >= 0; i--) {
      if (this.animatedObjects[i].betaVoidMaterials) this.animatedObjects.splice(i, 1);
    }

    const betaVoidKeys = [];
    for (const key of this.pendingObjectKeys) {
      if (key.startsWith("betaVoid:")) betaVoidKeys.push(key);
    }
    betaVoidKeys.forEach((key) => this.pendingObjectKeys.delete(key));
    this.objectBuildQueue = this.objectBuildQueue.filter((task) => task.kind !== "betaVoid");

    (this.snapshot.betaVoids || [])
      .filter((betaVoid) => betaVoid.status === "active")
      .filter((betaVoid) => this.visibleChunkIds.has(betaVoid.chunk_id))
      .forEach((betaVoid) => this.enqueueObjectBuild("betaVoid", betaVoid));
  }

  renderChunkBounds() {
    this.clearGroup(this.chunkBoundsGroup);
    this.onRenderMutation?.();
    if (!this.snapshot || this.chunkBoundsMode === "off") return;

    const chunks = this.chunkBoundsMode === "sector"
      ? this.currentSectorId
        ? this.snapshot.chunks.filter((chunk) => chunk.sector_id === this.currentSectorId)
        : []
      : this.snapshot.chunks;

    chunks
      .filter((chunk) => this.visibleChunkIds.has(chunk.chunk_id))
      .forEach((chunk) => this.chunkBoundsGroup.add(this.createChunkBounds(chunk)));
    this.onRenderMutation?.();
  }

  updateVisibleChunksFromPosition(dataPosition, { force = false } = {}) {
    if (!this.snapshot) return 0;

    const chunk = this.getChunkAtDataPosition(dataPosition);
    const chunkId = this.getChunkId(chunk);
    const radius = this.worldConfig.renderChunkRadius ?? 1;
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

    if (force) this.resetVisibleWorldRenderState();

    const previousVisibleChunkIds = force ? new Set() : this.visibleChunkIds;
    this.visibleChunkIds = nextVisibleChunkIds;
    this.lastVisibleChunkId = chunkId;
    this.lastVisibleChunkRadius = radius;
    this.renderVisibleWorld(previousVisibleChunkIds);
    return this.visibleChunkIds.size;
  }

  renderVisibleWorld(previousVisibleChunkIds = new Set()) {
    if (!this.snapshot) return;

    const removedChunkIds = [...previousVisibleChunkIds]
      .filter((chunkId) => !this.visibleChunkIds.has(chunkId));
    const addedChunkIds = [...this.visibleChunkIds]
      .filter((chunkId) => !previousVisibleChunkIds.has(chunkId));
    const addedChunkIdSet = new Set(addedChunkIds);

    this.removeSectorBoundsForChunks(removedChunkIds);
    this.removeObjectsForChunks(removedChunkIds);
    this.pruneObjectBuildQueue();

    if (this.chunkBoundsMode !== "off") {
      this.snapshot.sectors
        .filter((sector) => addedChunkIdSet.has(sector.chunk_id))
        .forEach((sector) => this.sectorBoundsGroup.add(this.createSectorBounds(sector)));
    }

    this.renderChunkBounds();

    (this.snapshot.betaVoids || [])
      .filter((betaVoid) => betaVoid.status === "active")
      .filter((betaVoid) => addedChunkIdSet.has(betaVoid.chunk_id))
      .forEach((betaVoid) => this.enqueueObjectBuild("betaVoid", betaVoid));

    this.snapshot.resourceNodes
      .filter((resourceNode) => addedChunkIdSet.has(resourceNode.chunk_id))
      .forEach((resourceNode) => this.enqueueObjectBuild("resource", resourceNode));

    this.snapshot.buildings
      .filter((building) => addedChunkIdSet.has(building.chunk_id))
      .forEach((building) => this.enqueueObjectBuild("building", building));
    if (removedChunkIds.length > 0 || addedChunkIds.length > 0) this.onRenderMutation?.();
  }

  resetVisibleWorldRenderState() {
    this.animatedObjects = [];
    this.resetObjectBuildQueue();
    this.clearGroup(this.sectorBoundsGroup);
    this.clearGroup(this.objectsGroup);
  }

  removeSectorBoundsForChunks(chunkIds) {
    if (chunkIds.length === 0) return;
    const chunkIdSet = new Set(chunkIds);
    for (let index = this.sectorBoundsGroup.children.length - 1; index >= 0; index -= 1) {
      const child = this.sectorBoundsGroup.children[index];
      if (!chunkIdSet.has(child.userData?.chunk_id)) continue;
      this.sectorBoundsGroup.remove(child);
      this.disposeObject(child);
    }
  }

  removeObjectsForChunks(chunkIds) {
    if (chunkIds.length === 0) return;
    const chunkIdSet = new Set(chunkIds);
    for (let index = this.objectsGroup.children.length - 1; index >= 0; index -= 1) {
      const child = this.objectsGroup.children[index];
      if (!chunkIdSet.has(child.userData?.chunk_id)) continue;
      this.objectsGroup.remove(child);
      this.disposeObject(child);
    }
    this.animatedObjects = this.animatedObjects
      .filter((item) => !chunkIdSet.has(item.object.userData?.chunk_id));
  }

  enqueueObjectBuild(kind, data) {
    const key = this.getObjectBuildKey(kind, data);
    if (!key || this.pendingObjectKeys.has(key)) return;
    this.pendingObjectKeys.add(key);
    this.objectBuildQueue.push({
      kind,
      key,
      chunkId: data.chunk_id,
      data
    });
  }

  getObjectBuildKey(kind, data) {
    if (kind === "resource") return data.resource_instance_id ? `resource:${data.resource_instance_id}` : null;
    if (kind === "building") return data.building_instance_id ? `building:${data.building_instance_id}` : null;
    if (kind === "betaVoid") return data.id ? `betaVoid:${data.id}` : null;
    return null;
  }

  resetObjectBuildQueue() {
    this.objectBuildQueue = [];
    this.pendingObjectKeys.clear();
  }

  pruneObjectBuildQueue() {
    if (this.objectBuildQueue.length === 0) return;
    this.objectBuildQueue = this.objectBuildQueue.filter((task) => {
      const keep = this.visibleChunkIds.has(task.chunkId);
      if (!keep) this.pendingObjectKeys.delete(task.key);
      return keep;
    });
  }

  processObjectBuildQueue() {
    if (!this.snapshot || this.objectBuildQueue.length === 0) return;

    const startedAt = performance.now();
    let processed = 0;

    while (this.objectBuildQueue.length > 0 && processed < this.objectBuildBatchSize) {
      if (processed > 0 && performance.now() - startedAt >= this.objectBuildBudgetMs) break;

      const task = this.objectBuildQueue.shift();
      this.pendingObjectKeys.delete(task.key);
      if (!this.visibleChunkIds.has(task.chunkId)) continue;

      const mesh = this.createObjectMesh(task.kind, task.data);
      if (mesh) this.objectsGroup.add(mesh);
      processed += 1;
    }

    if (processed > 0) this.onRenderMutation?.();
  }

  createObjectMesh(kind, data) {
    if (kind === "resource") return this.createResourceMesh(data);
    if (kind === "building") return this.createBuildingMesh(data);
    if (kind === "betaVoid") return this.createBetaVoidMesh(data);
    return null;
  }

  createResourceMesh(resourceNode) {
    const definition = this.resourceDefinitions[resourceNode.resource_id || resourceNode.type];
    if (!definition) return null;
    const object = this.createVisualObject(resourceNode.model_id, definition.visual);
    const mixer = object.userData.__mixer || null;
    const cachedPosition = this.getFixedObjectPosition(resourceNode.resource_instance_id);
    object.position.copy(cachedPosition.renderPosition);
    object.userData = {
      kind: "resource",
      id: resourceNode.resource_instance_id,
      type: resourceNode.resource_id || resourceNode.type,
      model_id: resourceNode.model_id,
      sector_id: resourceNode.sector_id,
      chunk_id: resourceNode.chunk_id,
      absolute_position: cachedPosition.absolutePosition,
      chunk_center_position: cachedPosition.chunkCenterPosition,
      chunk_center_relative_position: cachedPosition.chunkCenterRelativePosition
    };
    this.animatedObjects.push({ object, spin: 0.08 + this.animatedObjects.length * 0.012, mixer });
    return object;
  }

  createBuildingMesh(building) {
    const definition = this.buildingDefinitions[building.building_id];
    if (!definition) return null;
    const object = this.createVisualObject(building.model_id, definition.visual);
    const mixer = object.userData.__mixer || null;
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
    if (mixer) this.animatedObjects.push({ object, spin: 0, mixer });
    return object;
  }

  createBetaVoidMesh(betaVoid) {
    const cachedPosition = this.getFixedObjectPosition(betaVoid.id);
    const group = new THREE.Group();
    group.name = `beta-void:${betaVoid.id}`;
    group.position.copy(cachedPosition.renderPosition);

    const betaVoidColors = this.environmentVisuals?.betaVoid ?? DEFAULT_WORLD_MAP_VISUALS.betaVoid;
    const seed = hashString(betaVoid.id);
    const particleGeometry = this.createBetaVoidParticleGeometry(seed, betaVoidColors);
    const coreColor = betaVoidColors.coreColor ?? [1, 0.08, 0.22];
    const coreCenterColor = betaVoidColors.coreCenterColor ?? [0, 0, 0];

    const particleBlending = betaVoidColors.particleBlending === "normal"
      ? THREE.NormalBlending
      : THREE.AdditiveBlending;
    const particleMaterial = this.createBetaVoidParticleMaterial({
      baseOpacity: 0.78,
      sizeScale: 1.0,
      blending: particleBlending
    });
    const glowMaterial = this.createBetaVoidParticleMaterial({
      baseOpacity: 0.18,
      sizeScale: 4.8,
      blending: particleBlending
    });
    const coreMesh = this.createBetaVoidCoreMesh({ coreColor, coreCenterColor, seed });

    const glowPoints = new THREE.Points(particleGeometry, glowMaterial);
    const riftPoints = new THREE.Points(particleGeometry, particleMaterial);
    glowPoints.frustumCulled = false;
    riftPoints.frustumCulled = false;
    coreMesh.frustumCulled = false;
    glowPoints.renderOrder = 4;
    riftPoints.renderOrder = 5;
    coreMesh.renderOrder = 6;
    group.add(glowPoints, riftPoints, coreMesh);

    group.userData = {
      kind: "betaVoid",
      id: betaVoid.id,
      type: "beta_void",
      sector_id: betaVoid.sector_id,
      chunk_id: betaVoid.chunk_id,
      absolute_position: cachedPosition.absolutePosition,
      chunk_center_position: cachedPosition.chunkCenterPosition,
      chunk_center_relative_position: cachedPosition.chunkCenterRelativePosition,
      selectionLocalBounds: {
        radius: BETA_VOID_VISUAL.radius * 1.35
      }
    };
    this.animatedObjects.push({
      object: group,
      spin: 0.1 + (seed % 17) * 0.002,
      betaVoidMaterials: [particleMaterial, glowMaterial, coreMesh.material]
    });
    return group;
  }

  createBetaVoidParticleMaterial({ baseOpacity, sizeScale, blending = THREE.AdditiveBlending }) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending,
      uniforms: {
        uTime: { value: 0 },
        uBaseOpacity: { value: baseOpacity },
        uSizeScale: { value: sizeScale },
        uPixelRatio: { value: this.getPixelRatio() },
        uCameraPosition: { value: new THREE.Vector3() },
        uFarFadeStart: { value: BETA_VOID_VISUAL.farFadeStart },
        uFarFadeEnd: { value: BETA_VOID_VISUAL.farFadeEnd },
        uNearDistance: { value: BETA_VOID_VISUAL.nearDistance }
      },
      vertexShader: `
        attribute vec3 color;
        attribute vec3 aDrift;
        attribute float aProgress;
        attribute float aSeed;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSpin;
        attribute float aPhase;

        varying vec3 vColor;
        varying float vAlpha;

        uniform float uTime;
        uniform float uSizeScale;
        uniform float uPixelRatio;
        uniform vec3 uCameraPosition;
        uniform float uFarFadeStart;
        uniform float uFarFadeEnd;
        uniform float uNearDistance;

        void main() {
          float angle = uTime * aSpin + aPhase;
          float ca = cos(angle);
          float sa = sin(angle);
          vec3 local = position;
          local.xz = mat2(ca, -sa, sa, ca) * local.xz;

          float roll = angle * 0.31 + aSeed * 2.8;
          float cr = cos(roll);
          float sr = sin(roll);
          local.xy = mat2(cr, -sr, sr, cr) * local.xy;

          float wave = 1.0 + sin(uTime * (1.35 + aSeed * 0.35) + aProgress * 7.4 + aSeed * 19.0) * (0.025 + aProgress * 0.11);
          float flow = sin(uTime * (0.72 + aSeed * 0.45) + aSeed * 24.0) * (0.08 + aProgress * 0.34);
          vec3 animatedPosition = local * wave + aDrift * flow;

          vec4 worldPosition = modelMatrix * vec4(animatedPosition, 1.0);
          float distanceToCamera = length(worldPosition.xyz - uCameraPosition);
          float distanceFade = 1.0 - smoothstep(uFarFadeStart, uFarFadeEnd, distanceToCamera);
          float nearBoost = 1.0 + (1.0 - smoothstep(0.0, uNearDistance, distanceToCamera)) * 0.38;
          float pulse = 0.86 + 0.18 * sin(uTime * 2.2 + aSeed * 6.283 + aProgress * 8.0);

          vColor = color;
          vAlpha = aAlpha * pulse * distanceFade;

          vec4 mvPosition = viewMatrix * worldPosition;
          float perspective = 260.0 / max(1.0, -mvPosition.z);
          gl_PointSize = clamp(aSize * uSizeScale * perspective * uPixelRatio * nearBoost, 1.0, 76.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        uniform float uBaseOpacity;

        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float core = smoothstep(0.5, 0.06, d);
          float haze = smoothstep(0.5, 0.23, d) * 0.36;
          float alpha = (core + haze) * vAlpha * uBaseOpacity;
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(vColor, alpha);
        }
      `
    });
  }

  createBetaVoidCoreMesh({ coreColor = [1, 0.08, 0.22], coreCenterColor = [0, 0, 0], seed = 0 } = {}) {
    const geometry = new THREE.SphereGeometry(BETA_VOID_VISUAL.coreRadius, 32, 24);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
      uniforms: {
        uTime: { value: 0 },
        uCameraPosition: { value: new THREE.Vector3() },
        uFarFadeStart: { value: BETA_VOID_VISUAL.farFadeStart },
        uFarFadeEnd: { value: BETA_VOID_VISUAL.farFadeEnd },
        uCoreColor: { value: new THREE.Vector3(...coreColor) },
        uCoreCenterColor: { value: new THREE.Vector3(...coreCenterColor) },
        uSeed: { value: (seed % 997) / 997 }
      },
      vertexShader: `
        uniform vec3 uCameraPosition;
        uniform float uFarFadeStart;
        uniform float uFarFadeEnd;

        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying float vDistanceFade;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;

          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          float distToCamera = length(worldPosition.xyz - uCameraPosition);
          vDistanceFade = 1.0 - smoothstep(uFarFadeStart, uFarFadeEnd, distToCamera);

          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uCoreColor;
        uniform vec3 uCoreCenterColor;
        uniform float uTime;
        uniform float uSeed;

        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying float vDistanceFade;

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          float facing = max(0.0, dot(normal, viewDir));
          float fresnel = 1.0 - facing;

          float pulse = 0.92 + 0.1 * sin(uTime * 1.8 + uSeed * 9.0);

          float core = 1.0 - smoothstep(0.22, 0.38, fresnel);
          float rim = smoothstep(0.15, 0.42, fresnel) * (1.0 - smoothstep(0.42, 0.88, fresnel));
          float edgeMask = 1.0 - smoothstep(0.88, 1.0, fresnel);

          vec3 color = mix(vec3(0.0), uCoreColor * (0.38 + rim * 1.05), rim);
          color = mix(color, uCoreCenterColor, core);

          float edgeAlpha = (edgeMask * (1.0 - smoothstep(0.74, 1.0, fresnel)) * 0.64 + rim * 0.32) * pulse;
          float alpha = max(core, edgeAlpha) * vDistanceFade;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `
    });
    return new THREE.Mesh(geometry, material);
  }

  createBetaVoidParticleGeometry(seed, betaVoidColors = {}) {
    const {
      particleHue = 0.94,
      particleHueRange = 0.04,
      particleSaturation = 0.96,
      particleMinLightness = 0.31,
      particleMaxLightness = 0.67
    } = betaVoidColors;
    const rng = makeSeededRandom(seed);
    const positions = [];
    const drifts = [];
    const colors = [];
    const progress = [];
    const seeds = [];
    const sizes = [];
    const alphas = [];
    const spins = [];
    const phases = [];
    const hue = particleHue + rng() * particleHueRange;
    const spin = 0.045 + rng() * 0.055;
    const phase = rng() * Math.PI * 2;

    for (let branch = 0; branch < BETA_VOID_VISUAL.branchCount; branch += 1) {
      const dir = randomUnitVector(rng);
      const tangent = Math.abs(dir.y) < 0.92
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const sideA = new THREE.Vector3().crossVectors(dir, tangent).normalize();
      const sideB = new THREE.Vector3().crossVectors(dir, sideA).normalize();
      const branchLength = BETA_VOID_VISUAL.radius * (0.42 + rng() * 0.2);
      const branchSeed = rng();

      for (let index = 0; index < BETA_VOID_VISUAL.pointsPerBranch; index += 1) {
        const rawT = index / Math.max(1, BETA_VOID_VISUAL.pointsPerBranch - 1);
        const t = Math.pow(rawT, 1.34);
        if (t > 0.77 && rng() < (t - 0.77) * 2.25) continue;

        const radius = t * branchLength + 2.1;
        const spiral = t * 9.6 + branchSeed * 6.283;
        const rootSpread = smoothstep(0.045, 0.27, t);
        const taper = Math.pow(Math.max(0, 1 - t), 0.74);
        const branchWidth = (0.24 + 1.28 * rootSpread * taper) * (0.55 + rng() * 0.72);
        const jitter = (rng() - 0.5) * 1.1 * rootSpread * taper;
        const curlX = Math.cos(spiral) * branchWidth + jitter;
        const curlY = Math.sin(spiral) * branchWidth + jitter * 0.5;
        const x = dir.x * radius + sideA.x * curlX + sideB.x * curlY;
        const y = dir.y * radius + sideA.y * curlX + sideB.y * curlY;
        const z = dir.z * radius + sideA.z * curlX + sideB.z * curlY;

        positions.push(x, y, z);
        progress.push(t);
        const pointSeed = (rng() + seed * 0.00001) % 1;
        seeds.push(pointSeed);
        spins.push(spin);
        phases.push(phase + branch * 0.24);

        const fade = 1 - t;
        const color = new THREE.Color().setHSL((hue + t * 0.04) % 1, particleSaturation, particleMinLightness + fade * (particleMaxLightness - particleMinLightness));
        colors.push(color.r, color.g, color.b);
        sizes.push(1.5 + fade * 2.4 + rng() * 0.7);
        alphas.push(0.2 + fade * 0.86);

        const drift = randomUnitVector(rng).multiplyScalar(0.4 + t * 1.25);
        drifts.push(drift.x, drift.y, drift.z);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("aDrift", new THREE.Float32BufferAttribute(drifts, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("aProgress", new THREE.Float32BufferAttribute(progress, 1));
    geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
    geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.Float32BufferAttribute(alphas, 1));
    geometry.setAttribute("aSpin", new THREE.Float32BufferAttribute(spins, 1));
    geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(phases, 1));
    return geometry;
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
    (snapshot.betaVoids || []).forEach((betaVoid) => {
      this.fixedObjectPositionCache.set(
        betaVoid.id,
        this.createFixedObjectPositionCacheEntry(betaVoid, chunksById)
      );
      this.applyCachedPositionToObjectData(betaVoid, this.fixedObjectPositionCache.get(betaVoid.id));
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
      id: objectData.resource_instance_id || objectData.building_instance_id || objectData.id,
      kind: objectData.resource_instance_id ? "resource" : objectData.building_instance_id ? "building" : "betaVoid",
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
      x: Math.floor(position.x / this.worldConfig.chunkSize.x),
      y: Math.floor(position.y / this.worldConfig.chunkSize.y),
      z: Math.floor(position.z / this.worldConfig.chunkSize.z)
    };

    return {
      x: chunkPosition.x * this.worldConfig.chunkSize.x + this.worldConfig.chunkSize.x / 2,
      y: chunkPosition.y * this.worldConfig.chunkSize.y + this.worldConfig.chunkSize.y / 2,
      z: chunkPosition.z * this.worldConfig.chunkSize.z + this.worldConfig.chunkSize.z / 2
    };
  }

  getChunkAtDataPosition(position) {
    return {
      x: Math.floor(position.x / this.worldConfig.chunkSize.x),
      y: Math.floor(position.y / this.worldConfig.chunkSize.y),
      z: Math.floor(position.z / this.worldConfig.chunkSize.z)
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

    const clips = this.animationsCache.get(modelId);
    if (clips?.length) {
      const mixer = new THREE.AnimationMixer(object);
      clips.forEach((clip) => mixer.clipAction(clip).play());
      object.userData.__mixer = mixer;
    }

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
      opacity: this.getSectorBoundsOpacity(),
      fog: false
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.userData = {
      kind: "sector",
      sector_id: sector.sector_id,
      chunk_id: sector.chunk_id,
      name: sector.name
    };
    return lines;
  }

  createChunkBounds(chunk) {
    const chunkStyle = this.getChunkBoundsStyle();
    const lines = this.createBoxBounds(chunk.global_bounds, {
      color: chunkStyle.color,
      opacity: chunkStyle.opacity
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
      transparent: opacity < 1,
      opacity,
      fog: false,
      toneMapped: false
    });
    return new THREE.LineSegments(geometry, material);
  }

  getSectorColor(sectorId) {
    const sectorStyle = this.environmentVisuals?.bounds?.sector || DEFAULT_WORLD_MAP_VISUALS.bounds.sector;
    return sectorStyle.colors?.[sectorId] || sectorStyle.fallbackColor || 0xffffff;
  }

  getSectorBoundsOpacity() {
    return this.environmentVisuals?.bounds?.sector?.opacity ?? DEFAULT_WORLD_MAP_VISUALS.bounds.sector.opacity;
  }

  getChunkBoundsStyle() {
    return this.environmentVisuals?.bounds?.chunk || DEFAULT_WORLD_MAP_VISUALS.bounds.chunk;
  }

  updateBoundsMaterials() {
    this.sectorBoundsGroup.traverse((object) => {
      if (!object.isLineSegments || !object.material) return;
      object.material.color.setHex(this.getSectorColor(object.userData?.sector_id));
      object.material.opacity = this.getSectorBoundsOpacity();
      object.material.transparent = object.material.opacity < 1;
      object.material.needsUpdate = true;
    });

    const chunkStyle = this.getChunkBoundsStyle();
    this.chunkBoundsGroup.traverse((object) => {
      if (!object.isLineSegments || !object.material) return;
      object.material.color.setHex(chunkStyle.color);
      object.material.opacity = chunkStyle.opacity;
      object.material.transparent = chunkStyle.opacity < 1;
      object.material.needsUpdate = true;
    });
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

  getPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, 1.35) * this.renderResolutionScale;
  }

  setRenderResolutionScale(scale) {
    this.renderResolutionScale = scale;
  }

  update(dt) {
    this.processObjectBuildQueue();

    for (const item of this.animatedObjects) {
      item.object.rotation.y += dt * item.spin;
      item.mixer?.update(dt);
      if (!item.betaVoidMaterials) continue;
      const time = performance.now() * 0.001;
      item.betaVoidMaterials.forEach((material) => {
        if (!material?.uniforms) return;
        if (material.uniforms.uTime) material.uniforms.uTime.value = time;
        if (material.uniforms.uPixelRatio) material.uniforms.uPixelRatio.value = this.getPixelRatio();
        if (material.uniforms.uCameraPosition && this.camera) {
          material.uniforms.uCameraPosition.value.copy(this.camera.position);
        }
      });
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
    this.resetObjectBuildQueue();
    this.clearGroup(this.sectorBoundsGroup);
    this.clearGroup(this.chunkBoundsGroup);
    this.clearGroup(this.objectsGroup);
    this.onRenderMutation?.();
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

function makeSeededRandom(seed) {
  let value = hashString(String(seed));
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function hashString(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomUnitVector(rng) {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return new THREE.Vector3(
    radius * Math.cos(angle),
    radius * Math.sin(angle),
    z
  );
}

function smoothstep(edge0, edge1, value) {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}
