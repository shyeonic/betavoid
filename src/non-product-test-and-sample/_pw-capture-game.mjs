import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { installFirebaseAuthMock } from "./_pw-firebase-auth-mock.mjs";

const URL = "http://localhost:8123/index.html";
const OUT = "non-product-test-and-sample/_pw-captures";
const LABEL = process.argv[2] || "before"; // "before" | "after"
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--ignore-gpu-blocklist"]
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on("console", (m) => { const t = m.text(); if (!t.includes("GL Driver Message")) console.log("[page]", t); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await installFirebaseAuthMock(page);
await page.goto(URL, { waitUntil: "load", timeout: 60000 });

// boot: wait for game handle + renderPipeline, drive standby -> ready -> running
await page.waitForFunction(() => !!window.__betaVoidGame, { timeout: 60000 });
const boot = await page.evaluate(async () => {
  const g = window.__betaVoidGame;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitPhase = async (p, ms = 45000) => {
    const t0 = performance.now();
    while (g.state?.phase !== p) { if (performance.now() - t0 > ms) return false; await sleep(50); }
    return true;
  };
  try {
    if (g.state?.phase === "standby") await g.prepareStartSequence();
    const ready = await waitPhase("ready");
    if (!ready) return { ok: false, where: "ready", phase: g.state?.phase };
    await g.startGame();
    const running = await waitPhase("running");
    // wait for renderPipeline
    const t0 = performance.now();
    while (!g.renderPipeline && performance.now() - t0 < 10000) await sleep(50);
    return { ok: running && !!g.renderPipeline, phase: g.state?.phase, hasPipeline: !!g.renderPipeline };
  } catch (e) {
    return { ok: false, error: String(e), phase: g.state?.phase };
  }
});
console.log("boot:", JSON.stringify(boot));
if (!boot.ok) { await page.screenshot({ path: `${OUT}/game-${LABEL}-bootfail.png` }); await browser.close(); process.exit(2); }

// frame-time sampler: collect N rAF deltas
async function measure(frames = 150) {
  return page.evaluate((N) => new Promise((resolve) => {
    const dts = []; let last = performance.now(); let i = 0;
    function tick(now) {
      dts.push(now - last); last = now;
      if (++i >= N) {
        dts.sort((a, b) => a - b);
        const sum = dts.reduce((a, b) => a + b, 0);
        const pct = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
        resolve({ avg: sum / dts.length, median: pct(0.5), p95: pct(0.95), min: dts[0], max: dts[dts.length - 1] });
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), frames);
}

const results = {};
for (const mode of ["off", "outline", "full"]) {
  await page.evaluate((m) => {
    const g = window.__betaVoidGame;
    if (typeof g.setPerformanceSetting === "function") g.setPerformanceSetting("stylizedRenderMode", m);
    else g.renderPipeline.setStylizedRenderMode(m);
  }, mode);
  await page.waitForTimeout(900); // settle
  const stats = await measure(150);
  results[mode] = stats;
  await page.screenshot({ path: `${OUT}/game-${LABEL}-${mode}.png` });
  console.log(`mode=${mode}  avg=${stats.avg.toFixed(2)}ms  median=${stats.median.toFixed(2)}  p95=${stats.p95.toFixed(2)}  max=${stats.max.toFixed(2)}  (~${(1000/stats.avg).toFixed(1)}fps)`);
}

console.log("RESULTS_JSON " + JSON.stringify({ label: LABEL, results }));
await browser.close();
console.log("DONE");
