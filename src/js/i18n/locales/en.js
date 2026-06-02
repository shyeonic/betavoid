export const en = {
  ui: {
    settings: {
      title: "Settings",
      close: "Close",
      categoriesLabel: "Settings categories",
      categories: {
        gameplay: "Gameplay",
        controls: "Controls",
        graphics: "Graphics"
      },
      language: "Language",
      languageHint: "Applies after reload",
      languages: {
        en: "English",
        ko: "Korean"
      },
      common: {
        none: "None",
        off: "Off",
        on: "On"
      },
      world: {
        seed: "Seed",
        generated: "Generated",
        sectors: "Sectors",
        chunks: "Chunks",
        resources: "Resources",
        buildings: "Buildings",
        currentSector: "Current Sector",
        currentChunk: "Current Chunk",
        regenerate: "Regenerate",
        reloadDb: "Reload DB",
        clearAllData: "Clear All Data",
        confirmRegenerate: "Regenerate world data?",
        confirmClear: "Clear all stored data? (world, player, navigation)"
      },
      gameplay: {
        shipSelect: "Ship",
        ship01: "Ship I",
        ship02: "Ship II"
      },
      controls: {
        reset: "Reset"
      },
      graphics: {
        environment: "Environment",
        light: "Light",
        dark: "Dark",
        chunkBounds: "Grid Visualization",
        all: "All",
        sector: "Sector",
        materialTextures: "Material Textures",
        renderResolution: "Render Resolution",
        antialias: "Anti-Aliasing",
        bloomQuality: "Bloom Quality",
        low: "Low",
        medium: "Medium",
        high: "High",
        lightingEffects: "Lighting Effects"
      }
    },
    player: {
      title: "Pilot",
      shipSection: "Ship"
    },
    scanner: {
      categories: {
        buildings: "Buildings",
        resources: "Resources",
        betaVoids: "Beta Void"
      },
      empty: "No objects detected",
      select: "Select",
      detail: "Detail",
      autoNavigate: "Auto Navigate",
      objectDetail: "Object detail",
      closeDetail: "Close detail",
      fields: {
        amount: "Amount",
        category: "Category",
        chunk: "Chunk",
        chunkRelative: "Chunk Relative",
        distance: "Distance",
        hp: "HP",
        name: "Name",
        position: "Position",
        sector: "Sector",
        status: "Status",
        type: "Type"
      }
    }
  },
  betaVoid: {
    name: "Beta Void",
    processed: "Beta Void processed",
    processFailed: "Beta Void process failed"
  },
  item: {
    item_001: { name: "Hydrite", description: "Hydrite mineral resource" },
    item_002: { name: "Titanium", description: "Mineral resource" },
    item_003: { name: "Copper", description: "Mineral resource" },
    item_004: { name: "Iron", description: "Mineral resource" },
    item_005: { name: "Gold", description: "Mineral resource" },
    item_006: { name: "Silicon", description: "Mineral resource" },
    item_007: { name: "Hydrogen", description: "Gas resource" },
    item_008: { name: "Helium", description: "Gas resource" },
    item_009: { name: "Xenon", description: "Gas resource" },
    item_010: { name: "Talis", description: "Gas resource" }
  },
  resource: {
    rss_001: { name: "Hydrite Deposit", description: "A resource node that yields Hydrite." },
    rss_002: { name: "Titanium Deposit", description: "A resource node that yields Titanium." },
    rss_003: { name: "Copper Deposit", description: "A resource node that yields Copper." },
    rss_004: { name: "Iron Deposit", description: "A resource node that yields Iron." },
    rss_005: { name: "Gold Deposit", description: "A resource node that yields Gold." },
    rss_006: { name: "Silicon Deposit", description: "A resource node that yields Silicon." },
    rss_007: { name: "Hydrogen Field", description: "A decaying gas node that yields Hydrogen." },
    rss_008: { name: "Helium Field", description: "A decaying gas node that yields Helium." },
    rss_009: { name: "Xenon Field", description: "A decaying gas node that yields Xenon." },
    rss_010: { name: "Talis Field", description: "A decaying gas node that yields Talis." }
  },
  building: {
    arc_station: { name: "Arc Station", description: "Core station with population, docking, storage, defence, power, and survival resource support." },
    plasma_power_plant: { name: "Plasma Power Plant", description: "A facility that produces electrical power." },
    beta_particle_reactor: { name: "Beta Particle Reactor", description: "A facility that produces hyperdrive energy." },
    orbital_dorm: { name: "Orbital Dorm", description: "Habitation that provides population and workers." },
    colony_dorm: { name: "Colony Dorm", description: "Outer habitation that provides population and workers." },
    orbital_defence_turret: { name: "Orbital Defence Turret", description: "A defensive turret for hostile ships." },
    sentinel_turret: { name: "Sentinel Turret", description: "A light defensive turret for hostile ships." },
    shipyard: { name: "Shipyard", description: "A large dock facility that builds and repairs ships." },
    trade_port: { name: "Trade Port", description: "An economic hub where external ships dock and trade cargo." },
    outbase: { name: "Outbase", description: "A multipurpose outpost for sector expansion, defence, and supply." },
    hydro_synthesizer: { name: "Hydro-Synthesizer", description: "A hybrid purification plant for hydrogen synthesis and water recycling." },
    mine: { name: "Mine", description: "An industrial facility that extracts useful minerals." },
    refinery: { name: "Refinery", description: "A gas refinery that extracts and purifies high-energy gases." },
    bio_fab: { name: "Bio Fab", description: "A facility that uses hydroponics and cell culture to produce organic resources." },
    food_factory: { name: "Food Factory", description: "A factory that processes biological resources into food." },
    silicon_factory: { name: "Silicon Factory", description: "A factory that produces semiconductors from refined minerals." },
    weapon_factory: { name: "Weapon Factory", description: "A factory that produces standard ship weapon systems." },
    advanced_weapon_factory: { name: "Advanced Weapon Factory", description: "A factory for prototype and special weapon systems." }
  },
  buildingSize: {
    EX: "Exclusive",
    L: "Large",
    M: "Medium",
    S: "Small"
  },
  buildingCategory: {
    defense_turret: "Defence Turret",
    factory: "Factory",
    habitation: "Habitation",
    headquarters: "Headquarters",
    hyperdrive_energy: "Hyperdrive Energy Facility",
    outpost: "Outpost",
    power_plant: "Power Plant",
    resource_production: "Resource Production Facility",
    shipyard: "Shipyard",
    trade_port: "Trade Port"
  },
  sector: {
    "SEC-001": { name: "EPSILON PRIME", theme: "Volcanic Industrial" },
    "SEC-002": { name: "NOVA STATION", theme: "Trade Hub" },
    "SEC-003": { name: "CRIMSON EXPANSE", theme: "Desert Wasteland" },
    "SEC-004": { name: "AZURE NEBULA", theme: "Gas Giant" },
    "SEC-005": { name: "OBSIDIAN REACH", theme: "Dark Matter Zone" },
    "SEC-006": { name: "TITAN'S GATE", theme: "Military Fortress" },
    "SEC-007": { name: "HELIOS CORE", theme: "Solar Forge" },
    "SEC-008": { name: "FROST FRONTIER", theme: "Ice World" },
    "SEC-009": { name: "EMERALD HAVEN", theme: "Agricultural Paradise" },
    "SEC-010": { name: "VOID EDGE", theme: "Frontier Outpost" }
  }
};
