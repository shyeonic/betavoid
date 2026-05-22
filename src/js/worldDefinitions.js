export const WORLD_CONFIG = {
  dbName: "void-zero-world",
  dbVersion: 4,
  renderScale: 0.01,
  sectorSize: {
    x: 400000,
    y: 400000,
    z: 400000
  },
  chunkSize: {
    x: 400000,
    y: 400000,
    z: 400000
  },
  chunkGrid: {
    x: 10,
    y: 10,
    z: 10
  },
  renderChunkRadius: 1,
  placementMargin: 800,
  resourceMinDistance: 1200,
  buildingMinDistance: 1600,
  buildingResourceMinDistance: 800
};

export const WORLD_OBJECT_SCALES = {
  gas1: 18,
  gas2: 15,
  ore1: 16,
  ore2: 19,
  water1: 17,
  water2: 14,
  hq1: 5,
  hq2: 5.5
};

export const SECTOR_TEMPLATES = [
  {
    sector_id: "SEC-001",
    name: "Epsilon Prime",
    theme: "Industrial",
    theme_music_id: "bgm_sector_01",
    resource_weights: {
      gas1: 1,
      gas2: 1,
      ore1: 5,
      ore2: 5,
      water1: 2,
      water2: 2
    }
  },
  {
    sector_id: "SEC-002",
    name: "Nova Station",
    theme: "Command",
    theme_music_id: "bgm_sector_01",
    resource_weights: {
      gas1: 2,
      gas2: 2,
      ore1: 3,
      ore2: 3,
      water1: 3,
      water2: 3
    }
  },
  {
    sector_id: "SEC-003",
    name: "Azure Nebula",
    theme: "Gas Field",
    theme_music_id: "bgm_sector_01",
    resource_weights: {
      gas1: 5,
      gas2: 5,
      ore1: 1,
      ore2: 1,
      water1: 2,
      water2: 2
    }
  },
  {
    sector_id: "SEC-004",
    name: "Frost Frontier",
    theme: "Ice Belt",
    theme_music_id: "bgm_sector_01",
    resource_weights: {
      gas1: 2,
      gas2: 2,
      ore1: 2,
      ore2: 2,
      water1: 5,
      water2: 5
    }
  }
];

export const RESOURCE_DEFINITIONS = {
  gas1: {
    resource_id: "gas1",
    model_id: "gas_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2,
    visual: {
      scale: WORLD_OBJECT_SCALES.gas1,
      color: 0x82e3bd,
      emissive: 0x0b624d,
      emissiveIntensity: 0.16
    }
  },
  gas2: {
    resource_id: "gas2",
    model_id: "gas_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2,
    visual: {
      scale: WORLD_OBJECT_SCALES.gas2,
      color: 0xb4f2d1,
      emissive: 0x0b624d,
      emissiveIntensity: 0.12
    }
  },
  ore1: {
    resource_id: "ore1",
    model_id: "ore_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2,
    visual: {
      scale: WORLD_OBJECT_SCALES.ore1,
      color: 0xc4a3b9,
      emissive: 0x351c3d,
      emissiveIntensity: 0.08
    }
  },
  ore2: {
    resource_id: "ore2",
    model_id: "ore_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2,
    visual: {
      scale: WORLD_OBJECT_SCALES.ore2,
      color: 0x9fa7d8,
      emissive: 0x1b275e,
      emissiveIntensity: 0.09
    }
  },
  water1: {
    resource_id: "water1",
    model_id: "water_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2,
    visual: {
      scale: WORLD_OBJECT_SCALES.water1,
      color: 0x74c7ff,
      emissive: 0x064268,
      emissiveIntensity: 0.13
    }
  },
  water2: {
    resource_id: "water2",
    model_id: "water_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2,
    visual: {
      scale: WORLD_OBJECT_SCALES.water2,
      color: 0xa6ebff,
      emissive: 0x064268,
      emissiveIntensity: 0.1
    }
  }
};

export const BUILDING_DEFINITIONS = {
  hq1: {
    building_id: "hq1",
    model_id: "hq_01",
    hp: 5000,
    visual: {
      scale: WORLD_OBJECT_SCALES.hq1,
      color: 0xffffff,
      emissive: 0x17345e,
      emissiveIntensity: 0.08
    }
  },
  hq2: {
    building_id: "hq2",
    model_id: "hq_01",
    hp: 5000,
    visual: {
      scale: WORLD_OBJECT_SCALES.hq2,
      color: 0xd8ecff,
      emissive: 0x1d4f73,
      emissiveIntensity: 0.12
    }
  }
};

export const INITIAL_RESOURCE_TYPES = ["gas1", "gas2", "ore1", "ore2", "water1", "water2"];
export const INITIAL_BUILDING_TYPES = ["hq1", "hq2"];
