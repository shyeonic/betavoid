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

// Dock at a station, then open the trade window via UIManager.
const setup = await page.evaluate(async () => {
  const g = window.__betaVoidGame;
  const wdm = g.worldDataManager;
  const buildings = await wdm.getAll("buildings");
  const station = buildings.find((b) => b.building_id === "arc_station") || buildings[0];
  const bid = station.building_instance_id;
  const resolved = g.resolveDockableStation({ id: bid });
  if (resolved?.renderPosition) g.ship.position.copy(resolved.renderPosition);
  await g.dock({ id: bid });
  await g.ui.openStationTradeWindow(bid, station.name || "Station");
  return { bid, name: station.name || "Station", docked: g.isDocked() };
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(300);

const dom0 = await page.evaluate(() => {
  const win = document.querySelector(".station-trade-window");
  if (!win) return { exists: false };
  const loadBtns = [...win.querySelectorAll("button")].filter((b) => /적재|load/i.test(b.textContent));
  const unloadBtns = [...win.querySelectorAll("button")].filter((b) => /적하|unload/i.test(b.textContent));
  return { exists: true, loadCount: loadBtns.length, unloadCount: unloadBtns.length, html: win.textContent.slice(0, 120) };
});
console.log("dom0:", JSON.stringify(dom0));

// Read station+cargo qty for first public item, click its LOAD button, re-read.
const r = await page.evaluate(async () => {
  const g = window.__betaVoidGame;
  const out = {};
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const bid = (await g.worldDataManager.getAll("buildings")).find((b) => b.building_id === "arc_station").building_instance_id;
  const pubQty = (v, id) => (v.public.rows.find((e) => e.item_id === id)?.quantity) || 0;
  const cargoQty = (v, id) => (v.private.ships[0]?.cargo_rows.find((e) => e.item_id === id)?.quantity) || 0;

  const v0 = await g.getBuildingStorageView(bid);
  const itemId = v0.public.rows[0]?.item_id;
  out.itemId = itemId;
  out.pub0 = pubQty(v0, itemId);
  out.cargo0 = cargoQty(v0, itemId);

  // Set amount input to 5, click the first LOAD button.
  const win = document.querySelector(".station-trade-window");
  const input = win.querySelector('input[type="number"]');
  input.value = "5";
  const loadBtn = [...win.querySelectorAll("button")].find((b) => /적재|load/i.test(b.textContent));
  loadBtn.click();
  await sleep(500); // execTrade is async (trade + refresh)

  const v1 = await g.getBuildingStorageView(bid);
  out.pub1 = pubQty(v1, itemId);
  out.cargo1 = cargoQty(v1, itemId);

  // Window should still be open and re-rendered.
  out.windowStillOpen = !!document.querySelector(".station-trade-window");

  // Now UNLOAD 2 back.
  const win2 = document.querySelector(".station-trade-window");
  const input2 = win2.querySelector('input[type="number"]');
  input2.value = "2";
  const unloadBtn = [...win2.querySelectorAll("button")].find((b) => /적하|unload/i.test(b.textContent));
  out.unloadBtnFound = !!unloadBtn;
  if (unloadBtn) { unloadBtn.click(); await sleep(500); }

  const v2 = await g.getBuildingStorageView(bid);
  out.pub2 = pubQty(v2, itemId);
  out.cargo2 = cargoQty(v2, itemId);

  // Close button works.
  const closeBtn = [...document.querySelector(".station-trade-window").querySelectorAll("button")].find((b) => b.textContent === "✕");
  closeBtn.click();
  await sleep(100);
  out.windowClosed = !document.querySelector(".station-trade-window");
  out.ok = true;
  return out;
});

console.log(JSON.stringify(r, null, 2));
let fail = 0;
const check = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fail++; };
check("docked", setup.docked);
check("trade window rendered", dom0.exists);
check("has at least one LOAD button", dom0.loadCount > 0);
check("ran without error", r.ok);
check("LOAD click: station stock -5", r.pub1 === r.pub0 - 5);
check("LOAD click: cargo +5", r.cargo1 === r.cargo0 + 5);
check("window re-rendered (stays open)", r.windowStillOpen);
check("UNLOAD button appears after load", r.unloadBtnFound);
check("UNLOAD click: station stock +2", r.pub2 === r.pub1 + 2);
check("UNLOAD click: cargo -2", r.cargo2 === r.cargo1 - 2);
check("close button removes window", r.windowClosed);
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES: " + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
