import { chromium } from "playwright";
import { installFirebaseAuthMock } from "./_pw-firebase-auth-mock.mjs";

const URL = "http://localhost:8123/index.html";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { const t = m.text(); if (/error|fail|exception/i.test(t)) console.log("[page]", t); });

await installFirebaseAuthMock(page);
await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__betaVoidGame, { timeout: 60000 });
const boot = await page.evaluate(async () => {
  const g = window.__betaVoidGame;
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
  const g = window.__betaVoidGame;
  const wdm = g.worldDataManager;
  const out = {};
  const H = 3600000;
  try {
    const buildings = await wdm.getAll("buildings");
    const facility = buildings.find((b) => ["mine", "refinery", "hydro_synthesizer"].includes(b.building_id) && b.produces_item_id);
    if (!facility) { out.ok = false; out.error = "no resource facility instance"; return out; }
    const bid = facility.building_instance_id;
    const itemId = facility.produces_item_id;
    const created = Number(facility.created_at) || 0;
    out.buildingId = facility.building_id;
    out.itemId = itemId;

    // Facility should now be dockable (building_defs docking.capacity > 0).
    out.facilityDockable = !!g.resolveDockableStation({ id: bid });

    const qtyOf = (snap) => (snap?.items || []).find((e) => e.item_id === itemId)?.quantity || 0;

    const snap0 = await wdm.getStationInventorySnapshot(bid);
    out.startQty = qtyOf(snap0);

    // Settle 5 hours after creation -> +5 units.
    await wdm.settleBuildingProduction(bid, created + 5 * H);
    const snap5 = await wdm.getStationInventorySnapshot(bid);
    out.qtyAfter5h = qtyOf(snap5);

    // Settle a tiny bit later (no full interval) -> no change.
    await wdm.settleBuildingProduction(bid, created + 5 * H + 60000);
    out.qtyAfterSubInterval = qtyOf(await wdm.getStationInventorySnapshot(bid));

    // Settle far future -> caps at capacity (mass-based), no overflow.
    await wdm.settleBuildingProduction(bid, created + 1000000 * H);
    const snapFull = await wdm.getStationInventorySnapshot(bid);
    out.qtyFull = qtyOf(snapFull);
    out.capacity = snapFull.capacity;
    out.usedMass = snapFull.used_mass;
    const unitMass = g.itemDefinitions[itemId]?.mass || 1;
    out.expectedCap = Math.floor(snapFull.capacity / unitMass + 1e-9);

    // Settle again at the same far future -> already full, no change (no banking burst).
    await wdm.settleBuildingProduction(bid, created + 1000000 * H);
    out.qtyAfterFullResettle = qtyOf(await wdm.getStationInventorySnapshot(bid));
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String(e); }
  return out;
});

console.log(JSON.stringify(r, null, 2));
let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
check("ran without error", r.ok);
check("resource facility is dockable", r.facilityDockable);
check("facility starts with 1 unit (world-gen seed)", r.startQty === 1);
check("5h -> +5 units (1/hour)", r.qtyAfter5h === r.startQty + 5);
check("sub-interval adds nothing", r.qtyAfterSubInterval === r.qtyAfter5h);
check("far future caps at mass capacity", r.qtyFull === r.expectedCap);
check("does not exceed capacity (used_mass <= capacity)", r.usedMass <= r.capacity);
check("re-settle while full adds nothing (no banking burst)", r.qtyAfterFullResettle === r.qtyFull);
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES: " + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
