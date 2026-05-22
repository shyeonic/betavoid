const baseSector = ({
  sector_id,
  name,
  theme,
  stats,
  resource_weights,
  initial_buildings = [],
  initial_resource_facilities = [],
  theme_music_id = "bgm_sector_01"
}) => ({
  sector_id,
  name,
  theme,
  theme_music_id,
  stats,
  resource_weights,
  initial_buildings,
  initial_resource_facilities
});

export const SECTOR_DEFINITIONS = {
  "SEC-001": baseSector({
    sector_id: "SEC-001",
    name: "EPSILON PRIME",
    theme: "Volcanic_Industrial",
    stats: {
      base_gdp_coeff: 1.2,
      admin_capacity: 500,
      population_cap: 1000000,
      environmental_weight: { mining_efficiency: 1.5, agriculture_efficiency: 0.5 }
    },
    resource_weights: { rss_001: 5, rss_002: 15, rss_003: 10, rss_004: 20, rss_005: 2, rss_006: 8, rss_007: 3, rss_008: 2, rss_009: 0, rss_010: 0 },
    initial_buildings: [
      { building_id: "arc_station", count: 1 },
      { building_id: "plasma_power_plant", count: 2 },
      { building_id: "orbital_dorm", count: 3 },
      { building_id: "orbital_defence_turret", count: 5 }
    ],
    initial_resource_facilities: [
      { building_id: "mine", count: 4 },
      { building_id: "refinery", count: 2 },
      { building_id: "hydro_synthesizer", count: 1 }
    ]
  }),
  "SEC-002": baseSector({
    sector_id: "SEC-002",
    name: "NOVA STATION",
    theme: "Trade_Hub",
    stats: {
      base_gdp_coeff: 1.5,
      admin_capacity: 800,
      population_cap: 2000000,
      environmental_weight: { mining_efficiency: 1.0, agriculture_efficiency: 1.0 }
    },
    resource_weights: { rss_001: 8, rss_002: 10, rss_003: 12, rss_004: 10, rss_005: 5, rss_006: 10, rss_007: 5, rss_008: 5, rss_009: 3, rss_010: 2 },
    initial_buildings: [
      { building_id: "arc_station", count: 1 },
      { building_id: "plasma_power_plant", count: 1 },
      { building_id: "orbital_dorm", count: 2 },
      { building_id: "orbital_defence_turret", count: 4 }
    ],
    initial_resource_facilities: [
      { building_id: "mine", count: 2 },
      { building_id: "refinery", count: 2 },
      { building_id: "hydro_synthesizer", count: 1 }
    ]
  }),
  "SEC-003": baseSector({
    sector_id: "SEC-003",
    name: "CRIMSON EXPANSE",
    theme: "Desert_Wasteland",
    stats: {
      base_gdp_coeff: 0.8,
      admin_capacity: 300,
      population_cap: 500000,
      environmental_weight: { mining_efficiency: 1.2, agriculture_efficiency: 0.3 }
    },
    resource_weights: { rss_001: 3, rss_002: 8, rss_003: 6, rss_004: 12, rss_005: 1, rss_006: 15, rss_007: 1, rss_008: 1, rss_009: 0, rss_010: 0 }
  }),
  "SEC-004": baseSector({
    sector_id: "SEC-004",
    name: "AZURE NEBULA",
    theme: "Gas_Giant",
    stats: {
      base_gdp_coeff: 1.1,
      admin_capacity: 400,
      population_cap: 800000,
      environmental_weight: { mining_efficiency: 0.5, agriculture_efficiency: 0.2 }
    },
    resource_weights: { rss_001: 2, rss_002: 3, rss_003: 2, rss_004: 4, rss_005: 0, rss_006: 3, rss_007: 20, rss_008: 25, rss_009: 15, rss_010: 10 }
  }),
  "SEC-005": baseSector({
    sector_id: "SEC-005",
    name: "OBSIDIAN REACH",
    theme: "Dark_Matter_Zone",
    stats: {
      base_gdp_coeff: 1.0,
      admin_capacity: 600,
      population_cap: 1200000,
      environmental_weight: { mining_efficiency: 0.8, agriculture_efficiency: 0.4 }
    },
    resource_weights: { rss_001: 10, rss_002: 5, rss_003: 5, rss_004: 8, rss_005: 3, rss_006: 5, rss_007: 8, rss_008: 8, rss_009: 12, rss_010: 15 }
  }),
  "SEC-006": baseSector({
    sector_id: "SEC-006",
    name: "TITAN'S GATE",
    theme: "Military_Fortress",
    stats: {
      base_gdp_coeff: 1.3,
      admin_capacity: 700,
      population_cap: 1500000,
      environmental_weight: { mining_efficiency: 1.1, agriculture_efficiency: 0.7 }
    },
    resource_weights: { rss_001: 6, rss_002: 18, rss_003: 15, rss_004: 25, rss_005: 3, rss_006: 10, rss_007: 4, rss_008: 3, rss_009: 1, rss_010: 0 }
  }),
  "SEC-007": baseSector({
    sector_id: "SEC-007",
    name: "HELIOS CORE",
    theme: "Solar_Forge",
    stats: {
      base_gdp_coeff: 1.4,
      admin_capacity: 550,
      population_cap: 1100000,
      environmental_weight: { mining_efficiency: 1.3, agriculture_efficiency: 0.6 }
    },
    resource_weights: { rss_001: 12, rss_002: 12, rss_003: 10, rss_004: 15, rss_005: 4, rss_006: 8, rss_007: 10, rss_008: 8, rss_009: 2, rss_010: 1 }
  }),
  "SEC-008": baseSector({
    sector_id: "SEC-008",
    name: "FROST FRONTIER",
    theme: "Ice_World",
    stats: {
      base_gdp_coeff: 0.9,
      admin_capacity: 350,
      population_cap: 700000,
      environmental_weight: { mining_efficiency: 1.0, agriculture_efficiency: 0.5 }
    },
    resource_weights: { rss_001: 4, rss_002: 6, rss_003: 5, rss_004: 8, rss_005: 1, rss_006: 4, rss_007: 6, rss_008: 5, rss_009: 3, rss_010: 2 }
  }),
  "SEC-009": baseSector({
    sector_id: "SEC-009",
    name: "EMERALD HAVEN",
    theme: "Agricultural_Paradise",
    stats: {
      base_gdp_coeff: 1.1,
      admin_capacity: 450,
      population_cap: 900000,
      environmental_weight: { mining_efficiency: 0.6, agriculture_efficiency: 1.7 }
    },
    resource_weights: { rss_001: 3, rss_002: 4, rss_003: 6, rss_004: 6, rss_005: 2, rss_006: 5, rss_007: 4, rss_008: 4, rss_009: 1, rss_010: 1 }
  }),
  "SEC-010": baseSector({
    sector_id: "SEC-010",
    name: "VOID EDGE",
    theme: "Frontier_Outpost",
    stats: {
      base_gdp_coeff: 0.7,
      admin_capacity: 250,
      population_cap: 400000,
      environmental_weight: { mining_efficiency: 0.9, agriculture_efficiency: 0.8 }
    },
    resource_weights: { rss_001: 7, rss_002: 8, rss_003: 7, rss_004: 10, rss_005: 6, rss_006: 6, rss_007: 5, rss_008: 4, rss_009: 8, rss_010: 12 }
  })
};

export const SECTOR_IDS = Object.keys(SECTOR_DEFINITIONS);
