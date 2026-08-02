import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_PATH = resolve(
  PROJECT_ROOT,
  "workers",
  "beta-void-api",
  "src",
  "generated",
  "world-template.js"
);
const WORLD_ID = "primary";
const WORLD_SEED = "beta-void-primary-v1";
const WORLD_TEMPLATE_EPOCH = Date.UTC(2026, 0, 1);

const server = createServer((request, response) => {
  if (request.url === "/__world-template") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end("<!doctype html><title>beta-void world template</title>");
    return;
  }

  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
    .replace(/^\/+/, "");
  const filePath = resolve(PROJECT_ROOT, pathname || "index.html");
  if (
    !filePath.startsWith(PROJECT_ROOT)
    || !existsSync(filePath)
    || statSync(filePath).isDirectory()
  ) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }

  const contentTypes = {
    ".gmap": "application/json",
    ".gmapdata": "application/json",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json"
  };
  response.setHeader("Content-Type", contentTypes[extname(filePath)] || "application/octet-stream");
  createReadStream(filePath).pipe(response);
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const { port } = server.address();
  await page.goto(`http://127.0.0.1:${port}/__world-template`);
  const template = await page.evaluate(async ({ generatedAt, worldId, worldSeed }) => {
    const [{ loadGameData }, { WorldDataManager }] = await Promise.all([
      import("/js/GameDataLoader.js"),
      import("/js/WorldDataManager.js")
    ]);
    const gameData = await loadGameData();
    const characterId = "world-template-generator";
    const manager = new WorldDataManager({
      gameData,
      onlineApi: {},
      playerState: {
        characterId,
        schemaVersion: 1,
        assetsRevision: 1,
        shipRevision: 0,
        assets: {
          character_id: characterId,
          profile: null,
          storageLocations: [],
          quantityItems: [],
          uniqueItems: [],
          slotAssignments: []
        },
        shipState: null,
        docking: null,
        updatedAt: generatedAt,
        serverTime: generatedAt
      },
      navigationState: {
        characterId,
        ship: {
          shipUid: `ship-${characterId}-ship_01-001`,
          worldId,
          ownerCharacterId: characterId,
          displayName: characterId,
          shipDefinitionId: gameData.defaultShipId,
          spatialMode: "FIELD",
          position: { x: 0, y: 0, z: 0 },
          resolvedPosition: null,
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          speed: 0,
          desiredSpeed: 0,
          sectorId: null,
          chunkId: "0:0:0",
          phase: "manual",
          revision: 1,
          checkpointAt: generatedAt,
          updatedAt: generatedAt
        },
        custody: null,
        betaSpaceSession: null,
        activeContract: null,
        serverTime: generatedAt
      },
      worldBootstrap: {
        worldId,
        seed: worldSeed,
        dataSourceKey: gameData.dataSourceKey,
        revision: 1,
        generatedAt,
        snapshot: {
          sectors: [{}],
          resourceNodes: [],
          buildings: [],
          betaVoids: [],
          resourceManager: {},
          buildingStorages: []
        }
      }
    });
    const generated = manager.createGeneratedWorld({
      seed: worldSeed,
      generatedAt
    });
    const shipPhysics = Object.fromEntries(
      Object.entries(gameData.shipDefinitions).map(([shipId, definition]) => [
        shipId,
        structuredClone(definition.specs)
      ])
    );
    const buildingDocking = Object.fromEntries(
      Object.entries(gameData.buildingDefinitions)
        .filter(([, definition]) => definition?.docking)
        .map(([buildingId, definition]) => [
          buildingId,
          {
            capacity: definition.docking.capacity,
            facing: Array.isArray(definition.docking.facing)
              ? [...definition.docking.facing]
              : [0, 0, 1]
          }
        ])
    );
    const enabledChunkGroups = new Map();
    for (const chunk of gameData.enabledChunks || []) {
      const x = Number(chunk.x) || 0;
      const y = Number(chunk.y) || 0;
      const z = Number(chunk.z) || 0;
      const key = `${x}:${y}`;
      if (!enabledChunkGroups.has(key)) enabledChunkGroups.set(key, { x, y, values: [] });
      enabledChunkGroups.get(key).values.push(z);
    }
    const enabledChunkRuns = [];
    for (const { x, y, values } of enabledChunkGroups.values()) {
      values.sort((a, b) => a - b);
      let start = null;
      let end = null;
      for (const z of values) {
        if (start == null) {
          start = z;
          end = z;
        } else if (z === end + 1) {
          end = z;
        } else {
          enabledChunkRuns.push([x, y, start, end]);
          start = z;
          end = z;
        }
      }
      if (start != null) enabledChunkRuns.push([x, y, start, end]);
    }
    enabledChunkRuns.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    return {
      schemaVersion: 1,
      templateEpoch: generatedAt,
      worldId,
      seed: worldSeed,
      dataSourceKey: gameData.dataSourceKey,
      sectors: generated.sectors,
      resourceNodes: generated.resourceNodes,
      buildings: generated.buildings,
      betaVoids: generated.betaVoids,
      resourceManager: generated.resourceManager,
      buildingStorages: generated.stationInventories.buildingStorages,
      buildingDocking,
      betaVoidLifecycle: {
        minDistance: gameData.worldConfig.betaVoidMinDistance,
        placementMargin: gameData.worldConfig.betaVoidPlacementMargin,
        activeResetMinMinutes: gameData.worldConfig.betaVoidActiveResetMinMinutes,
        activeResetMaxMinutes: gameData.worldConfig.betaVoidActiveResetMaxMinutes
      },
      resourceLifecycle: {
        checkInterval: gameData.worldConfig.resourceCheckInterval,
        placementMargin: gameData.worldConfig.placementMargin,
        minDistance: gameData.worldConfig.resourceMinDistance,
        resourceIds: [...gameData.initialResourceTypes],
        definitions: structuredClone(gameData.resourceDefinitions),
        itemTypes: Object.fromEntries(
          Object.entries(gameData.itemDefinitions).map(([itemId, definition]) => [
            itemId,
            definition.type || null
          ])
        ),
        enabledChunkRuns: enabledChunkRuns.map((run) => run.join(",")).join(";")
      },
      economyConfig: {
        gathering: {
          effectiveRatePerSecond: 0.1,
          maximumRange: 8000
        },
        itemMasses: Object.fromEntries(
          Object.entries(gameData.itemDefinitions).map(([itemId, definition]) => [
            itemId,
            Number(definition.mass) || 0
          ])
        ),
        shipCargoCapacities: Object.fromEntries(
          Object.entries(gameData.shipDefinitions).map(([shipId, definition]) => [
            shipId,
            Number(definition.combat?.base_stats?.cargo_capacity) || 0
          ])
        ),
        buildingTrade: Object.fromEntries(
          Object.entries(gameData.buildingDefinitions).map(([buildingId, definition]) => [
            buildingId,
            {
              enabled: Boolean(definition.trade?.enabled),
              handlingSpeed: Number(definition.trade?.handling_speed) || 0,
              cargoCapacity: Number(definition.trade?.cargo_capacity) || 0
            }
          ])
        )
      },
      movementConfig: {
        renderScale: gameData.worldConfig.renderScale,
        chunkSize: gameData.worldConfig.chunkSize,
        defaultShipId: gameData.defaultShipId,
        shipPhysics
      }
    };
  }, {
    generatedAt: WORLD_TEMPLATE_EPOCH,
    worldId: WORLD_ID,
    worldSeed: WORLD_SEED
  });

  mkdirSync(resolve(OUTPUT_PATH, ".."), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    `// Generated by npm run generate:world-template. Do not edit manually.\n`
      + `export const WORLD_TEMPLATE = ${JSON.stringify(template, null, 2)};\n`,
    "utf8"
  );
  process.stdout.write(
    `Generated ${OUTPUT_PATH} with `
      + `${template.resourceNodes.length} resources, `
      + `${template.buildings.length} buildings, `
      + `${template.betaVoids.length} Beta Voids.\n`
  );
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
