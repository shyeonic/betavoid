import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const staticServer = process.env.BETA_VOID_STATIC_URL ? null : createStaticServer(workspaceRoot);
if (staticServer) {
  await new Promise((resolveListen) => staticServer.listen(0, "127.0.0.1", resolveListen));
}
const address = staticServer?.address();
const baseUrl = String(process.env.BETA_VOID_STATIC_URL || `http://127.0.0.1:${address.port}`)
  .replace(/\/+$/, "");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.route("**/js/main.js", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: ""
  }));
  await page.goto(`${baseUrl}/index.html`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { GameManager } = await import("/js/GameManager.js");
    const { OnlineApiClient } = await import("/js/OnlineApiClient.js");
    const { RemotePlayerManager } = await import("/js/RemotePlayerManager.js");
    const THREE = await import("three");
    const {
      createStandardMovementPlan,
      deriveMovementState
    } = await import("/js/navigationKinematics.js");

    const speedManager = Object.create(GameManager.prototype);
    speedManager.state = {
      phase: "running",
      speed: 100,
      desiredSpeed: 100,
      autopilotPhase: "cruising"
    };
    speedManager.shipStats = { minSpeed: -25, maxSpeed: 100 };
    speedManager.isDocked = () => false;
    speedManager.isHyperdrive = false;
    speedManager.cancelPendingNavigationForManualInput = () => false;
    speedManager.cancelAutopilot = () => {
      speedManager.desiredSpeedAtCancellation = speedManager.state.desiredSpeed;
      speedManager.state.autopilotPhase = null;
    };
    speedManager.setManualSpeed(0);
    if (speedManager.desiredSpeedAtCancellation !== 0) {
      throw new Error("Stop intent was captured after autopilot cancellation.");
    }

    const keyboardManager = Object.create(GameManager.prototype);
    keyboardManager.state = {
      phase: "running",
      speed: 100,
      desiredSpeed: 100,
      autopilotPhase: "cruising"
    };
    keyboardManager.shipStats = { minSpeed: -25, maxSpeed: 100 };
    keyboardManager.isHyperdrive = false;
    keyboardManager.activeActions = new Set();
    keyboardManager.getActionForCode = () => "stopSpeed";
    keyboardManager.cancelPendingNavigationForManualInput = () => false;
    keyboardManager.clearTarget = () => {
      keyboardManager.desiredSpeedAtCancellation = keyboardManager.state.desiredSpeed;
      keyboardManager.state.autopilotPhase = null;
    };
    keyboardManager.onKeyDown({
      code: "End",
      target: document.body,
      preventDefault() {}
    });
    if (keyboardManager.desiredSpeedAtCancellation !== 0) {
      throw new Error("End key canceled autopilot before applying its stop intent.");
    }

    let resolveOverride;
    let overridePayload = null;
    let savedProjectionCount = 0;
    const overrideManager = Object.create(GameManager.prototype);
    overrideManager.state = { desiredSpeed: 0 };
    overrideManager.worldConfig = { renderScale: 0.01 };
    overrideManager.pendingManualNavigationOverride = null;
    overrideManager.navigationRecordFailed = false;
    overrideManager.disposed = false;
    overrideManager.ui = { showToast() {} };
    overrideManager.worldDataManager = {
      createNavigationActionId: () => "override-presentation-check",
      manualOverrideNavigation: (payload) => {
        overridePayload = payload;
        return new Promise((resolve) => {
          resolveOverride = resolve;
        });
      }
    };
    overrideManager.savePlayerShipState = async () => {
      savedProjectionCount += 1;
    };
    overrideManager.handleNavigationRecordFailure = (error) => {
      throw error;
    };
    overrideManager.applyAuthoritativeNavigationState = () => {
      throw new Error("A successful manual override reapplied server presentation state.");
    };

    const overridePromise = overrideManager.recordAuthoritativeManualOverride();
    overrideManager.state.desiredSpeed = 35;
    resolveOverride({
      ship: { speed: 100, desiredSpeed: 100 },
      activeContract: null,
      serverTime: Date.now()
    });
    await overridePromise;

    if (overridePayload.desiredSpeed !== 0) {
      throw new Error("Manual override did not send the stop intent.");
    }
    if (overrideManager.state.desiredSpeed !== 35) {
      throw new Error("Server response overwrote newer local manual input.");
    }
    if (savedProjectionCount !== 1) {
      throw new Error("Accepted server baseline was not followed by a local projection save.");
    }

    const pendingManager = Object.create(GameManager.prototype);
    pendingManager.pendingNavigationCommand = null;
    pendingManager.pendingManualNavigationOverride = { promise: Promise.resolve() };
    pendingManager.ui = { showToast() {} };
    const accepted = pendingManager.beginDeterministicNavigation(
      "standard",
      { x: 1, y: 2, z: 3 },
      "nav"
    );
    if (accepted !== false) {
      throw new Error("A deterministic command was queued during manual cancellation.");
    }

    const physics = {
      maxSpeed: 100,
      minSpeed: -25,
      accelerationRate: 10,
      decelerationRate: 20,
      pitchRate: 1.45,
      yawRate: 1.55,
      arrivalRadius: 1
    };
    const contract = {
      ...createStandardMovementPlan({
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        speed: 0,
        target: { x: 0, y: 0, z: 10_000 },
        physics,
        issuedAt: 1_000_000
      }),
      contractId: "route-presentation-check",
      clientActionId: "nav-presentation-check"
    };
    let estimatedServerNow = contract.flightAt + 2_000;
    const timelineManager = Object.create(GameManager.prototype);
    timelineManager.state = {
      speed: 0,
      desiredSpeed: 0,
      autopilotPhase: "accelerating",
      autopilotPeakSpeed: contract.peakSpeed
    };
    timelineManager.worldConfig = { renderScale: 1 };
    timelineManager.pendingManualNavigationOverride = null;
    timelineManager.activeNavLogId = contract.clientActionId;
    timelineManager.hyperdriveLogId = null;
    timelineManager.authoritativeAutopilotRoll = 0;
    timelineManager.activeActions = new Set();
    timelineManager.shipStats = { rollRate: 1 };
    timelineManager.ship = new THREE.Object3D();
    timelineManager.vectors = {
      forward: new THREE.Vector3(),
      up: new THREE.Vector3(),
      movement: new THREE.Vector3()
    };
    timelineManager.quaternions = {
      navigationStart: new THREE.Quaternion(),
      navigationTarget: new THREE.Quaternion(),
      localRotation: new THREE.Quaternion()
    };
    timelineManager.axes = { z: new THREE.Vector3(0, 0, 1) };
    timelineManager.lookMatrix = new THREE.Matrix4();
    timelineManager.worldMapManager = {
      toRenderVector: (position) => new THREE.Vector3(position.x, position.y, position.z)
    };
    timelineManager.worldDataManager = {
      getNavigationState: () => ({
        ship: { rotation: { x: 0, y: 0, z: 0, w: 1 } },
        activeContract: contract
      }),
      getEstimatedNavigationServerNow: () => estimatedServerNow
    };
    timelineManager.clearTarget = () => {
      throw new Error("Timeline fixture arrived unexpectedly.");
    };

    timelineManager.updateAuthoritativeNavigationPresentation(0);
    estimatedServerNow += 10_000;
    timelineManager.updateAuthoritativeNavigationPresentation(0);
    const expectedTimeline = deriveMovementState(contract, estimatedServerNow);
    if (Math.abs(timelineManager.ship.position.z - expectedTimeline.position.z) > 0.001) {
      throw new Error("Authoritative presentation drifted from the server timeline.");
    }
    if (Math.abs(timelineManager.state.speed - expectedTimeline.speed) > 0.001) {
      throw new Error("Authoritative speed was integrated from frame time.");
    }

    let arrivalCount = 0;
    estimatedServerNow = contract.arriveAt + 1;
    timelineManager.clearTarget = () => {
      arrivalCount += 1;
      timelineManager.activeNavLogId = null;
      timelineManager.state.autopilotPhase = null;
    };
    timelineManager.updateAuthoritativeNavigationPresentation(0);
    timelineManager.updateAuthoritativeNavigationPresentation(0);
    if (arrivalCount !== 1) {
      throw new Error("Logical arrival was reconciled repeatedly while its GET was pending.");
    }

    const remoteManager = new RemotePlayerManager({
      scene: new THREE.Scene(),
      resourceManager: { loadShipModel: async () => ({ object: new THREE.Group() }) },
      shipDefinitions: { ship_01: {} },
      defaultShipId: "ship_01",
      toRenderVector: (position) => new THREE.Vector3(position.x, position.y, position.z)
    });
    const remoteState = remoteManager.createPeerState("remote-pilot");
    remoteState.root = new THREE.Group();
    remoteState.root.position.set(1, 2, 3);
    remoteState.initialized = true;
    remoteState.shipId = "ship_01";
    remoteManager.peers.set("remote-pilot", remoteState);
    remoteManager.upsertObservedPeers([{
      character_id: "remote-pilot",
      ship_id: "ship_01",
      updated_at: 2_000_000,
      route: null,
      pose: {
        server_at: 2_000_000,
        position: { x: 40, y: 50, z: 60 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 0, y: 0, z: 0 }
      }
    }], { snap: true, now: 2_000_000 });
    if (remoteState.root.position.distanceTo(new THREE.Vector3(40, 50, 60)) > 0.001) {
      throw new Error("Targeted scanner response was smoothed from a stale ghost position.");
    }

    let observationCacheMode = null;
    const onlineApi = new OnlineApiClient({
      identity: { getIdToken: async () => "test-token" },
      baseUrl: "https://example.invalid",
      fetchImpl: async (_url, options) => {
        observationCacheMode = options.cache;
        return new Response(JSON.stringify({
          ok: true,
          scope: "ship",
          server_time: 2_000_000,
          peers: []
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });
    await onlineApi.observeSpace({ shipUid: "remote-ship", limit: 1 });
    if (observationCacheMode !== "no-store") {
      throw new Error("Targeted scanner GET did not bypass browser caches.");
    }

    return {
      stopIntentAtCancellation: speedManager.desiredSpeedAtCancellation,
      endKeyIntentAtCancellation: keyboardManager.desiredSpeedAtCancellation,
      sentDesiredSpeed: overridePayload.desiredSpeed,
      latestLocalDesiredSpeed: overrideManager.state.desiredSpeed,
      savedProjectionCount,
      authoritativeTimelineZ: expectedTimeline.position.z,
      arrivalCount,
      scannerPositionZ: remoteState.root.position.z,
      observationCacheMode
    };
  });

  console.log("navigation presentation check passed", result);
} finally {
  await browser.close();
  if (staticServer) {
    await new Promise((resolveClose, rejectClose) => staticServer.close((error) => (
      error ? rejectClose(error) : resolveClose()
    )));
  }
}

function createStaticServer(root) {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = resolve(root, relativePath);
      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

function contentType(filePath) {
  return ({
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json"
  })[extname(filePath).toLowerCase()] || "application/octet-stream";
}
