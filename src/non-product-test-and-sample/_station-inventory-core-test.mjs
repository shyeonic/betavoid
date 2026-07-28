import { WorldDataManager } from "../js/WorldDataManager.js";

// Bare instance: exercise the pure station-inventory (item storage F1) core
// without IndexedDB. Mirrors _gather-core-test.mjs.
const wdm = Object.create(WorldDataManager.prototype);
wdm.itemDefinitions = {
  item_001: { id: "item_001", kind: "resource", mass: 1 },
  item_002: { id: "item_002", kind: "resource", mass: 1.5 },
  item_007: { id: "item_007", kind: "resource", mass: 0.2 },
  item_free: { id: "item_free", kind: "resource", mass: 0 }
};
wdm.shipDefinitions = { ship_01: { combat: { base_stats: { cargo_capacity: 1000 } } } };
wdm.buildingDefinitions = {
  arc_station: {
    id: "arc_station",
    trade: { enabled: true, handling_speed: 1, cargo_capacity: 50000, min_reputation: 0 },
    storage: { capacity: 50000 },
    initial_inventory: { item_001: 5000, item_007: 4000 }
  },
  mine: {
    id: "mine",
    trade: { enabled: false, handling_speed: 0, cargo_capacity: 0, min_reputation: 0 },
    storage: { capacity: 8000 }, // every building has capacity, independent of trade
    production_profile: { output_sink: "building_inventory", interval_ms: 3600000, amount_per_interval: 1 },
    initial_inventory: {}
  }
};

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function check(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}  ${detail}`); }
}

const SID = "station-inventory-BLD-1";
const items = (pairs) => pairs.map(([item_id, quantity]) => ({
  entry_id: `qty-${SID}-${item_id}`, storage_id: SID, item_id, kind: "resource", quantity,
  created_at: 1, updated_at: 1
}));

console.log("\n[1] id / capacity / storage builder");
{
  check("storage id format", wdm.stationInventoryStorageId("BLD-1") === "station-inventory-BLD-1");
  check("capacity from storage.capacity (arc)", wdm.getStationInventoryCapacity("arc_station") === 50000);
  check("capacity from storage.capacity (mine, trade-independent)", wdm.getStationInventoryCapacity("mine") === 8000);
  check("capacity 0 for unknown building", wdm.getStationInventoryCapacity("nope") === 0);
  const s = wdm.buildStationInventoryStorage({ buildingInstanceId: "BLD-1", buildingId: "arc_station", createdAt: 7 });
  check("storage_type", s.storage_type === "station_inventory");
  check("world_object_id = building", s.world_object_id === "BLD-1");
  check("storage capacity derived", s.capacity === 50000);
  check("storage id matches helper", s.storage_id === "station-inventory-BLD-1");
  check("public_inventory map (seeded from initial_inventory)", s.public_inventory?.item_001 === 5000 && s.public_inventory?.item_007 === 4000);
  check("docked_ships zone present (empty)", !!s.docked_ships && Object.keys(s.docked_ships).length === 0);
}

console.log("\n[2] mass / used / addable");
{
  const it = items([["item_001", 100], ["item_002", 200]]); // 100*1 + 200*1.5 = 400
  check("unit mass", approx(wdm.itemUnitMass("item_002"), 1.5));
  check("used mass 400", approx(wdm.storageUsedMass(it), 400));
  check("current qty", wdm.currentItemQuantity(it, "item_001") === 100);
  check("current qty missing -> 0", wdm.currentItemQuantity(it, "zzz") === 0);
  // free = 1000 - 400 = 600; item_002 unit 1.5 -> floor(600/1.5)=400
  check("max addable item_002 under cap 1000", wdm.maxAddableUnits(it, 1000, "item_002") === 400, `got ${wdm.maxAddableUnits(it, 1000, "item_002")}`);
  // item_001 unit 1 -> floor(600/1)=600
  check("max addable item_001 under cap 1000", wdm.maxAddableUnits(it, 1000, "item_001") === 600);
  // mass-free item -> effectively unbounded
  check("mass-free item unbounded", wdm.maxAddableUnits(it, 1000, "item_free") === Number.MAX_SAFE_INTEGER);
}

console.log("\n[3] planStorageQuantityDelta — add within capacity");
{
  const it = items([["item_001", 100]]); // used 100, cap 1000 -> free 900
  const r = wdm.planStorageQuantityDelta({ items: it, storageId: SID, itemId: "item_001", requestedDelta: 50, capacity: 1000, createdAt: 9 });
  check("applied 50", r.applied === 50);
  check("new qty 150", r.newQuantity === 150);
  check("no reason", r.reason === null);
  check("entryToPut qty 150", r.entryToPut?.quantity === 150);
  check("preserves created_at", r.entryToPut?.created_at === 1);
  check("updated_at bumped", r.entryToPut?.updated_at === 9);
  check("no delete", r.entryIdToDelete === null);
}

console.log("\n[4] add exceeding capacity -> clamp + reason");
{
  const it = items([["item_001", 980]]); // used 980, cap 1000 -> free 20
  const r = wdm.planStorageQuantityDelta({ items: it, storageId: SID, itemId: "item_001", requestedDelta: 100, capacity: 1000 });
  check("applied clamped to 20", r.applied === 20, `got ${r.applied}`);
  check("new qty 1000", r.newQuantity === 1000);
  check("reason capacity", r.reason === "capacity");
}

console.log("\n[5] add brand-new item");
{
  const it = items([["item_001", 100]]);
  const r = wdm.planStorageQuantityDelta({ items: it, storageId: SID, itemId: "item_002", requestedDelta: 10, capacity: 1000, createdAt: 5 });
  check("applied 10", r.applied === 10);
  check("new entry qty 10", r.entryToPut?.quantity === 10);
  check("new entry created_at = now", r.entryToPut?.created_at === 5);
  check("new entry storage_id", r.entryToPut?.storage_id === SID);
}

console.log("\n[6] remove partial");
{
  const it = items([["item_001", 100]]);
  const r = wdm.planStorageQuantityDelta({ items: it, storageId: SID, itemId: "item_001", requestedDelta: -30, capacity: 1000, createdAt: 9 });
  check("applied -30", r.applied === -30);
  check("new qty 70", r.newQuantity === 70);
  check("entryToPut qty 70", r.entryToPut?.quantity === 70);
  check("no delete", r.entryIdToDelete === null);
  check("no reason", r.reason === null);
}

console.log("\n[7] remove to zero -> delete entry");
{
  const it = items([["item_001", 30]]);
  const r = wdm.planStorageQuantityDelta({ items: it, storageId: SID, itemId: "item_001", requestedDelta: -30, capacity: 1000 });
  check("applied -30", r.applied === -30);
  check("new qty 0", r.newQuantity === 0);
  check("entryToPut null", r.entryToPut === null);
  check("delete entry id", r.entryIdToDelete === `qty-${SID}-item_001`);
}

console.log("\n[8] remove exceeding stock -> clamp to stock + reason");
{
  const it = items([["item_001", 30]]);
  const r = wdm.planStorageQuantityDelta({ items: it, storageId: SID, itemId: "item_001", requestedDelta: -100, capacity: 1000 });
  check("applied clamped to -30", r.applied === -30, `got ${r.applied}`);
  check("new qty 0", r.newQuantity === 0);
  check("delete entry", r.entryIdToDelete === `qty-${SID}-item_001`);
  check("reason insufficient", r.reason === "insufficient");
}

console.log("\n[9] initial inventory map from def");
{
  const map = wdm.buildInitialInventoryMap("arc_station");
  check("two items in map", Object.keys(map).length === 2, `got ${Object.keys(map).length}`);
  check("item_001 = 5000", map.item_001 === 5000);
  check("item_007 = 4000", map.item_007 === 4000);
  check("empty def -> empty map", Object.keys(wdm.buildInitialInventoryMap("mine")).length === 0);
}

console.log("\n[10] conservation across a transfer pair (cargo <-> station)");
{
  // Withdraw 40 item_001 from station, deposit into cargo. Sum stays constant.
  const station = items([["item_001", 100]]);
  const cargo = [];
  const out = wdm.planStorageQuantityDelta({ items: station, storageId: SID, itemId: "item_001", requestedDelta: -40, capacity: 1000 });
  const into = wdm.planStorageQuantityDelta({ items: cargo, storageId: "cargo", itemId: "item_001", requestedDelta: -out.applied, capacity: 1000 });
  check("station -40", out.applied === -40);
  check("cargo +40", into.applied === 40);
  check("conservation: station 60 + cargo 40 = 100", out.newQuantity + into.newQuantity === 100);
}

console.log("\n[11] world-gen seeding: createInitialStationInventories");
{
  const buildings = [
    { building_instance_id: "BLD-1", building_id: "arc_station" },
    { building_instance_id: "BLD-2", building_id: "mine" } // empty inv + cap 0 -> skipped
  ];
  const seeded = wdm.createInitialStationInventories(buildings, 42);
  check("storage for EVERY building (2)", seeded.buildingStorages.length === 2, `got ${seeded.buildingStorages.length}`);
  const arcStorage = seeded.buildingStorages.find((x) => x.world_object_id === "BLD-1");
  const mineStorage = seeded.buildingStorages.find((x) => x.world_object_id === "BLD-2");
  check("arc storage exists", !!arcStorage);
  check("mine storage exists (universal, no item gating)", !!mineStorage);
  check("arc capacity 50000", arcStorage.capacity === 50000);
  check("mine capacity 8000", mineStorage.capacity === 8000);
  check("items nested in record (no separate store)", seeded.buildingInventoryItems === undefined);
  check("arc public_inventory count 2", Object.keys(arcStorage.public_inventory).length === 2, `got ${Object.keys(arcStorage.public_inventory).length}`);
  check("arc item_001 = 5000", arcStorage.public_inventory.item_001 === 5000);
  check("mine empty public_inventory", Object.keys(mineStorage.public_inventory).length === 0);
  check("both have empty docked_ships zone (independent)", Object.keys(arcStorage.docked_ships).length === 0 && Object.keys(mineStorage.docked_ships).length === 0);
}

console.log("\n[12] dock/undock data core — build then restore round-trips");
{
  const assets = {
    profile: { character_id: "char1", active_ship_uid: "ship-1" },
    uniqueItems: [
      { item_uid: "ship-1", item_id: "ship_01", kind: "ship", owner_character_id: "char1", storage_id: "active-1", seed: "s", fixed_options: {} },
      { item_uid: "wuid-1", item_id: "weapon_x", kind: "weapon", owner_character_id: "char1", storage_id: "cargo-1", seed: "ws", fixed_options: { dmg: 5 } }
    ],
    storageLocations: [
      { storage_id: "active-1", storage_type: "active_ship", owner_character_id: "char1", parent_item_uid: null },
      { storage_id: "cargo-1", storage_type: "ship_cargo", owner_character_id: "char1", parent_item_uid: "ship-1" }
    ],
    quantityItems: [
      { entry_id: "qty-cargo-1-item_001", storage_id: "cargo-1", item_id: "item_001", kind: "resource", quantity: 120 },
      { entry_id: "qty-cargo-1-item_002", storage_id: "cargo-1", item_id: "item_002", kind: "resource", quantity: 30 }
    ],
    slotAssignments: [
      { assignment_id: "ship-1:weapon:slot_01", owner_item_uid: "ship-1", slot_type: "weapon", slot_id: "slot_01", item_id: "weapon_service_m", item_uid: null, kind: "weapon", item_identity: "quantity", quantity: 1 }
    ]
  };
  const entry = wdm.buildDockedShipEntry(assets, "ship-1", { dockSlot: 2, dockedAt: 99 });
  check("entry ship_id", entry.ship_id === "ship_01");
  check("entry owner", entry.owner_character_id === "char1");
  check("entry dock_slot", entry.dock_slot === 2);
  check("entry cargo map", entry.cargo.item_001 === 120 && entry.cargo.item_002 === 30);
  check("entry cargo_unique 1", entry.cargo_unique.length === 1 && entry.cargo_unique[0].item_uid === "wuid-1");
  check("entry fittings 1", entry.fittings.length === 1 && entry.fittings[0].item_id === "weapon_service_m");

  const restored = wdm.restoreDockedShipRecords(entry, { activeShipStorageId: "active-1", cargoStorageId: "cargo-1", characterId: "char1", createdAt: 5 });
  const ship = restored.uniqueItemsToPut.find((u) => u.item_uid === "ship-1");
  check("restored ship storage_id active", ship?.storage_id === "active-1");
  check("restored ship kind", ship?.kind === "ship");
  check("restored cargo unique re-homed to cargo", restored.uniqueItemsToPut.some((u) => u.item_uid === "wuid-1" && u.storage_id === "cargo-1"));
  check("restored cargo storage parent = ship", restored.storageLocationsToPut[0].parent_item_uid === "ship-1");
  check("restored cargo capacity from shipdef", restored.storageLocationsToPut[0].capacity === 1000);
  check("restored qty item_001 = 120", restored.quantityItemsToPut.find((e) => e.item_id === "item_001")?.quantity === 120);
  check("restored fitting assignment id", restored.slotAssignmentsToPut[0].assignment_id === "ship-1:weapon:slot_01");
}

console.log("\n[13] production — timestamp-derived (1/hour), caps at full, no banking while full");
{
  const H = 3600000;
  // 3.5h elapsed @ 1/h -> 3 units; anchor advances 3h (keeps 0.5h remainder).
  let p = wdm.planProduction({ anchorMs: 0, nowMs: 3.5 * H, intervalMs: H, currentQty: 0, usedMass: 0, capacity: 1000, unitMass: 1 });
  check("3.5h -> 3 units", p.applied === 3, `got ${p.applied}`);
  check("anchor advances 3h (remainder kept)", p.newAnchorMs === 3 * H);
  check("newQty 3", p.newQty === 3);
  // capped: 5 due but only 2 fit -> applied 2, anchor jumps to now (discard banked time)
  p = wdm.planProduction({ anchorMs: 0, nowMs: 5 * H, intervalMs: H, currentQty: 0, usedMass: 998, capacity: 1000, unitMass: 1 });
  check("capped applied 2", p.applied === 2, `got ${p.applied}`);
  check("capped anchor -> now (no banking)", p.newAnchorMs === 5 * H);
  // full: no free space -> applied 0, anchor jumps to now (time discarded, no burst later)
  p = wdm.planProduction({ anchorMs: 0, nowMs: 10 * H, intervalMs: H, currentQty: 1000, usedMass: 1000, capacity: 1000, unitMass: 1 });
  check("full -> applied 0", p.applied === 0);
  check("full -> producedUnits 10 (would have)", p.producedUnits === 10);
  check("full -> anchor now (no banking)", p.newAnchorMs === 10 * H);
  // no time elapsed -> nothing
  p = wdm.planProduction({ anchorMs: 5 * H, nowMs: 5.9 * H, intervalMs: H, currentQty: 0, usedMass: 0, capacity: 1000, unitMass: 1 });
  check("sub-interval -> 0 units, anchor unchanged", p.applied === 0 && p.newAnchorMs === 5 * H);
  // mass-based cap with unitMass 1.5: capacity 1000 used 0 -> floor(1000/1.5)=666 fit
  p = wdm.planProduction({ anchorMs: 0, nowMs: 1000 * H, intervalMs: H, currentQty: 0, usedMass: 0, capacity: 1000, unitMass: 1.5 });
  check("mass cap floor(1000/1.5)=666", p.applied === 666, `got ${p.applied}`);
}

console.log("\n[14] world-gen: producing facilities start with 1 unit of their produced item");
{
  const buildings = [
    { building_instance_id: "BLD-1", building_id: "arc_station" }, // no produces_item_id → no seed
    { building_instance_id: "BLD-3", building_id: "mine", produces_item_id: "item_002" } // producer → +1
  ];
  const seeded = wdm.createInitialStationInventories(buildings, 7);
  const arc = seeded.buildingStorages.find((s) => s.world_object_id === "BLD-1");
  const mine = seeded.buildingStorages.find((s) => s.world_object_id === "BLD-3");
  check("producer seeded 1 unit of its item", mine.public_inventory.item_002 === 1, `got ${mine.public_inventory.item_002}`);
  check("non-producer not seeded by production", arc.public_inventory.item_002 === undefined);
  check("producer keeps only the 1 seed (empty initial_inventory)", Object.keys(mine.public_inventory).length === 1);
}

console.log("\n[15] trade — load/unload between station public stock and docked cargo");
{
  // OUT: station -> cargo (load)
  let t = wdm.planStationTrade({ direction: "out", itemId: "item_001", amount: 30, publicInventory: { item_001: 100 }, cargo: {}, stationCapacity: 100000, cargoCapacity: 1000, unitMass: 1 });
  check("out applied 30", t.applied === 30);
  check("out public 70", t.nextPublic.item_001 === 70);
  check("out cargo 30", t.nextCargo.item_001 === 30);
  // OUT clamp by stock
  t = wdm.planStationTrade({ direction: "out", itemId: "item_001", amount: 10, publicInventory: { item_001: 5 }, cargo: {}, stationCapacity: 100000, cargoCapacity: 1000, unitMass: 1 });
  check("out clamped to stock 5", t.applied === 5 && t.reason === "insufficient-stock");
  check("out empties depleted stock key", t.nextPublic.item_001 === undefined);
  // OUT clamp by cargo capacity (mass)
  t = wdm.planStationTrade({ direction: "out", itemId: "item_001", amount: 20, publicInventory: { item_001: 100 }, cargo: {}, stationCapacity: 100000, cargoCapacity: 10, unitMass: 1 });
  check("out clamped to cargo space 10", t.applied === 10 && t.reason === "cargo-full");
  // IN: cargo -> station (unload)
  t = wdm.planStationTrade({ direction: "in", itemId: "item_001", amount: 20, publicInventory: {}, cargo: { item_001: 50 }, stationCapacity: 100000, cargoCapacity: 1000, unitMass: 1 });
  check("in applied 20", t.applied === 20);
  check("in cargo 30", t.nextCargo.item_001 === 30);
  check("in public 20", t.nextPublic.item_001 === 20);
  // IN clamp by cargo stock
  t = wdm.planStationTrade({ direction: "in", itemId: "item_001", amount: 10, publicInventory: {}, cargo: { item_001: 5 }, stationCapacity: 100000, cargoCapacity: 1000, unitMass: 1 });
  check("in clamped to cargo 5", t.applied === 5 && t.reason === "insufficient-cargo");
  // IN clamp by station capacity (mass)
  t = wdm.planStationTrade({ direction: "in", itemId: "item_001", amount: 20, publicInventory: {}, cargo: { item_001: 100 }, stationCapacity: 10, cargoCapacity: 1000, unitMass: 1 });
  check("in clamped to station space 10", t.applied === 10 && t.reason === "station-full");
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
