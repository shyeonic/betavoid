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
  const out = {};
  try {
    const buildings = await wdm.getAll("buildings");
    const station = buildings.find((b) => b.building_id === "arc_station") || buildings[0];
    const bid = station.building_instance_id;
    const resolved = g.resolveDockableStation({ id: bid });
    if (resolved?.renderPosition) g.ship.position.copy(resolved.renderPosition);
    await g.dock({ id: bid });
    out.docked = g.isDocked();

    const pubQty = (v, id) => (v.public.rows.find((e) => e.item_id === id)?.quantity) || 0;
    const cargoQty = (v, id) => (v.private.ships[0]?.cargo_rows.find((e) => e.item_id === id)?.quantity) || 0;

    const itemId = "item_001";
    const v0 = await g.getBuildingStorageView(bid);
    out.pub0 = pubQty(v0, itemId);
    out.cargo0 = cargoQty(v0, itemId);

    // LOAD: station -> cargo (out) x10
    out.outRes = await g.tradeAtDockedStation(itemId, "out", 10);
    const v1 = await g.getBuildingStorageView(bid);
    out.pub1 = pubQty(v1, itemId);
    out.cargo1 = cargoQty(v1, itemId);

    // UNLOAD: cargo -> station (in) x4
    out.inRes = await g.tradeAtDockedStation(itemId, "in", 4);
    const v2 = await g.getBuildingStorageView(bid);
    out.pub2 = pubQty(v2, itemId);
    out.cargo2 = cargoQty(v2, itemId);
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String(e); }
  return out;
});

console.log(JSON.stringify(r, null, 2));
let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
check("ran without error", r.ok);
check("docked at station", r.docked);
check("station starts with public stock", r.pub0 > 0);
check("cargo starts empty", r.cargo0 === 0);
check("LOAD out committed (10)", r.outRes?.applied === 10);
check("LOAD: station stock -10", r.pub1 === r.pub0 - 10);
check("LOAD: cargo +10", r.cargo1 === 10);
check("UNLOAD in committed (4)", r.inRes?.applied === 4);
check("UNLOAD: station stock +4", r.pub2 === r.pub1 + 4);
check("UNLOAD: cargo -4 (=6)", r.cargo2 === 6);
check("conservation (station+cargo constant)", (r.pub2 + r.cargo2) === (r.pub0 + r.cargo0));
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES: " + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
