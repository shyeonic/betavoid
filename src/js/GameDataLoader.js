import { MESSAGES } from "./i18n/localeRegistry.js";
import { WORLD_CONFIG } from "./worldDefinitions.js";

const DEFAULT_GAME_DATA_BASE_URL = new URL("../gamedata/", import.meta.url);
const DEFAULT_GMAP_FILE_NAME = "galaxyMapData.gmap";
const RUNTIME_DATA_SCHEMA_VERSION = 3;

const DEFAULT_SHIP_ID = "ship_01";
const DEFAULT_SHIP_LIGHT_SETTINGS = {
  color: "#9b9bff",
  emissiveIntensity: 3,
  lightRangeScale: 2,
  minLightRange: 0.52,
  maxLightRange: 1.45,
  glowSpriteSpreadScale: 0.8,
  glowSpriteOpacity: 0.28,
  pointLightEnabled: false,
  pointIntensity: 0.2,
  pointRangeScale: 0.2
};

export async function loadGameData({ baseUrl = DEFAULT_GAME_DATA_BASE_URL, gmapFileName = DEFAULT_GMAP_FILE_NAME } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const [
    itemDefs,
    resourceDefs,
    buildingDefs,
    sectorDefs,
    shipDefs,
    i18n,
    chunkMap,
    assetRegistry,
    vfxDefs
  ] = await Promise.all([
    loadJson(base, "item_defs.json"),
    loadJson(base, "resource_defs.json"),
    loadJson(base, "building_defs.json"),
    loadJson(base, "sector_defs.json"),
    loadJson(base, "ship_defs.json"),
    loadJson(base, "i18n.json"),
    loadJson(base, "chunk_map.gmapdata"),
    loadJson(base, "asset_registry.json"),
    loadJson(base, "vfx_defs.json")
  ]);

  const gmapData = await loadGmap(new URL(gmapFileName, base));
  const clusterData = buildClusters(gmapData.chunks);
  const enabledChunks = resolveEnabledChunks({ chunkMap, clusterData, gmapData });
  const itemDefinitions = normalizeItemDefinitions(itemDefs);
  const resourceDefinitions = normalizeResourceDefinitions(resourceDefs);
  const buildingDefinitions = normalizeBuildingDefinitions(buildingDefs);
  const sectorDefinitions = normalizeSectorDefinitions(sectorDefs, i18n);
  const vfxDefinitions = normalizeVfxDefinitions(vfxDefs);
  const shipDefinitions = normalizeShipDefinitions(shipDefs, vfxDefinitions);
  const defaultShipId = resolveDefaultShipId(shipDefs, shipDefinitions);
  const messages = createMessages(i18n);

  return {
    baseUrl: base.href,
    dataSetName: inferDataSetName(base),
    gmapFileName,
    worldConfig: WORLD_CONFIG,
    itemDefinitions,
    itemIds: Object.keys(itemDefinitions),
    resourceDefinitions,
    resourceIds: Object.keys(resourceDefinitions),
    buildingDefinitions,
    buildingIds: Object.keys(buildingDefinitions),
    sectorDefinitions,
    sectorIds: Object.keys(sectorDefinitions),
    sectorTemplates: Object.values(sectorDefinitions),
    shipDefinitions,
    shipIds: Object.keys(shipDefinitions),
    vfxDefinitions,
    defaultShipId,
    initialResourceTypes: Object.keys(resourceDefinitions),
    assetRegistry,
    messages,
    chunkMap: normalizeChunkMap(chunkMap),
    gmapData,
    clusterData,
    enabledChunks,
    dataSourceKey: createDataSourceKey({
      schema: RUNTIME_DATA_SCHEMA_VERSION,
      gmap: createGmapSignature({ gmapData, clusterData }),
      runtime: createRuntimeWorldConfigSignature(WORLD_CONFIG),
      chunkMap,
      itemDefs,
      resourceDefs,
      buildingDefs,
      sectorDefs,
      sectorText: createSectorTextSignature(i18n),
      shipDefs,
      vfxDefs
    })
  };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl instanceof URL ? baseUrl : new URL(baseUrl, import.meta.url);
}

function inferDataSetName(baseUrl) {
  const parts = baseUrl.pathname.split("/").filter(Boolean);
  return parts.at(-1) || "game data";
}

async function loadJson(baseUrl, fileName) {
  const response = await fetch(new URL(fileName, baseUrl), { cache: "no-cache" });
  if (!response.ok) throw new Error(`Game data load failed: ${fileName} (${response.status})`);
  return response.json();
}

async function loadGmap(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`GMAP load failed: ${url.pathname} (${response.status})`);
  return parseGmap(await response.arrayBuffer());
}

async function parseGmap(buffer) {
  if (buffer.byteLength < 12) throw new Error("GMAP file is too small.");
  const view = new DataView(buffer);
  const magic = [0x47, 0x4d, 0x41, 0x50];
  for (let index = 0; index < magic.length; index += 1) {
    if (view.getUint8(index) !== magic[index]) throw new Error("GMAP magic mismatch.");
  }

  const gx = view.getUint16(4, true);
  const gy = view.getUint16(6, true);
  const gz = view.getUint16(8, true);
  const bits = await decompressGzip(new Uint8Array(buffer, 12));
  const chunks = [];

  for (let index = 0; index < gx * gy * gz; index += 1) {
    if (!(bits[index >> 3] & (1 << (index & 7)))) continue;
    chunks.push({
      x: Math.floor(index / (gy * gz)),
      y: Math.floor((index % (gy * gz)) / gz),
      z: index % gz
    });
  }

  return { gx, gy, gz, chunks };
}

async function decompressGzip(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser does not support GMAP gzip decompression.");
  }

  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const writePromise = writer.write(bytes);
  const closePromise = writer.close();

  const reader = stream.readable.getReader();
  const chunks = [];
  let byteLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    byteLength += value.length;
  }

  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  await writePromise;
  await closePromise;
  return output;
}

function buildClusters(chunks) {
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const chunkSet = new Set(chunks.map(chunkKey));
  const visited = new Set();
  const clusters = [];
  const clusterIds = [];
  const chunkToCluster = {};

  for (const chunk of chunks) {
    const key = chunkKey(chunk);
    if (visited.has(key)) continue;

    const stack = [key];
    const members = [];
    visited.add(key);
    while (stack.length > 0) {
      const current = stack.pop();
      members.push(current);
      const currentPosition = parseChunkKey(current);
      for (const [dx, dy, dz] of directions) {
        const next = chunkKey({ x: currentPosition.x + dx, y: currentPosition.y + dy, z: currentPosition.z + dz });
        if (!chunkSet.has(next) || visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }

    const clusterIndex = clusters.length;
    const clusterId = clusterIdForMembers(members);
    clusters.push(members);
    clusterIds.push(clusterId);
    for (const member of members) chunkToCluster[member] = clusterIndex;
  }

  return { clusters, clusterIds, chunkToCluster, chunkSet };
}

function resolveEnabledChunks({ chunkMap, clusterData, gmapData }) {
  const enabledClusterIds = new Set(
    Object.values(chunkMap.clusters || {})
      .filter((cluster) => cluster?.enabled === true)
      .map((cluster) => cluster.id)
  );
  if (enabledClusterIds.size === 0) return gmapData.chunks;

  const enabledChunkKeys = new Set();
  clusterData.clusters.forEach((members, index) => {
    const clusterId = clusterData.clusterIds[index];
    if (!enabledClusterIds.has(clusterId)) return;
    members.forEach((key) => enabledChunkKeys.add(key));
  });

  if (enabledChunkKeys.size === 0) {
    const enabledClusters = Object.values(chunkMap.clusters || {}).filter((cluster) => cluster?.enabled === true);
    for (const chunk of gmapData.chunks) {
      if (enabledClusters.some((cluster) => isChunkInBounds(chunk, cluster.bounds))) {
        enabledChunkKeys.add(chunkKey(chunk));
      }
    }
  }

  const chunks = [...enabledChunkKeys].map(parseChunkKey);
  return chunks.length > 0 ? chunks : gmapData.chunks;
}

function isChunkInBounds(chunk, bounds) {
  const min = bounds?.min;
  const max = bounds?.max;
  if (!Array.isArray(min) || !Array.isArray(max)) return false;
  return chunk.x >= min[0] && chunk.x <= max[0]
    && chunk.y >= min[1] && chunk.y <= max[1]
    && chunk.z >= min[2] && chunk.z <= max[2];
}

function clusterIdForMembers(members) {
  const bounds = clusterBounds(members);
  let hash = 2166136261;
  for (const key of [...members].sort()) {
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `cl_${members.length}_${bounds.ax}_${bounds.ay}_${bounds.az}_${bounds.bx}_${bounds.by}_${bounds.bz}_${(hash >>> 0).toString(36)}`;
}

function clusterBounds(members) {
  let ax = Infinity;
  let ay = Infinity;
  let az = Infinity;
  let bx = -Infinity;
  let by = -Infinity;
  let bz = -Infinity;

  for (const key of members) {
    const chunk = parseChunkKey(key);
    ax = Math.min(ax, chunk.x);
    ay = Math.min(ay, chunk.y);
    az = Math.min(az, chunk.z);
    bx = Math.max(bx, chunk.x);
    by = Math.max(by, chunk.y);
    bz = Math.max(bz, chunk.z);
  }

  return { ax, ay, az, bx, by, bz };
}

function normalizeItemDefinitions(raw = {}) {
  const result = {};
  for (const [key, value] of Object.entries(raw.items || {})) {
    const id = value.id || key;
    result[id] = {
      ...value,
      id,
      item_id: id,
      label_key: value.label_key || `item.${id}.name`,
      description_key: value.description_key || `item.${id}.description`,
      category: value.category || "resource",
      type: value.type || "mineral",
      mass: Number(value.mass ?? 1),
      tradable: value.tradable !== false,
      stackable: value.stackable !== false
    };
  }
  return result;
}

function normalizeResourceDefinitions(raw = {}) {
  const result = {};
  for (const [key, value] of Object.entries(raw.resources || {})) {
    const id = value.id || key;
    result[id] = {
      ...value,
      id,
      resource_id: id,
      label_key: value.label_key || `resource.${id}.name`,
      description_key: value.description_key || `resource.${id}.description`,
      produces_item_id: value.producesItemId || "",
      node_type: value.nodeType || "PERMANENT",
      total_capacity: Number(value.totalCapacity ?? 0),
      spawn_limit_per_cycle: Number(value.spawnLimitPerCycle ?? 0),
      node_capacity_range: normalizeNumberPair(value.nodeCapacityRange, [0, 0]),
      sector_ratio: Number(value.sectorRatio ?? 0),
      lifetime_range: value.lifetimeRange || null,
      base_yield_per_sec: Number(value.baseYieldPerSec ?? 0),
      visual: normalizeVisual(value.visual, "ore_01")
    };
  }
  return result;
}

function normalizeBuildingDefinitions(raw = {}) {
  const result = {};
  for (const [key, value] of Object.entries(raw.buildings || {})) {
    const id = value.id || key;
    const placementRule = normalizePlacementRule(value.placement);
    const productionProfile = normalizeProductionProfile(value.production);
    result[id] = {
      ...value,
      id,
      building_id: id,
      label_key: value.label_key || `building.${id}.name`,
      description_key: value.description_key || `building.${id}.description`,
      size: value.size || "M",
      size_key: value.size_key || `buildingSize.${value.size || "M"}`,
      category: value.category || "factory",
      category_key: value.category_key || `buildingCategory.${value.category || "factory"}`,
      hp: Number(value.hp ?? 1000),
      admin_cost: Number(value.adminCost ?? 0),
      placement_rule: placementRule,
      production_profile: productionProfile,
      docking: value.docking || { capacity: 0 },
      trade: value.trade || { enabled: false, handling_speed: 0, cargo_capacity: 0, min_reputation: 0 },
      initial_inventory: value.initialInventory || {},
      visual: normalizeVisual(value.visual, "hq_01")
    };
  }
  return result;
}

function normalizeSectorDefinitions(raw = {}, i18n = {}) {
  const result = {};
  for (const [key, value] of Object.entries(raw.sectors || {})) {
    const id = value.id || key;
    result[id] = {
      ...value,
      id,
      sector_id: id,
      label_key: value.label_key || `sector.${id}.name`,
      name: value.name || getContentDefinitionText(i18n, "sector", id, "name") || id,
      theme: value.theme || "Sector",
      theme_key: value.theme_key || `sector.${id}.theme`,
      theme_music_id: value.themeMusicId || "bgm_sector_01",
      color: parseColor(value.color, 0xffffff),
      stats: value.stats || {},
      resource_weights: value.resourceWeights || {},
      initial_buildings: value.initialBuildings || [],
      initial_resource_facilities: value.initialResourceFacilities || [],
      beta_void_count: normalizeOptionalCount(value.betaVoidCount)
    };
  }
  return result;
}

function normalizeVfxDefinitions(raw = {}) {
  const effects = {};
  for (const [key, value] of Object.entries(raw.effects || {})) {
    const id = value.id || key;
    effects[id] = {
      id,
      kind: value.kind || "emissive_light",
      label: value.label || id,
      settings: {
        ...DEFAULT_SHIP_LIGHT_SETTINGS,
        ...(value.settings || {})
      }
    };
  }
  return { version: raw.version || 1, effects };
}

function normalizeShipDefinitions(raw = {}, vfxDefinitions = { effects: {} }) {
  const result = {};
  for (const [key, value] of Object.entries(raw.ships || {})) {
    const id = value.id || key;
    result[id] = {
      ...value,
      id,
      labelKey: value.labelKey || `ui.settings.gameplay.${id}`,
      fallbackLabel: value.fallbackLabel || id,
      specs: {
        ...(value.specs || {}),
        hyperdriveSpecs: value.hyperdriveSpecs || {}
      },
      visual: normalizeShipVisual(id, value.visual, vfxDefinitions)
    };
  }
  return result;
}

function resolveDefaultShipId(raw = {}, shipDefinitions = {}) {
  if (raw.defaultShipId && shipDefinitions[raw.defaultShipId]) return raw.defaultShipId;
  if (shipDefinitions[DEFAULT_SHIP_ID]) return DEFAULT_SHIP_ID;
  return Object.keys(shipDefinitions)[0] || DEFAULT_SHIP_ID;
}

function normalizeChunkMap(raw = {}) {
  const chunks = {};
  for (const [key, value] of Object.entries(raw.chunks || {})) {
    chunks[key] = {
      sectorId: value.sectorId || null,
      resourceAmounts: value.resourceAmounts || {},
      spawnFlags: {
        betaVoid: value.spawnFlags?.betaVoid === true
      }
    };
  }

  const clusters = {};
  for (const [key, value] of Object.entries(raw.clusters || {})) {
    const id = value.id || key;
    clusters[id] = {
      ...value,
      id,
      enabled: value.enabled === true
    };
  }

  return {
    version: raw.version || 1,
    sourceGmap: raw.sourceGmap || "",
    clusters,
    chunks
  };
}

function normalizePlacementRule(raw = {}) {
  return {
    type: raw.type || "free_space",
    radius: raw.radius ?? null,
    required_resource_type: raw.requiredResourceType || null
  };
}

function normalizeProductionProfile(raw = {}) {
  const kind = raw.kind || "NONE";
  const profile = {
    kind,
    output_sink: raw.outputSink || "building_inventory",
    outputs: normalizeProductionOutputs(raw.outputs || [])
  };

  if (raw.recipeId) profile.recipe_id = raw.recipeId;
  if (raw.source) {
    profile.source = {
      ...raw.source,
      lock_expiry: raw.source.lockExpiry ?? false
    };
  } else if (kind === "RESOURCE_EXTRACTOR") {
    profile.source = {
      type: "attached_resource_node",
      depletes: raw.depletes !== false,
      lock_expiry: raw.lockExpiry ?? true
    };
  }

  return profile;
}

function normalizeProductionOutputs(outputs) {
  return outputs.map((output) => {
    const type = output.type || "item";
    if (type === "service") {
      return {
        output_type: "service",
        service_id: output.serviceId || ""
      };
    }
    return {
      output_type: "item",
      item_id: output.itemId || "$source.produces_item_id",
      amount_per_sec: output.amountPerSec ?? "$source.base_yield_per_sec"
    };
  });
}

function normalizeVisual(visual = {}, fallbackModelId = "hq_01") {
  return {
    ...visual,
    category: visual.category || null,
    model_id: visual.modelId || fallbackModelId,
    color: parseColor(visual.color, 0xffffff),
    emissive: parseColor(visual.emissive, 0x000000),
    emissiveIntensity: Number(visual.emissiveIntensity ?? 0),
    scale: Number(visual.scale ?? 1)
  };
}

function normalizeShipVisual(id, visual = {}, vfxDefinitions = { effects: {} }) {
  const modelId = visual.modelId || id;
  const reflectionIntensity = Number(visual.reflectionIntensity ?? 0.32);
  const highlightColor = normalizeColorString(visual.highlightColor || firstHighlightColor(visual) || "#ffffff");
  const effectBindings = normalizeShipEffectBindings(visual.effectBindings || []);
  const result = {
    ...visual,
    modelId,
    model_id: modelId,
    reflectionIntensity,
    highlightColor,
    materials: normalizeShipMaterials(visual, reflectionIntensity, highlightColor),
    effectBindings
  };
  result.vfx = buildShipVfxFromBindings(id, effectBindings, vfxDefinitions.effects || {});
  return result;
}

function normalizeShipMaterials(visual = {}, reflectionIntensity = 0.32, highlightColor = "#ffffff") {
  const highlights = Object.keys(visual.highlights || {}).length
    ? visual.highlights
    : {
      highlight_01: {
        id: "highlight_01",
        label: "Highlight_01",
        materialName: "Highlight_01",
        defaultColor: highlightColor
      }
    };
  highlights.highlight_01 ??= {
    id: "highlight_01",
    label: "Highlight_01",
    materialName: "Highlight_01",
    defaultColor: highlightColor
  };
  highlights.highlight_01.defaultColor = highlightColor;
  return {
    reflectionIntensity,
    emissiveSurface: {
      materialName: "EmissiveMTL_light",
      fallbackColor: "#ffffff",
      ...(visual.emissiveSurface || {})
    },
    highlights
  };
}

function normalizeShipEffectBindings(bindings = []) {
  return Array.isArray(bindings) ? bindings.map((binding) => normalizeShipBinding(binding)) : [];
}

function normalizeShipBinding(binding = {}) {
  return {
    id: binding.id || "component",
    kind: normalizeShipBindingKind(binding.kind),
    label: binding.label || binding.id || "Component",
    effectId: binding.effectId || "",
    target: {
      objectMatches: Array.isArray(binding.target?.objectMatches) ? binding.target.objectMatches : [],
      materialMatches: Array.isArray(binding.target?.materialMatches) ? binding.target.materialMatches : []
    },
    engineOutput: binding.engineOutput === true,
    defaultLight: binding.defaultLight === true,
    overrides: binding.overrides || {}
  };
}

function buildShipVfxFromBindings(shipId, bindings, effects) {
  const lightParts = bindings.map((binding) => {
    const effect = effects[binding.effectId];
    if (!effect) {
      throw new Error(`Ship ${shipId} VFX binding ${binding.id} references missing effect ${binding.effectId || "(empty)"}.`);
    }
    const lightPart = {
      id: binding.id,
      label: binding.label || binding.id,
      objectMatches: [...(binding.target?.objectMatches || [])],
      settings: {
        ...(effect.settings || {}),
        ...(binding.overrides || {})
      }
    };
    const materialMatches = [...(binding.target?.materialMatches || [])];
    if (materialMatches.length) lightPart.materialMatches = materialMatches;
    return lightPart;
  });
  const engineBinding = bindings.find((binding) => binding.engineOutput) || bindings[0] || null;
  const defaultBinding = bindings.find((binding) => binding.defaultLight) || bindings.find((binding) => binding.kind === "head_light") || null;
  return {
    defaultLightType: defaultBinding?.id ?? null,
    engineOutput: {
      controlledLightType: engineBinding?.id || lightParts[0]?.id || null,
      value: 100,
      min: {
        emissiveIntensity: 0.2,
        glowSpriteOpacity: 0.04,
        pointIntensity: 0.05
      }
    },
    lightParts
  };
}

function normalizeShipBindingKind(kind) {
  return ["engine", "head_light", "emissive_light"].includes(kind) ? kind : "emissive_light";
}

function firstHighlightColor(visual = {}) {
  const first = Object.values(visual.highlights || {})[0];
  return first?.defaultColor || null;
}

function normalizeColorString(value) {
  if (typeof value === "string") return value;
  const color = Number(value);
  if (!Number.isFinite(color)) return "#ffffff";
  return `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, "0")}`;
}

function createMessages(raw = {}) {
  const messages = structuredCloneSafe(MESSAGES);
  const locales = new Set([
    ...Object.keys(raw.system || {}),
    ...Object.keys(raw.content || {})
  ]);

  for (const locale of locales) {
    messages[locale] = deepMerge(
      messages[locale] || {},
      deepMerge(raw.system?.[locale] || {}, raw.content?.[locale] || {})
    );
  }

  return messages;
}

function createDataSourceKey(parts) {
  return `game-data:${hashText(JSON.stringify(parts))}`;
}

function createGmapSignature({ gmapData, clusterData }) {
  return {
    size: [gmapData.gx, gmapData.gy, gmapData.gz],
    chunkCount: gmapData.chunks.length,
    clusterIds: clusterData.clusterIds
  };
}

function createSectorTextSignature(raw = {}) {
  return {
    en: raw.content?.en?.sector || {},
    ko: raw.content?.ko?.sector || {}
  };
}

function createRuntimeWorldConfigSignature(config) {
  return {
    chunkSize: config.chunkSize,
    resourceCheckInterval: config.resourceCheckInterval,
    placementMargin: config.placementMargin,
    resourceMinDistance: config.resourceMinDistance,
    buildingMinDistance: config.buildingMinDistance,
    betaVoidMinDistance: config.betaVoidMinDistance,
    betaVoidPlacementMargin: config.betaVoidPlacementMargin,
    betaVoidActiveResetMinMinutes: config.betaVoidActiveResetMinMinutes,
    betaVoidActiveResetMaxMinutes: config.betaVoidActiveResetMaxMinutes
  };
}

function normalizeOptionalCount(value) {
  if (value == null || value === "") return null;
  return Math.max(0, Math.round(Number(value) || 0));
}

function parseColor(value, fallback) {
  if (Number.isFinite(Number(value))) return Number(value);
  if (typeof value === "string") {
    const normalized = value.trim().replace(/^#/, "");
    const parsed = Number.parseInt(normalized, 16);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeNumberPair(value, fallback) {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  return [Number(value[0]) || 0, Number(value[1]) || 0];
}

function getContentDefinitionText(raw = {}, group, id, field) {
  return raw.content?.en?.[group]?.[id]?.[field]
    || raw.content?.ko?.[group]?.[id]?.[field]
    || null;
}

function chunkKey(chunk) {
  return `${chunk.x}:${chunk.y}:${chunk.z}`;
}

function parseChunkKey(key) {
  const [x, y, z] = String(key).split(":").map(Number);
  return { x, y, z };
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deepMerge(base, patch) {
  const output = structuredCloneSafe(base);
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = deepMerge(output[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
