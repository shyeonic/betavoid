import { chromium } from "playwright";

const URL = "http://localhost:8123/index.html";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { const t = m.text(); if (/error|fail|exception/i.test(t)) console.log("[page]", t); });

await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__voidZeroGame, { timeout: 60000 });
const boot = await page.evaluate(async () => {
  const g = window.__voidZeroGame;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitPhase = async (p, ms = 45000) => { const t0 = performance.now(); while (g.state?.phase !== p) { if (performance.now() - t0 > ms) return false; await sleep(50); } return true; };
  try {
    if (g.state?.phase === "standby") await g.prepareStartSequence();
    if (!await waitPhase("ready")) return { ok: false, where: "ready" };
    await g.startGame();
    return { ok: await waitPhase("running") };
  } catch (e) { return { ok: false, error: String(e) }; }
});
console.log("boot:", JSON.stringify(boot));
if (!boot.ok) { await browser.close(); process.exit(2); }

const r = await page.evaluate(async () => {
  const g = window.__voidZeroGame;
  const wdm = g.worldDataManager;
  const cid = g.characterId;
  const out = {};
  try {
    const buildings = await wdm.getAll("buildings");
    const station = buildings.find((b) => b.building_id === "arc_station") || buildings[0];
    const bid = station.building_instance_id;
    out.bid = bid;

    // Move the ship onto the station so dock range passes.
    const resolved = g.resolveDockableStation({ id: bid });
    if (resolved?.renderPosition) g.ship.position.copy(resolved.renderPosition);

    const shipUid = g.playerAssets.profile.active_ship_uid;
    out.shipUid = shipUid;

    await g.dock({ id: bid });
    out.isDockedAfterDock = g.isDocked();
    out.activeShipReconstructed = !!g.getActiveShipItem();
    out.cargoAccessible = !!g.getActiveShipCargoStorage();
    out.dockTruth = g.getDockedStationId() === bid; // derived from ship location, not a flag
    const sDock = await wdm.getStationInventorySnapshot(bid);
    out.shipInDockedZone = (sDock.docked_ships || []).some((s) => s.ship_uid === shipUid);
    out.shipNotInPersistentPlayer = !(await wdm.getPlayerAssetSnapshot(cid)).uniqueItems.some((u) => u.item_uid === shipUid);

    // Docked: refit/cargo change must be BLOCKED and must not alter the authoritative
    // dock-moment snapshot in docked_ships.
    const dockedSnap0 = JSON.stringify((await wdm.getStationInventorySnapshot(bid)).docked_ships);
    const refitRes = await g.applyShipLoadoutChange({ shipId: g.selectedShipId, type: "weapon", slotId: "weapon_slot_01", equippedId: "" });
    out.refitBlockedWhileDocked = refitRes?.status === "blocked";
    out.dockedDataUnchangedByRefit = dockedSnap0 === JSON.stringify((await wdm.getStationInventorySnapshot(bid)).docked_ships);
    // Forced intervention: a direct player-store write must NOT touch the SSoT (docked_ships).
    await wdm.putStoreValue("uniqueItems", { item_uid: "TAMPER", item_id: "ship_01", kind: "ship", owner_character_id: cid, storage_id: "x", created_at: 1, updated_at: 1 });
    out.dockedDataUnchangedByTamper = dockedSnap0 === JSON.stringify((await wdm.getStationInventorySnapshot(bid)).docked_ships);

    await g.undock();
    out.isDockedAfterUndock = g.isDocked();
    out.shipBackInPersistentPlayer = (await wdm.getPlayerAssetSnapshot(cid)).uniqueItems.some((u) => u.item_uid === shipUid);
    const sUndock = await wdm.getStationInventorySnapshot(bid);
    out.dockedZoneEmpty = (sUndock.docked_ships || []).length === 0;
    out.dockTruthCleared = !g.getDockedStationId();
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String(e); }
  return out;
});

console.log(JSON.stringify(r, null, 2));
let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
check("dock flow ran without error", r.ok);
check("DOCK: isDocked() true (derived from ship location)", r.isDockedAfterDock);
check("DOCK: active ship reconstructed in-memory", r.activeShipReconstructed);
check("DOCK: cargo accessor works while docked", r.cargoAccessible);
check("DOCK: docked station DERIVED from ship location = station id", r.dockTruth);
check("DOCK: ship persisted in station docked_ships (server)", r.shipInDockedZone);
check("DOCK: ship NOT in persistent player namespace", r.shipNotInPersistentPlayer);
check("DOCKED: refit/cargo change is blocked", r.refitBlockedWhileDocked);
check("DOCKED: blocked refit leaves docked_ships unchanged", r.dockedDataUnchangedByRefit);
check("DOCKED: forced player-store write does NOT alter docked_ships (SSoT)", r.dockedDataUnchangedByTamper);
check("UNDOCK: isDocked() false", r.isDockedAfterUndock === false);
check("UNDOCK: ship back in persistent player namespace", r.shipBackInPersistentPlayer);
check("UNDOCK: docked_ships zone emptied", r.dockedZoneEmpty);
check("UNDOCK: not docked (derived; ship back in player)", r.dockTruthCleared);
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES: " + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
