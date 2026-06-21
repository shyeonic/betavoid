import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:8123/non-product-test-and-sample/_pw-hull-overlap-test.html";
const OUT = "non-product-test-and-sample/_pw-captures";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

for (const mode of ["plain", "hull"]) {
  await page.goto(`${BASE}?mode=${mode}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
  const file = `${OUT}/hull-overlap-${mode}.png`;
  await page.screenshot({ path: file });
  console.log("saved", file);
}

await browser.close();
console.log("DONE");
