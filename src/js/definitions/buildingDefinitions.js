const DEFAULT_BUILDING_VISUAL = {
  model_id: "hq_01",
  color: 0xffffff,
  emissive: 0x17345e,
  emissiveIntensity: 0.08,
  scale: 5
};

const trade = ({ enabled = false, trade_table_id = null, handling_speed = 0, cargo_capacity = 0, min_reputation = 0 } = {}) => ({
  enabled,
  trade_table_id,
  handling_speed,
  cargo_capacity,
  min_reputation
});

const docking = (capacity) => ({ capacity });

const sectorAnchor = (radius = null) => ({
  type: "sector_anchor",
  radius
});

const freeSpace = () => ({
  type: "free_space"
});

const resourceNode = (required_resource_type) => ({
  type: "resource_node",
  required_resource_type
});

const serviceOutput = (service_id) => ({
  output_type: "service",
  service_id
});

const sourceResourceOutput = () => ({
  output_type: "item",
  item_id: "$source.produces_item_id",
  amount_per_sec: "$source.base_yield_per_sec"
});

const selfProduction = (outputs, { output_sink = "building_inventory" } = {}) => ({
  kind: "SELF",
  outputs,
  output_sink
});

const resourceExtractorProduction = ({ output_sink = "building_inventory" } = {}) => ({
  kind: "RESOURCE_EXTRACTOR",
  source: {
    type: "attached_resource_node",
    depletes: true,
    lock_expiry: true
  },
  outputs: [sourceResourceOutput()],
  output_sink
});

const factoryProduction = (recipe_id, { output_sink = "building_inventory" } = {}) => ({
  kind: "FACTORY",
  recipe_id,
  output_sink
});

export const BUILDING_DEFINITIONS = {
  arc_station: {
    building_id: "arc_station",
    label_key: "building.arc_station.name",
    description_key: "building.arc_station.description",
    size: "전용",
    category: "헤드쿼터",
    hp: 1000,
    admin_cost: 20,
    placement_rule: sectorAnchor(null),
    production_profile: selfProduction([
      serviceOutput("power"),
      serviceOutput("beta_crystal"),
      serviceOutput("worker")
    ]),
    polity_resource: { population: true },
    docking: docking(null),
    trade: trade({ enabled: true, trade_table_id: "trade_basic", handling_speed: 2.0, cargo_capacity: 100000 }),
    default_polity_id: "asta",
    initial_inventory: {
      item_001: 5000,
      item_004: 3000,
      item_003: 2000,
      item_002: 1500,
      item_007: 4000,
      item_008: 2000
    },
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 5.5 },
  },
  plasma_power_plant: {
    building_id: "plasma_power_plant",
    label_key: "building.plasma_power_plant.name",
    description_key: "building.plasma_power_plant.description",
    size: "대형",
    category: "발전소",
    hp: 1000,
    admin_cost: 15,
    placement_rule: sectorAnchor(320),
    production_profile: selfProduction([
      serviceOutput("power")
    ]),
    polity_resource: {},
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL },
  },
  beta_particle_reactor: {
    building_id: "beta_particle_reactor",
    label_key: "building.beta_particle_reactor.name",
    description_key: "building.beta_particle_reactor.description",
    size: "대형",
    category: "하이퍼드라이브 에너지 생산시설",
    hp: 1000,
    admin_cost: 15,
    placement_rule: freeSpace(),
    production_profile: selfProduction([
      serviceOutput("beta_crystal")
    ]),
    polity_resource: {},
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL },
  },
  orbital_dorm: {
    building_id: "orbital_dorm",
    label_key: "building.orbital_dorm.name",
    description_key: "building.orbital_dorm.description",
    size: "대형",
    category: "거주시설",
    hp: 1000,
    admin_cost: 10,
    placement_rule: sectorAnchor(640),
    production_profile: selfProduction([
      serviceOutput("worker")
    ]),
    polity_resource: { population: true },
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL },
  },
  colony_dorm: {
    building_id: "colony_dorm",
    label_key: "building.colony_dorm.name",
    description_key: "building.colony_dorm.description",
    size: "대형",
    category: "거주시설",
    hp: 1000,
    admin_cost: 4,
    placement_rule: freeSpace(),
    production_profile: selfProduction([
      serviceOutput("worker")
    ]),
    polity_resource: { population: true },
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL },
  },
  orbital_defence_turret: {
    building_id: "orbital_defence_turret",
    label_key: "building.orbital_defence_turret.name",
    description_key: "building.orbital_defence_turret.description",
    size: "소형",
    category: "방어 포탑",
    hp: 1000,
    admin_cost: 2,
    placement_rule: sectorAnchor(640),
    polity_resource: {},
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 3.5 },
  },
  sentinel_turret: {
    building_id: "sentinel_turret",
    label_key: "building.sentinel_turret.name",
    description_key: "building.sentinel_turret.description",
    size: "소형",
    category: "방어 포탑",
    hp: 1000,
    admin_cost: 0,
    placement_rule: freeSpace(),
    polity_resource: {},
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 3.5 },
  },
  shipyard: {
    building_id: "shipyard",
    label_key: "building.shipyard.name",
    description_key: "building.shipyard.description",
    size: "대형",
    category: "조선소",
    hp: 1000,
    admin_cost: 18,
    placement_rule: freeSpace(),
    production_profile: factoryProduction("shipyard.construct_ship"),
    polity_resource: {},
    docking: docking(null),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL },
  },
  trade_port: {
    building_id: "trade_port",
    label_key: "building.trade_port.name",
    description_key: "building.trade_port.description",
    size: "대형",
    category: "거래소",
    hp: 1000,
    admin_cost: 15,
    placement_rule: freeSpace(),
    polity_resource: { building_maintenance_reduction: true },
    docking: docking(null),
    trade: trade({ enabled: true, trade_table_id: "trade_basic", handling_speed: 3.0, cargo_capacity: 200000 }),
    default_polity_id: "asta",
    visual: { ...DEFAULT_BUILDING_VISUAL },
  },
  outbase: {
    building_id: "outbase",
    label_key: "building.outbase.name",
    description_key: "building.outbase.description",
    size: "대형",
    category: "전초기지",
    hp: 1000,
    admin_cost: 0,
    placement_rule: freeSpace(),
    polity_resource: {},
    docking: docking(5),
    trade: trade({ enabled: true, trade_table_id: "trade_basic", handling_speed: 1.0, cargo_capacity: 50000 }),
    default_polity_id: "asta",
    initial_inventory: {
      item_001: 2000,
      item_004: 1500,
      item_003: 1000,
      item_007: 1500
    },
    visual: { ...DEFAULT_BUILDING_VISUAL },
  },
  hydro_synthesizer: {
    building_id: "hydro_synthesizer",
    label_key: "building.hydro_synthesizer.name",
    description_key: "building.hydro_synthesizer.description",
    size: "중형",
    category: "자원 생산 시설",
    hp: 1000,
    admin_cost: 2,
    placement_rule: resourceNode("hydrite_mineral"),
    production_profile: resourceExtractorProduction(),
    polity_resource: { happiness: true },
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 4.5 },
  },
  mine: {
    building_id: "mine",
    label_key: "building.mine.name",
    description_key: "building.mine.description",
    size: "중형",
    category: "자원 생산 시설",
    hp: 1000,
    admin_cost: 0,
    placement_rule: resourceNode("mineral"),
    production_profile: resourceExtractorProduction(),
    polity_resource: {},
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 4.5 },
  },
  refinery: {
    building_id: "refinery",
    label_key: "building.refinery.name",
    description_key: "building.refinery.description",
    size: "중형",
    category: "자원 생산 시설",
    hp: 1000,
    admin_cost: 0,
    placement_rule: resourceNode("gas"),
    production_profile: resourceExtractorProduction(),
    polity_resource: {},
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 4.5 },
  },
  bio_fab: {
    building_id: "bio_fab",
    label_key: "building.bio_fab.name",
    description_key: "building.bio_fab.description",
    size: "중형",
    category: "자원 생산 시설",
    hp: 1000,
    admin_cost: 0,
    placement_rule: freeSpace(),
    production_profile: selfProduction([
      serviceOutput("bio")
    ]),
    polity_resource: { happiness: true },
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 4.5 },
  },
  food_factory: {
    building_id: "food_factory",
    label_key: "building.food_factory.name",
    description_key: "building.food_factory.description",
    size: "중형",
    category: "공장",
    hp: 1000,
    admin_cost: 1,
    placement_rule: freeSpace(),
    production_profile: factoryProduction("food_factory.process_food"),
    polity_resource: { happiness: true },
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 4.5 },
  },
  silicon_factory: {
    building_id: "silicon_factory",
    label_key: "building.silicon_factory.name",
    description_key: "building.silicon_factory.description",
    size: "중형",
    category: "공장",
    hp: 1000,
    admin_cost: 1,
    placement_rule: freeSpace(),
    production_profile: factoryProduction("silicon_factory.produce_semiconductor"),
    polity_resource: {},
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 4.5 },
  },
  weapon_factory: {
    building_id: "weapon_factory",
    label_key: "building.weapon_factory.name",
    description_key: "building.weapon_factory.description",
    size: "중형",
    category: "공장",
    hp: 1000,
    admin_cost: 2,
    placement_rule: freeSpace(),
    production_profile: factoryProduction("weapon_factory.standard_weapon"),
    polity_resource: {},
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 4.5 },
  },
  advanced_weapon_factory: {
    building_id: "advanced_weapon_factory",
    label_key: "building.advanced_weapon_factory.name",
    description_key: "building.advanced_weapon_factory.description",
    size: "중형",
    category: "공장",
    hp: 1000,
    admin_cost: 3,
    placement_rule: freeSpace(),
    production_profile: factoryProduction("advanced_weapon_factory.advanced_weapon"),
    polity_resource: {},
    docking: docking(0),
    trade: trade(),
    visual: { ...DEFAULT_BUILDING_VISUAL, scale: 4.5 },
  }
};

export const BUILDING_IDS = Object.keys(BUILDING_DEFINITIONS);
