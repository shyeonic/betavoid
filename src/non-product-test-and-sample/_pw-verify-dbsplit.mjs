import { chromium } from "playwright";

const URL = "http://localhost:8123/index.html";

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--ignore-gpu-blocklist"]
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { const t = m.text(); if (/error|fail|exception/i.test(t)) console.log("[page]", t); });

await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__voidZeroGame, { timeout: 60000 });

const boot = await page.evaluate(async () => {
  const g = window.__voidZeroGame;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitPhase = async (p, ms = 45000) => {
    const t0 = performance.now();
    while (g.state?.phase !== p) { if (performance.now() - t0 > ms) return false; await sleep(50); }
    return true;
  };
  try {
    if (g.state?.phase === "standby") await g.prepareStartSequence();
    if (!await waitPhase("ready")) return { ok: false, where: "ready", phase: g.state?.phase };
    await g.startGame();
    const running = await waitPhase("running");
    return { ok: running, phase: g.state?.phase };
  } catch (e) {
    return { ok: false, error: String(e), phase: g.state?.phase };
  }
});
console.log("boot:", JSON.stringify(boot));
if (!boot.ok) { await browser.close(); process.exit(2); }

const report = await page.evaluate(async () => {
  const openDb = (name) => new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const getAll = (db, store) => new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve(null);
    const r = db.transaction(store, "readonly").objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  const dbList = (await indexedDB.databases()).map((d) => d.name).filter(Boolean).sort();
  const db = await openDb("void-zero");
  const allStores = [...db.objectStoreNames].sort();
  const worldStores = allStores.filter((n) => n.startsWith("worlds_"));
  const playerStores = allStores.filter((n) => n.startsWith("playerPrefs_"));

  const buildingStorages = await getAll(db, "worlds_buildingStorages") || [];
  const plyStorageLocations = await getAll(db, "playerPrefs_storageLocations") || [];
  const plyQuantityItems = await getAll(db, "playerPrefs_quantityItems") || [];
  const plyPlayerShip = await getAll(db, "playerPrefs_playerShip") || [];

  const totalItemKinds = buildingStorages.reduce((n, s) => n + Object.keys(s.public_inventory || {}).length, 0);
  const totalDockedShips = buildingStorages.reduce((n, s) => n + Object.keys(s.docked_ships || {}).length, 0);
  const zonesPresent = buildingStorages.every((s) => s.public_inventory !== undefined && s.docked_ships !== undefined);
  const sampleStorage = buildingStorages.find((s) => Object.keys(s.public_inventory || {}).length > 0) || buildingStorages[0] || null;
  const sampleItems = sampleStorage ? Object.entries(sampleStorage.public_inventory || {}).slice(0, 8) : [];

  return {
    dbList,
    allStores,
    worldStores,
    playerStores,
    zonesPresent,
    counts: {
      buildingStorages: buildingStorages.length,
      totalItemKinds,
      totalDockedShips,
      plyStorageLocations: plyStorageLocations.length,
      plyQuantityItems: plyQuantityItems.length,
      plyPlayerShip: plyPlayerShip.length
    },
    sampleStorage: sampleStorage ? { storage_id: sampleStorage.storage_id, capacity: sampleStorage.capacity, docking_capacity: sampleStorage.docking_capacity } : null,
    sampleItems,
    stationInvInPlayerDb: plyStorageLocations.filter((s) => s.storage_type === "station_inventory").length,
    playerStorageTypes: [...new Set(plyStorageLocations.map((s) => s.storage_type))]
  };
});

console.log(JSON.stringify(report, null, 2));

let fail = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) fail++; };
check("single void-zero database exists", report.dbList.includes("void-zero"));
check("no leftover sibling DBs (void-zero-world / void-zero-playerPrefs)", !report.dbList.includes("void-zero-world") && !report.dbList.includes("void-zero-playerPrefs"));
check("stores grouped by worlds_ prefix", report.worldStores.includes("worlds_resourceNodes") && report.worldStores.includes("worlds_buildings") && report.worldStores.includes("worlds_buildingStorages"));
check("stores grouped by playerPrefs_ prefix", report.playerStores.includes("playerPrefs_storageLocations") && report.playerStores.includes("playerPrefs_quantityItems") && report.playerStores.includes("playerPrefs_characterProfiles") && report.playerStores.includes("playerPrefs_playerShip"));
check("every store is prefixed (no ungrouped stores)", report.allStores.every((n) => n.startsWith("worlds_") || n.startsWith("playerPrefs_")));
check("building inventory persisted (>0 storages)", report.counts.buildingStorages > 0);
check("public stock seeded (>0 nested item kinds, e.g. arc_station)", report.counts.totalItemKinds > 0);
check("station storage has TWO independent zones (public_inventory + docked_ships)", report.zonesPresent === true);
check("FELONY FIXED: no station_inventory storage in player namespace", report.stationInvInPlayerDb === 0);
check("player storages are ship/hangar only", report.playerStorageTypes.every((t) => ["active_ship", "ship_cargo", "ship_slot", "station_hangar"].includes(t)));

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES: " + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
