export const RESOURCE_VISUALS_BY_ITEM_TYPE = {
  hydrite_mineral: {
    category: "hydrite_mineral",
    model_id: "water_01",
    color: 0x00c7ff,
    emissive: 0x064268,
    emissiveIntensity: 0.13,
    scale: 17
  },
  mineral: {
    category: "mineral",
    model_id: "ore_01",
    color: 0xb29daf,
    emissive: 0x351c3d,
    emissiveIntensity: 0.08,
    scale: 16
  },
  gas: {
    category: "gas",
    model_id: "gas_01",
    color: 0x99ffaf,
    emissive: 0x0b624d,
    emissiveIntensity: 0.14,
    scale: 16
  }
};

export const RESOURCE_DEFINITIONS = {
  rss_001: {
    resource_id: "rss_001",
    produces_item_id: "item_001",
    node_type: "PERMANENT",
    total_capacity: 1000000,
    spawn_limit_per_cycle: 200000,
    node_capacity_range: [10000, 20000],
    sector_ratio: 0.3,
    base_yield_per_sec: 5.0,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.hydrite_mineral }
  },
  rss_002: {
    resource_id: "rss_002",
    produces_item_id: "item_002",
    node_type: "PERMANENT",
    total_capacity: 600000,
    spawn_limit_per_cycle: 120000,
    node_capacity_range: [4000, 8000],
    sector_ratio: 0.4,
    base_yield_per_sec: 4.0,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.mineral }
  },
  rss_003: {
    resource_id: "rss_003",
    produces_item_id: "item_003",
    node_type: "PERMANENT",
    total_capacity: 400000,
    spawn_limit_per_cycle: 80000,
    node_capacity_range: [3000, 6000],
    sector_ratio: 0.4,
    base_yield_per_sec: 6.0,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.mineral }
  },
  rss_004: {
    resource_id: "rss_004",
    produces_item_id: "item_004",
    node_type: "PERMANENT",
    total_capacity: 600000,
    spawn_limit_per_cycle: 120000,
    node_capacity_range: [5000, 10000],
    sector_ratio: 0.5,
    base_yield_per_sec: 7.0,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.mineral }
  },
  rss_005: {
    resource_id: "rss_005",
    produces_item_id: "item_005",
    node_type: "PERMANENT",
    total_capacity: 300000,
    spawn_limit_per_cycle: 30000,
    node_capacity_range: [6000, 10000],
    sector_ratio: 0.2,
    base_yield_per_sec: 2.0,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.mineral }
  },
  rss_006: {
    resource_id: "rss_006",
    produces_item_id: "item_006",
    node_type: "PERMANENT",
    total_capacity: 200000,
    spawn_limit_per_cycle: 40000,
    node_capacity_range: [3000, 6000],
    sector_ratio: 0.3,
    base_yield_per_sec: 5.5,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.mineral }
  },
  rss_007: {
    resource_id: "rss_007",
    produces_item_id: "item_007",
    node_type: "DECAYING",
    total_capacity: 800000,
    spawn_limit_per_cycle: 40000,
    node_capacity_range: [3000, 6000],
    sector_ratio: 0.4,
    lifetime_range: [432000000, 864000000],
    base_yield_per_sec: 8.0,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.gas }
  },
  rss_008: {
    resource_id: "rss_008",
    produces_item_id: "item_008",
    node_type: "DECAYING",
    total_capacity: 600000,
    spawn_limit_per_cycle: 35000,
    node_capacity_range: [2000, 4000],
    sector_ratio: 0.2,
    lifetime_range: [432000000, 864000000],
    base_yield_per_sec: 7.5,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.gas }
  },
  rss_009: {
    resource_id: "rss_009",
    produces_item_id: "item_009",
    node_type: "DECAYING",
    total_capacity: 300000,
    spawn_limit_per_cycle: 30000,
    node_capacity_range: [2000, 4000],
    sector_ratio: 0.1,
    lifetime_range: [259200000, 518400000],
    base_yield_per_sec: 3.0,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.gas }
  },
  rss_010: {
    resource_id: "rss_010",
    produces_item_id: "item_010",
    node_type: "DECAYING",
    total_capacity: 100000,
    spawn_limit_per_cycle: 20000,
    node_capacity_range: [2000, 2000],
    sector_ratio: 0.1,
    lifetime_range: [259200000, 518400000],
    base_yield_per_sec: 1.5,
    visual: { ...RESOURCE_VISUALS_BY_ITEM_TYPE.gas }
  }
};

export const RESOURCE_IDS = Object.keys(RESOURCE_DEFINITIONS);
