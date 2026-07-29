import { chromium } from "playwright";

const baseUrl = process.env.BETA_VOID_STATIC_URL || "http://127.0.0.1:8792";
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 }
];
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.route("**/admin/admin.js", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: ""
    }));
    await page.goto(`${baseUrl}/admin/`, { waitUntil: "networkidle" });
    const layout = await page.evaluate(renderFixture);
    if (layout.scrollWidth !== layout.clientWidth) {
      throw new Error(`${viewport.name}: page overflows horizontally.`);
    }
    await page.screenshot({
      path: `playwright-artifacts/admin-dashboard-${viewport.name}.png`,
      fullPage: true
    });
    console.log(`${viewport.name}: ${layout.clientWidth}px, no horizontal overflow`);
  }
} finally {
  await browser.close();
}

function renderFixture() {
  document.getElementById("authView").hidden = true;
  document.getElementById("appShell").hidden = false;
  document.body.dataset.state = "ready";

  const values = {
    adminIdentity: "infira.2025@gmail.com",
    connectionStatus: "온라인",
    revisionMetric: "2",
    resourceMetric: "33",
    buildingMetric: "31",
    betaVoidMetric: "10",
    storageMetric: "31",
    fieldShipMetric: "24",
    activeRouteMetric: "7",
    worldIdValue: "primary",
    seedValue: "beta-void-primary-v1",
    dataSourceValue: "v3.2-current-data",
    generatedValue: "2026. 7. 30. 오후 3:24:00",
    pageStatus: "18개"
  };
  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).textContent = value;
  }
  document.getElementById("connectionStatus").classList.add("online");

  const sectorRows = document.getElementById("sectorRows");
  for (let index = 1; index <= 10; index += 1) {
    sectorRows.append(createRow([`Sector ${index}`, "3", "3", "1"]));
  }

  const entityRows = document.getElementById("entityRows");
  for (let index = 1; index <= 18; index += 1) {
    entityRows.append(createRow([
      index % 2 ? "resource_node" : "building",
      `entity-long-identifier-${String(index).padStart(3, "0")}`,
      `sector-${(index % 10) + 1}`,
      `chunk-${index}`,
      "1",
      "2026. 7. 30."
    ]));
  }

  const shipRows = document.getElementById("shipRows");
  for (let index = 1; index <= 8; index += 1) {
    shipRows.append(createRow([
      `Pilot ${index}`,
      "ship_01",
      "FIELD",
      `SEC-${String(index).padStart(3, "0")}`,
      index % 2 ? "cruising" : "manual",
      index % 2 ? "standard" : "-"
    ]));
  }

  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };

  function createRow(cellValues) {
    const row = document.createElement("tr");
    for (const value of cellValues) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }
}
