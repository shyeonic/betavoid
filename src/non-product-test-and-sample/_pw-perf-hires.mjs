import { chromium } from "playwright";
import { installFirebaseAuthMock } from "./_pw-firebase-auth-mock.mjs";

const URL = "http://localhost:8123/index.html";
// Force GPU-bound: large viewport * deviceScaleFactor 2 (game caps pixelRatio at 2).
const VW = Number(process.argv[2] || 2560);
const VH = Number(process.argv[3] || 1440);
const DSF = Number(process.argv[4] || 2);

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"]
});
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { const t = m.text(); if (t.startsWith("[game-data]")) console.log("[page]", t); });

await installFirebaseAuthMock(page);
await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__betaVoidGame, { timeout: 60000 });
const boot = await page.evaluate(async () => {
  const g = window.__betaVoidGame; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitPhase = async (p, ms = 45000) => { const t0 = performance.now(); while (g.state?.phase !== p) { if (performance.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (g.state?.phase === "standby") await g.prepareStartSequence();
  if (!await waitPhase("ready")) return { ok: false };
  await g.startGame(); await waitPhase("running");
  const t0 = performance.now(); while (!g.renderPipeline && performance.now() - t0 < 10000) await sleep(50);
  return { ok: !!g.renderPipeline, dpr: window.devicePixelRatio, finalPR: g.renderPipeline?.getFinalPixelRatio?.() };
});
console.log("boot:", JSON.stringify(boot), `viewport=${VW}x${VH} dsf=${DSF}`);
if (!boot.ok) { await browser.close(); process.exit(2); }

// GPU-bound frame-time sampler. With vsync disabled, rAF deltas reflect render cost.
async function measure(frames = 200) {
  return page.evaluate((N) => new Promise((resolve) => {
    const dts = []; let last = performance.now(); let i = -10; // discard first 10 (warmup)
    function tick(now) {
      if (i >= 0) dts.push(now - last);
      last = now;
      if (++i >= N) {
        dts.sort((a, b) => a - b);
        const sum = dts.reduce((a, b) => a + b, 0);
        const pct = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
        resolve({ avg: sum / dts.length, median: pct(0.5), p95: pct(0.95) });
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), frames);
}

const out = {};
for (const mode of ["off", "outline", "full"]) {
  await page.evaluate((m) => {
    const g = window.__betaVoidGame;
    if (typeof g.setPerformanceSetting === "function") g.setPerformanceSetting("stylizedRenderMode", m);
    else g.renderPipeline.setStylizedRenderMode(m);
  }, mode);
  await page.waitForTimeout(1000);
  const s = await measure(200);
  out[mode] = s;
  console.log(`mode=${mode}  avg=${s.avg.toFixed(2)}ms  median=${s.median.toFixed(2)}  p95=${s.p95.toFixed(2)}  (~${(1000/s.avg).toFixed(1)}fps)`);
}
const base = out.off.avg;
console.log(`\nDelta vs off:  outline +${(out.outline.avg-base).toFixed(2)}ms (${((out.outline.avg/base-1)*100).toFixed(0)}%)   full +${(out.full.avg-base).toFixed(2)}ms (${((out.full.avg/base-1)*100).toFixed(0)}%)`);
await browser.close();
console.log("DONE");
