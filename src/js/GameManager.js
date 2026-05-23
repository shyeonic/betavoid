import * as THREE from "three";
import { CONFIG, CONTROL_SETTINGS, DEFAULT_KEY_BINDINGS, KEY_BINDING_GROUPS } from "./config.js";
import { ResourceManager } from "./ResourceManager.js";
import { SoundManager } from "./SoundManager.js";
import { TargetingOverlay } from "./TargetingOverlay.js";
import { UIManager } from "./UIManager.js";
import { WorldDataManager } from "./WorldDataManager.js";
import { WorldMapManager } from "./WorldMapManager.js";
import { BUILDING_DEFINITIONS, ITEM_DEFINITIONS, RESOURCE_DEFINITIONS, WORLD_CONFIG } from "./worldDefinitions.js";
import { createI18n } from "./i18n/i18n.js";

export class GameManager {
  constructor({ root }) {
    this.root = root;
    this.config = CONFIG;
    this.keyBindingStorageKey = "void-zero-key-bindings";
    this.keyBindings = this.loadKeyBindings();
    this.i18n = createI18n();
    this.worldViewSettings = { chunkBoundsMode: "all" };
    this.navDeadReckonSettings = { mode: "fixed", capMinutes: 5 };
    this.keyToAction = this.createKeyToAction(this.keyBindings);
    this.state = {
      phase: "standby",
      speed: 0,
      desiredSpeed: 0,
      autopilotPhase: null,
      autopilotPeakSpeed: 0,
      cameraFxAmount: 0,
      speedTrend: 0
    };
    this.navTarget = null;
    this.activeNavLogId = null;

    this.activeActions = new Set();
    this.clock = new THREE.Clock();
    this.ui = new UIManager({
      config: this.config,
      i18n: this.i18n,
      keyBindings: this.keyBindings,
      keyBindingGroups: KEY_BINDING_GROUPS,
      defaultKeyBindings: DEFAULT_KEY_BINDINGS
    });
    this.resourceManager = new ResourceManager({
      onChange: (snapshot) => this.ui.setResourceProgress(snapshot)
    });
    this.soundManager = new SoundManager(this.resourceManager);
    this.worldDataManager = new WorldDataManager();
    this.worldMapManager = null;
    this.targetingOverlay = new TargetingOverlay({ canvas: this.ui.elements.targetingCanvas });
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.selectedWorldObject = null;
    this.selectionPointer = {
      pointerId: null,
      startX: 0,
      startY: 0,
      maySelect: false,
      moved: false
    };
    this.selectionBounds = new THREE.Box3();
    this.selectionChildBounds = new THREE.Box3();
    this.selectionBoundsSize = new THREE.Vector3();
    this.selectionBoundsCenter = new THREE.Vector3();
    this.selectionWorldScale = new THREE.Vector3();
    this.selectionRootInverse = new THREE.Matrix4();
    this.selectionChildMatrix = new THREE.Matrix4();
    this.selectionScratch = new THREE.Vector3();
    this.selectionScratchB = new THREE.Vector3();
    this.selectionCameraDirection = new THREE.Vector3();

    this.vectors = {
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      targetVec: new THREE.Vector3(),
      movement: new THREE.Vector3(),
      shipCenter: new THREE.Vector3(),
      modelCenter: new THREE.Vector3(),
      desiredCameraPosition: new THREE.Vector3(),
      desiredCameraUp: new THREE.Vector3(0, 1, 0),
      cameraUp: new THREE.Vector3(0, 1, 0),
      cameraActionOffset: new THREE.Vector3(),
      cameraActionTarget: new THREE.Vector3(),
      cameraOrbitRightAxis: new THREE.Vector3(),
      cameraOrbitUpAxis: new THREE.Vector3(),
      cameraLocalOffset: new THREE.Vector3()
    };

    this.quaternions = {
      desired: new THREE.Quaternion(),
      localRotation: new THREE.Quaternion(),
      cameraOrbit: new THREE.Quaternion(),
      cameraOrbitTarget: new THREE.Quaternion(),
      cameraOrbitYawDelta: new THREE.Quaternion(),
      cameraOrbitPitchDelta: new THREE.Quaternion(),
      cameraReturnStart: new THREE.Quaternion(),
      cameraReturn: new THREE.Quaternion(),
      cameraFollowTarget: new THREE.Quaternion()
    };

    this.axes = {
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1)
    };

    this.lookMatrix = new THREE.Matrix4();
    this.shipBounds = new THREE.Box3();
    this.cameraControl = {
      distance: this.config.cameraDistance,
      orbitDistance: this.config.cameraDistance,
      returnStartDistance: this.config.cameraDistance,
      returnTargetDistance: this.config.cameraDistance,
      followShip: true,
      returningToFollow: false,
      returnElapsed: 0,
      dragging: false,
      pointerId: null,
      pointers: new Map(),
      pinching: false,
      pinchDistance: 0,
      touchDpadPointerId: null,
      touchDpadStartX: 0,
      touchDpadStartY: 0,
      touchDpadActions: new Set(),
      touchDpadAxisX: 0,
      touchDpadAxisY: 0,
      touchDpadDeadzone: 24,
      touchDpadMaxDistance: 150,
      lastX: 0,
      lastY: 0
    };

    this.starLayers = [];
    this.loadingStarted = false;
    this.starting = false;
    this.disposed = false;
    this.animationFrameId = null;
    this.boundEvents = null;
    this.worldSummaryLastUpdatedAt = 0;
    this.worldSummaryPending = false;
    this.playerShipSaveLastUpdatedAt = 0;
    this.playerShipSavePending = false;
    this.playerShipSaveInterval = 1000;
    this.currentLocationBgmId = null;
    this.worldDataResetting = false;
  }

  async init() {
    await this.handleDataResetRequest();
    this.setupRenderer();
    this.setupScene();
    this.setupWorldSystems();
    this.setupWorld();
    this.setupTargetMarker();
    this.setupEvents();
    this.ui.bindControls({
      onPrepare: () => this.prepareStartSequence(),
      onStart: () => this.startGame(),
      onNavigate: (coords) => this.setTarget(coords),
      onCancelNavigate: () => this.clearTarget("navigation stopped"),
      onSetSpeed: (speed) => this.setManualSpeed(speed),
      onKeyBindingsChange: (bindings) => this.setKeyBindings(bindings),
      onRegenerateWorld: () => this.regenerateWorld(),
      onClearAllData: () => this.clearAllData(),
      onReloadWorldData: () => this.reloadWorldData(),
      onChunkBoundsModeChange: (mode) => this.setChunkBoundsMode(mode),
      onNavRestoreModeChange: (mode) => {
        this.navDeadReckonSettings.mode = mode === "infinite" ? "infinite" : "fixed";
        this.ui.setNavRestoreMode(this.navDeadReckonSettings.mode);
        void this.saveNavDeadReckonSettings();
      },
      onNavRestoreCapChange: (minutes) => {
        this.navDeadReckonSettings.capMinutes = minutes;
        void this.saveNavDeadReckonSettings();
      },
      onRequestObjectList: () => this.getWorldObjectList(),
      onSelectWorldObject: (object) => this.selectWorldObjectFromListItem(object),
      onNavigateToWorldObject: (object) => this.navigateToWorldObject(object),
      onClearWorldSelection: () => this.clearWorldSelection(),
      onToggleCameraMode: () => this.requestCameraToggle()
    });
    this.ui.setChunkBoundsMode(this.worldViewSettings.chunkBoundsMode);

    this.ui.setInteractionGate();
    this.updateCameraProjection();
    this.targetingOverlay.resize();
    this.resetInitialCamera();
    this.animate();
  }

  setupWorldSystems() {
    this.worldMapManager = new WorldMapManager({
      scene: this.scene,
      renderScale: WORLD_CONFIG.renderScale
    });
    this.worldMapManager.setChunkBoundsMode(this.worldViewSettings.chunkBoundsMode);
  }

  loadKeyBindings() {
    try {
      const savedBindings = JSON.parse(localStorage.getItem(this.keyBindingStorageKey));
      return this.normalizeKeyBindings(savedBindings);
    } catch {
      return { ...DEFAULT_KEY_BINDINGS };
    }
  }

  async loadSavedWorldViewSettings() {
    const saved = await this.worldDataManager.getStoreValue("settings", "worldViewSettings");
    const mode = ["all", "sector", "off"].includes(saved?.chunkBoundsMode) ? saved.chunkBoundsMode : "all";
    this.worldViewSettings.chunkBoundsMode = mode;
    this.worldMapManager.setChunkBoundsMode(mode);
    this.ui.setChunkBoundsMode(mode);
  }

  async saveWorldViewSettings() {
    if (!this.worldDataManager.db) return;
    try {
      await this.worldDataManager.putStoreValue("settings", {
        key: "worldViewSettings",
        chunkBoundsMode: this.worldViewSettings.chunkBoundsMode
      });
    } catch {
      this.ui.showErrorToast("settings storage unavailable");
    }
  }

  async loadSavedNavDeadReckonSettings() {
    const saved = await this.worldDataManager.getStoreValue("settings", "navDeadReckonSettings");
    const mode = saved?.mode === "infinite" ? "infinite" : "fixed";
    const capMinutes = Number.isFinite(Number(saved?.capMinutes)) && Number(saved.capMinutes) >= 0
      ? Number(saved.capMinutes) : 5;
    this.navDeadReckonSettings = { mode, capMinutes };
    this.ui.setNavRestoreMode(mode);
    this.ui.setNavRestoreCap(capMinutes);
  }

  async saveNavDeadReckonSettings() {
    if (!this.worldDataManager.db) return;
    try {
      await this.worldDataManager.putStoreValue("settings", {
        key: "navDeadReckonSettings",
        mode: this.navDeadReckonSettings.mode,
        capMinutes: this.navDeadReckonSettings.capMinutes
      });
    } catch {
      this.ui.showErrorToast("settings storage unavailable");
    }
  }

  normalizeKeyBindings(bindings = {}) {
    const normalized = {};
    const usedCodes = new Set();
    const defaults = Object.entries(DEFAULT_KEY_BINDINGS);

    for (const [action, defaultCode] of defaults) {
      const savedCode = typeof bindings[action] === "string" ? bindings[action] : "";
      const preferredCode = savedCode || defaultCode;

      if (!usedCodes.has(preferredCode)) {
        normalized[action] = preferredCode;
        usedCodes.add(preferredCode);
        continue;
      }

      const fallbackCode = !usedCodes.has(defaultCode)
        ? defaultCode
        : defaults.find(([, code]) => !usedCodes.has(code))?.[1];

      normalized[action] = fallbackCode || defaultCode;
      usedCodes.add(normalized[action]);
    }

    return normalized;
  }

  createKeyToAction(bindings) {
    return new Map(Object.entries(bindings).map(([action, code]) => [code, action]));
  }

  setKeyBindings(bindings) {
    this.keyBindings = this.normalizeKeyBindings(bindings);
    this.keyToAction = this.createKeyToAction(this.keyBindings);
    this.activeActions.clear();

    try {
      localStorage.setItem(this.keyBindingStorageKey, JSON.stringify(this.keyBindings));
    } catch {
      this.ui.showErrorToast("settings storage unavailable");
    }
  }

  getActionForCode(code) {
    return this.keyToAction.get(code) || null;
  }

  async prepareStartSequence() {
    if (this.loadingStarted || this.state.phase !== "standby") return;
    this.loadingStarted = true;
    await this.loadResources();
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.root.appendChild(this.renderer.domElement);
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf3fbff);
    this.scene.fog = new THREE.FogExp2(0xe8f7ff, 0.000006);
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 80000);

    this.ship = new THREE.Group();
    this.scene.add(this.ship);
  }

  setupWorld() {
    const globalLight = new THREE.AmbientLight(0xf2fbff, 0.9);
    this.scene.add(globalLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.75);
    keyLight.position.set(7, 8, 6);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x8fdcff, 0.55);
    rimLight.position.set(-8, 4, -8);
    this.scene.add(rimLight);

    const softUnderLight = new THREE.HemisphereLight(0xf7fcff, 0x8bb8c8, 0.45);
    this.scene.add(softUnderLight);

    this.starLayers = [
      this.createStars(1800, 8500, 32.8, 0.98),
      this.createStars(900, 24000, 51.2, 0.74),
      this.createStars(420, 52000, 73.6, 0.5)
    ];
  }

  setupTargetMarker() {
    this.targetMarker = new THREE.Group();
    this.markerRing = new THREE.Mesh(
      new THREE.TorusGeometry(18, 0.75, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x63d2ff, transparent: true, opacity: 0.78 })
    );
    this.markerCore = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.targetMarker.add(this.markerRing, this.markerCore);
    this.targetMarker.visible = false;
    this.scene.add(this.targetMarker);
  }

  setupEvents() {
    this.boundEvents = {
      pointerdown: (event) => this.onPointerDown(event),
      pointermove: (event) => this.onPointerMove(event),
      pointerup: (event) => this.onPointerUp(event),
      pointercancel: (event) => this.stopCameraDrag(event),
      wheel: (event) => this.onWheel(event),
      keydown: (event) => this.onKeyDown(event),
      keyup: (event) => this.onKeyUp(event),
      resize: () => this.onResize()
    };

    this.renderer.domElement.addEventListener("pointerdown", this.boundEvents.pointerdown);
    this.renderer.domElement.addEventListener("pointermove", this.boundEvents.pointermove);
    this.renderer.domElement.addEventListener("pointerup", this.boundEvents.pointerup);
    this.renderer.domElement.addEventListener("pointercancel", this.boundEvents.pointercancel);
    this.renderer.domElement.addEventListener("wheel", this.boundEvents.wheel, { passive: false });
    window.addEventListener("keydown", this.boundEvents.keydown);
    window.addEventListener("keyup", this.boundEvents.keyup);
    window.addEventListener("resize", this.boundEvents.resize);
  }

  async loadResources() {
    if (this.disposed) return;
    const loadingStartedAt = performance.now();
    this.state.phase = "loading";
    this.ui.setLoadingState({
      message: "Loading resources",
      detail: "validating ship, world, and BGM",
      progress: 0,
      canStart: false
    });

    const warnings = [];
    const shipTask = this.resourceManager.loadShipModel()
      .then((result) => {
        if (this.disposed) return result;
        this.addShipModel(result.object);
        window.__shipLoaded = true;
        window.__shipSource = result.source;
        return result;
      })
      .catch((error) => {
        window.__shipLoaded = false;
        warnings.push("ship fallback failed");
        return error;
      });

    const audioTask = this.soundManager.preload()
      .then((loaded) => {
        if (!loaded) warnings.push("BGM preload failed");
        return loaded;
      });

    const worldTask = this.loadWorld()
      .catch((error) => {
        warnings.push("world data failed");
        return error;
      });

    await Promise.allSettled([shipTask, audioTask, worldTask]);
    if (this.disposed) return;
    await this.waitForMinimumLoadingTime(loadingStartedAt);
    if (this.disposed) return;

    this.state.phase = "ready";
    this.ui.setReady({ warnings });
    warnings.forEach((message) => this.ui.showErrorToast(message));
  }

  async loadWorld() {
    await this.worldDataManager.init();
    await this.worldMapManager.loadAssets(this.resourceManager);
    const snapshot = await this.worldDataManager.loadOrCreateWorld();
    this.worldMapManager.renderWorld(snapshot);
    await this.loadSavedWorldViewSettings();
    await this.loadSavedNavDeadReckonSettings();
    await this.restorePlayerShipState();
    this.syncWorldRuntimeWithPlayer({ force: true });
    await this.refreshWorldSummary({ force: true });
    return snapshot;
  }

  async restorePlayerShipState() {
    const [playerShipState, navLogs] = await Promise.all([
      this.worldDataManager.loadOrCreatePlayerShipState(),
      this.worldDataManager.getNavLogs(10)
    ]);

    const activeLog = navLogs.find(log => log.status === "active");
    let usedNavLog = false;

    if (activeLog?.flight_start_at != null && activeLog?.from_position != null) {
      const tSec = (Date.now() - activeLog.flight_start_at) / 1000;

      if (tSec >= activeLog.flight_duration) {
        this.ship.position.set(activeLog.target.x, activeLog.target.y, activeLog.target.z);
        this.state.speed = 0;
        this.state.desiredSpeed = 0;
        void this.worldDataManager.updateNavLog(activeLog.id, { status: "completed", completed_at: Date.now() });
        usedNavLog = true;
      } else {
        const computedPos = this.computeNavPositionAtTime(activeLog, tSec);
        const computedSpeed = this.computeNavSpeedAtTime(activeLog, tSec);
        this.ship.position.copy(computedPos);
        this.state.speed = computedSpeed;

        const navTargetVec = new THREE.Vector3(activeLog.target.x, activeLog.target.y, activeLog.target.z);
        const toTarget = navTargetVec.clone().sub(computedPos);

        if (toTarget.lengthSq() > 0.0001) {
          const direction = toTarget.clone().normalize();
          this.lookMatrix.lookAt(direction, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
          this.ship.quaternion.setFromRotationMatrix(this.lookMatrix).normalize();
        }

        this.navTarget = navTargetVec;
        this.activeNavLogId = activeLog.id;
        this.state.autopilotPeakSpeed = activeLog.peak_speed;
        this.targetMarker.visible = true;
        this.targetMarker.position.copy(navTargetVec);

        const remaining = toTarget.length() - this.config.arrivalRadius;
        const decelDist = computedSpeed > 0
          ? 0.5 * computedSpeed * computedSpeed / this.config.decelerationRate
          : 0;

        if (remaining <= decelDist) {
          this.state.autopilotPhase = "decelerating";
          this.state.desiredSpeed = 0;
        } else {
          this.state.autopilotPhase = "cruising";
          this.state.desiredSpeed = activeLog.peak_speed;
        }

        usedNavLog = true;
      }
    } else if (activeLog) {
      void this.worldDataManager.updateNavLog(activeLog.id, { status: "cancelled", cancelled_at: Date.now() });
    }

    if (!usedNavLog) {
      this.ship.position.copy(this.worldMapManager.toRenderVector(playerShipState.position));
      this.ship.quaternion.set(
        playerShipState.rotation?.x || 0,
        playerShipState.rotation?.y || 0,
        playerShipState.rotation?.z || 0,
        Number.isFinite(Number(playerShipState.rotation?.w)) ? Number(playerShipState.rotation.w) : 1
      ).normalize();
      this.state.speed = Number(playerShipState.speed) || 0;
      this.state.desiredSpeed = Number(playerShipState.desiredSpeed) || 0;

      const savedAt = Number(playerShipState.updated_at) || 0;
      if (savedAt > 0 && Math.abs(this.state.speed) > 0.001) {
        const elapsed = (Date.now() - savedAt) / 1000;
        if (elapsed > 0) {
          const { mode, capMinutes } = this.navDeadReckonSettings;
          const result = mode === "infinite"
            ? this.extrapolateShipMovement(this.state.speed, this.state.desiredSpeed, elapsed)
            : this.extrapolateShipMovementFixed(this.state.speed, capMinutes * 60, elapsed);
          if (Math.abs(result.distance) > 0.001) {
            this.ship.getWorldDirection(this.vectors.forward).normalize();
            this.ship.position.addScaledVector(this.vectors.forward, result.distance);
          }
          this.state.speed = result.finalSpeed;
          if (mode !== "infinite") this.state.desiredSpeed = result.finalSpeed;
        }
      }
    }

    if (this.state.autopilotPhase === null) {
      this.state.autopilotPeakSpeed = 0;
      this.navTarget = null;
      this.activeNavLogId = null;
      this.targetMarker.visible = false;
    }

    this.resetInitialCamera();
  }

  waitForMinimumLoadingTime(startedAt) {
    const minimumDuration = 1100;
    const remaining = minimumDuration - (performance.now() - startedAt);
    if (remaining <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, remaining));
  }

  async startGame() {
    if (this.disposed) return;
    if (this.starting) return;
    if (this.state.phase !== "ready" && this.state.phase !== "paused") return;

    this.starting = true;
    this.state.phase = "running";
    this.clock.getDelta();
    this.ui.hideStartScene();

    const initialBgmId = this.getBgmIdForCurrentPlayerPosition();
    const audioStarted = await this.soundManager.enterGame(initialBgmId);
    if (this.disposed) return;
    if (!audioStarted) {
      this.ui.showErrorToast("BGM unavailable");
    } else {
      this.currentLocationBgmId = initialBgmId;
    }
    this.starting = false;
  }

  addShipModel(model) {
    model.name = "ship_01";
    model.rotation.y = Math.PI;
    this.ship.add(model);

    this.ship.updateWorldMatrix(true, true);
    this.shipBounds.setFromObject(model, true);
    if (!this.shipBounds.isEmpty()) {
      this.shipBounds.getCenter(this.vectors.modelCenter);
      this.ship.worldToLocal(this.vectors.modelCenter);
      model.position.sub(this.vectors.modelCenter);
    }
  }

  createStars(count, radius, size, opacity) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < count; i += 1) {
      const index = i * 3;
      positions[index] = (Math.random() * 2 - 1) * radius;
      positions[index + 1] = (Math.random() * 2 - 1) * radius;
      positions[index + 2] = (Math.random() * 2 - 1) * radius;

      const hue = 0.58 + Math.random() * 0.08;
      const saturation = 0.78 + Math.random() * 0.2;
      const lightness = 0.08 + Math.random() * 0.58;
      color.setHSL(hue, saturation, lightness);
      colors[index] = color.r;
      colors[index + 1] = color.g;
      colors[index + 2] = color.b;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity,
      sizeAttenuation: true,
      depthWrite: false,
      fog: false
    });

    const points = new THREE.Points(geometry, material);
    points.userData.radius = radius;
    points.userData.count = count;
    this.scene.add(points);
    return points;
  }

  getFollowCameraRadius(distance = this.cameraControl.distance) {
    return Math.hypot(distance, this.config.cameraFollowHeight);
  }

  updateCameraProjection() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.camera.projectionMatrix.elements[9] = this.config.cameraScreenYOffset;
  }

  resetInitialCamera() {
    this.updateShipCenter();
    this.ship.getWorldDirection(this.vectors.forward).normalize();
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion).normalize();
    this.vectors.desiredCameraPosition.copy(this.vectors.shipCenter)
      .addScaledVector(this.vectors.up, this.config.cameraFollowHeight)
      .addScaledVector(this.vectors.forward, -this.cameraControl.distance);
    this.camera.position.copy(this.vectors.desiredCameraPosition);
    this.camera.lookAt(this.vectors.shipCenter);
  }

  resetCameraView() {
    this.updateShipCenter();
    this.stopTouchDpad();
    this.state.cameraFxAmount = 0;
    this.vectors.cameraActionOffset.set(0, 0, 0);
    this.vectors.cameraActionTarget.set(0, 0, 0);
    this.cameraControl.dragging = false;
    this.cameraControl.pointerId = null;
    this.cameraControl.pointers.clear();
    this.cameraControl.pinching = false;
    this.cameraControl.pinchDistance = 0;
    this.cameraControl.followShip = false;
    this.cameraControl.returningToFollow = true;
    this.cameraControl.returnElapsed = 0;
    this.cameraControl.returnStartDistance = Math.max(0.001, this.camera.position.distanceTo(this.vectors.shipCenter));
    this.cameraControl.returnTargetDistance = this.getFollowCameraRadius();
    this.quaternions.cameraReturnStart.copy(this.camera.quaternion).normalize();
    this.ui.setCameraOrbitActive(false);
    this.ui.showToast("cam: follow");
  }

  enterOrbitCameraMode() {
    this.stopTouchDpad();
    const modeChanged = this.cameraControl.followShip || this.cameraControl.returningToFollow;
    if (this.cameraControl.followShip || this.cameraControl.returningToFollow) {
      this.updateShipCenter();
      this.vectors.cameraLocalOffset.copy(this.camera.position).sub(this.vectors.shipCenter);
      if (this.vectors.cameraLocalOffset.lengthSq() > 0.000001) {
        this.cameraControl.orbitDistance = this.vectors.cameraLocalOffset.length();
        this.quaternions.cameraOrbitTarget.copy(this.camera.quaternion).normalize();
      } else {
        this.cameraControl.orbitDistance = this.getFollowCameraRadius();
        this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion).normalize();
        this.lookMatrix.lookAt(this.camera.position, this.vectors.shipCenter, this.vectors.up);
        this.quaternions.cameraOrbitTarget.setFromRotationMatrix(this.lookMatrix).normalize();
      }
    }

    this.cameraControl.followShip = false;
    this.cameraControl.returningToFollow = false;
    this.state.cameraFxAmount = 0;
    this.vectors.cameraActionOffset.set(0, 0, 0);
    this.ui.setCameraOrbitActive(true);
    if (modeChanged) this.ui.showToast("cam: orbit");
  }

  toggleCameraMode() {
    if (this.cameraControl.followShip || this.cameraControl.returningToFollow) {
      this.enterOrbitCameraMode();
      return;
    }

    this.resetCameraView();
  }

  playCameraToggleSfx() {
    this.soundManager.play("camera_toggle", {
      volume: 0.7,
      loop: false,
      destroyOnEnd: true
    });
  }

  requestCameraToggle() {
    if (this.state.phase !== "running") return;
    this.toggleCameraMode();
    this.playCameraToggleSfx();
  }

  updateShipCenter() {
    this.vectors.shipCenter.copy(this.ship.position);
  }

  updateCameraOrbitAxes() {
    this.vectors.cameraOrbitRightAxis.set(1, 0, 0)
      .applyQuaternion(this.quaternions.cameraOrbitTarget)
      .normalize();
    this.vectors.cameraOrbitUpAxis.set(0, 1, 0).applyQuaternion(this.ship.quaternion);
    if (this.vectors.cameraOrbitUpAxis.lengthSq() < 0.000001) {
      this.vectors.cameraOrbitUpAxis.set(0, 1, 0);
    }
    this.vectors.cameraOrbitUpAxis.normalize();
  }

  getCameraOrbitHorizontalSign() {
    this.vectors.cameraUp.set(0, 1, 0)
      .applyQuaternion(this.quaternions.cameraOrbitTarget)
      .normalize();
    return this.vectors.cameraUp.dot(this.vectors.cameraOrbitUpAxis) >= 0 ? 1 : -1;
  }

  applyCameraZoomDelta(delta) {
    if (!this.cameraControl.followShip && !this.cameraControl.returningToFollow) {
      this.cameraControl.orbitDistance = Math.max(
        0.5,
        this.cameraControl.orbitDistance + delta
      );
      this.cameraControl.distance = Math.max(0.5, this.cameraControl.orbitDistance);
      return;
    }

    const nextDistance = THREE.MathUtils.clamp(
      this.cameraControl.distance + delta,
      this.config.cameraMinDistance,
      this.config.cameraMaxDistance
    );
    this.cameraControl.distance = nextDistance;
  }

  getCameraPointerDistance() {
    const pointers = Array.from(this.cameraControl.pointers.values());
    if (pointers.length < 2) return 0;

    return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
  }

  setSpeed(value) {
    const nextSpeed = THREE.MathUtils.clamp(value, this.config.minSpeed, this.config.maxSpeed);
    const changed = nextSpeed !== this.state.desiredSpeed;
    this.state.desiredSpeed = nextSpeed;
    return changed;
  }

  setManualSpeed(value) {
    if (this.state.phase !== "running") return false;
    this.cancelAutopilot();
    return this.setSpeed(value);
  }

  moveToward(value, target, maxDelta) {
    if (Math.abs(target - value) <= maxDelta) return target;
    return value + Math.sign(target - value) * maxDelta;
  }

  setTarget({ x, y, z }) {
    this.navTarget = new THREE.Vector3(x, y, z);
    this.state.autopilotPhase = "stopping";
    this.state.autopilotPeakSpeed = 0;
    this.targetMarker.visible = true;
    this.targetMarker.position.copy(this.navTarget);
    const eta = this.computeAutopilotEta();
    const etaText = eta !== null ? ` (~${Math.round(eta)}s)` : "";
    this.ui.showToast(`navigation engaged${etaText}`);
    this.activeNavLogId = this.worldDataManager.createNavLog({ target: { x, y, z } });
    this.savePlayerShipState({ force: true });
  }

  clearTarget(message, completed = false) {
    if (this.activeNavLogId) {
      const now = Date.now();
      this.worldDataManager.updateNavLog(this.activeNavLogId, completed
        ? { status: "completed", completed_at: now }
        : { status: "cancelled", cancelled_at: now }
      );
      this.activeNavLogId = null;
    }
    this.state.autopilotPhase = null;
    this.state.autopilotPeakSpeed = 0;
    this.navTarget = null;
    this.targetMarker.visible = false;
    if (message) this.ui.showToast(message);
    this.savePlayerShipState({ force: true });
  }

  cancelAutopilot() {
    if (this.state.autopilotPhase === null) return;
    if (this.activeNavLogId) {
      this.worldDataManager.updateNavLog(this.activeNavLogId, { status: "cancelled", cancelled_at: Date.now() });
      this.activeNavLogId = null;
    }
    this.state.autopilotPhase = null;
    this.state.autopilotPeakSpeed = 0;
    this.navTarget = null;
    this.targetMarker.visible = false;
  }

  computeAutopilotPeakSpeed(distance) {
    const { maxSpeed, accelerationRate, decelerationRate } = this.config;
    const accelDist = 0.5 * maxSpeed * maxSpeed / accelerationRate;
    const decelDist = 0.5 * maxSpeed * maxSpeed / decelerationRate;
    if (distance >= accelDist + decelDist) return maxSpeed;
    const peak = Math.sqrt(2 * distance * accelerationRate * decelerationRate / (accelerationRate + decelerationRate));
    return Math.max(0, peak);
  }

  computeAutopilotEta() {
    if (!this.navTarget) return null;
    const distance = this.navTarget.distanceTo(this.ship.position);
    const { maxSpeed, accelerationRate, decelerationRate } = this.config;
    const accelDist = 0.5 * maxSpeed * maxSpeed / accelerationRate;
    const decelDist = 0.5 * maxSpeed * maxSpeed / decelerationRate;
    let flightTime;
    if (distance >= accelDist + decelDist) {
      flightTime = maxSpeed / accelerationRate + (distance - accelDist - decelDist) / maxSpeed + maxSpeed / decelerationRate;
    } else {
      const peakSpeed = Math.sqrt(2 * distance * accelerationRate * decelerationRate / (accelerationRate + decelerationRate));
      flightTime = peakSpeed > 0 ? peakSpeed / accelerationRate + peakSpeed / decelerationRate : 0;
    }
    const stopTime = Math.abs(this.state.speed) / (this.state.speed >= 0 ? decelerationRate : accelerationRate);
    return stopTime + 2 + flightTime;
  }

  computeFlightDuration(effectiveDist, peakSpeed) {
    if (peakSpeed <= 0 || effectiveDist <= 0) return 0;
    const { accelerationRate, decelerationRate } = this.config;
    const accelDist = 0.5 * peakSpeed * peakSpeed / accelerationRate;
    const decelDist = 0.5 * peakSpeed * peakSpeed / decelerationRate;
    const cruiseDist = Math.max(0, effectiveDist - accelDist - decelDist);
    return peakSpeed / accelerationRate + (cruiseDist > 0 ? cruiseDist / peakSpeed : 0) + peakSpeed / decelerationRate;
  }

  computeNavPositionAtTime(navLog, tSec) {
    const from = new THREE.Vector3(navLog.from_position.x, navLog.from_position.y, navLog.from_position.z);
    const target = new THREE.Vector3(navLog.target.x, navLog.target.y, navLog.target.z);
    const dir = target.clone().sub(from);
    const totalDist = dir.length();
    const effectiveDist = Math.max(0, totalDist - this.config.arrivalRadius);
    if (effectiveDist <= 0) return target.clone();
    dir.normalize();

    const { accelerationRate, decelerationRate } = this.config;
    const peak = navLog.peak_speed;
    const accelTime = peak / accelerationRate;
    const accelDist = 0.5 * peak * peak / accelerationRate;
    const decelDist = 0.5 * peak * peak / decelerationRate;
    const cruiseDist = Math.max(0, effectiveDist - accelDist - decelDist);
    const cruiseTime = cruiseDist > 0 ? cruiseDist / peak : 0;

    const t = Math.min(tSec, navLog.flight_duration);
    let distTraveled;
    if (t <= accelTime) {
      distTraveled = 0.5 * accelerationRate * t * t;
    } else if (t <= accelTime + cruiseTime) {
      distTraveled = accelDist + peak * (t - accelTime);
    } else {
      const decelT = t - accelTime - cruiseTime;
      distTraveled = accelDist + cruiseDist + peak * decelT - 0.5 * decelerationRate * decelT * decelT;
    }

    return from.clone().addScaledVector(dir, Math.min(distTraveled, effectiveDist));
  }

  computeNavSpeedAtTime(navLog, tSec) {
    const peak = navLog.peak_speed;
    if (peak <= 0) return 0;
    const { accelerationRate, decelerationRate } = this.config;
    const accelTime = peak / accelerationRate;
    const decelTime = peak / decelerationRate;
    const cruiseTime = Math.max(0, navLog.flight_duration - accelTime - decelTime);
    const t = Math.min(tSec, navLog.flight_duration);
    if (t <= accelTime) return accelerationRate * t;
    if (t <= accelTime + cruiseTime) return peak;
    const decelT = t - accelTime - cruiseTime;
    return Math.max(0, peak - decelerationRate * decelT);
  }

  extrapolateShipMovement(v0, vd, elapsed) {
    const { accelerationRate, decelerationRate } = this.config;
    const diff = vd - v0;
    if (Math.abs(diff) < 0.001) {
      return { distance: v0 * elapsed, finalSpeed: v0 };
    }
    const rate = diff > 0 ? accelerationRate : decelerationRate;
    const tReach = Math.abs(diff) / rate;
    const dir = Math.sign(diff);
    if (elapsed <= tReach) {
      return {
        distance: v0 * elapsed + 0.5 * dir * rate * elapsed * elapsed,
        finalSpeed: v0 + dir * rate * elapsed
      };
    }
    const d1 = v0 * tReach + 0.5 * dir * rate * tReach * tReach;
    return { distance: d1 + vd * (elapsed - tReach), finalSpeed: vd };
  }

  extrapolateShipMovementFixed(v0, capSeconds, elapsed) {
    if (v0 <= 0.001) return { distance: 0, finalSpeed: 0 };
    const { decelerationRate } = this.config;
    const decelTime = v0 / decelerationRate;
    const decelDist = 0.5 * v0 * v0 / decelerationRate;
    if (elapsed <= capSeconds) {
      return { distance: v0 * elapsed, finalSpeed: v0 };
    }
    const decelElapsed = elapsed - capSeconds;
    if (decelElapsed >= decelTime) {
      return { distance: v0 * capSeconds + decelDist, finalSpeed: 0 };
    }
    return {
      distance: v0 * capSeconds + v0 * decelElapsed - 0.5 * decelerationRate * decelElapsed * decelElapsed,
      finalSpeed: v0 - decelerationRate * decelElapsed
    };
  }

  updateThrottleTarget(dt) {
    if (this.state.autopilotPhase !== null) return;

    const accelerating = this.activeActions.has("throttleUp");
    const decelerating = this.activeActions.has("throttleDown");
    if (accelerating === decelerating) return;

    const target = accelerating ? this.config.maxSpeed : this.config.minSpeed;
    const nextSpeed = this.moveToward(
      this.state.desiredSpeed,
      target,
      this.config.throttleAdjustRate * dt
    );
    this.setSpeed(nextSpeed);
  }

  updateSpeed(dt) {
    const previousSpeed = this.state.speed;
    const rate = this.state.desiredSpeed >= this.state.speed
      ? this.config.accelerationRate
      : this.config.decelerationRate;
    this.state.speed = this.moveToward(this.state.speed, this.state.desiredSpeed, rate * dt);
    this.state.speedTrend = this.state.speed - previousSpeed;
  }

  updateManualRotation(dt) {
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    const pitchDirection = CONTROL_SETTINGS.arrowPitchNormal ? 1 : -1;
    const pitchUp = this.getControlActionAmount("pitchUp");
    const pitchDown = this.getControlActionAmount("pitchDown");
    const yawLeft = this.getControlActionAmount("yawLeft");
    const yawRight = this.getControlActionAmount("yawRight");

    if (pitchUp > 0) pitch += this.config.pitchRate * dt * pitchDirection * pitchUp;
    if (pitchDown > 0) pitch -= this.config.pitchRate * dt * pitchDirection * pitchDown;
    if (yawLeft > 0) yaw += this.config.yawRate * dt * yawLeft;
    if (yawRight > 0) yaw -= this.config.yawRate * dt * yawRight;
    if (this.activeActions.has("rollLeft")) roll -= this.config.rollRate * dt;
    if (this.activeActions.has("rollRight")) roll += this.config.rollRate * dt;

    if (pitch === 0 && yaw === 0 && roll === 0) return;

    if (yaw !== 0) {
      this.quaternions.localRotation.setFromAxisAngle(this.axes.y, yaw);
      this.ship.quaternion.multiply(this.quaternions.localRotation);
    }

    if (pitch !== 0) {
      this.quaternions.localRotation.setFromAxisAngle(this.axes.x, pitch);
      this.ship.quaternion.multiply(this.quaternions.localRotation);
    }

    if (roll !== 0) {
      this.quaternions.localRotation.setFromAxisAngle(this.axes.z, roll);
      this.ship.quaternion.multiply(this.quaternions.localRotation);
    }

    this.ship.quaternion.normalize();
  }

  updateAutopilot(dt) {
    if (this.state.autopilotPhase === null || !this.navTarget) return;

    this.vectors.targetVec.copy(this.navTarget).sub(this.ship.position);
    const distance = this.vectors.targetVec.length();

    if (distance <= this.config.arrivalRadius) {
      this.clearTarget("arrived", true);
      this.setSpeed(0);
      return;
    }

    const phase = this.state.autopilotPhase;

    if (phase === "stopping") {
      this.setSpeed(0);
      if (Math.abs(this.state.speed) < 0.5) {
        this.state.autopilotPhase = "aligning";
      }

    } else if (phase === "aligning") {
      this.setSpeed(0);
      const direction = this.vectors.targetVec.normalize();
      this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion);
      this.lookMatrix.lookAt(direction, new THREE.Vector3(0, 0, 0), this.vectors.up);
      this.quaternions.desired.setFromRotationMatrix(this.lookMatrix);
      this.ship.quaternion.slerp(this.quaternions.desired, Math.min(1, this.config.autopilotTurnRate * dt)).normalize();
      this.ship.getWorldDirection(this.vectors.forward);
      if (this.vectors.forward.dot(direction) > 0.99999) {
        const effectiveDist = distance - this.config.arrivalRadius;
        const peakSpeed = this.computeAutopilotPeakSpeed(effectiveDist);
        const flightDuration = this.computeFlightDuration(effectiveDist, peakSpeed);
        this.state.autopilotPeakSpeed = peakSpeed;
        this.state.autopilotPhase = "accelerating";
        if (this.activeNavLogId) {
          this.worldDataManager.updateNavLog(this.activeNavLogId, {
            from_position: { x: this.ship.position.x, y: this.ship.position.y, z: this.ship.position.z },
            flight_start_at: Date.now(),
            peak_speed: peakSpeed,
            flight_duration: flightDuration
          });
        }
      }

    } else if (phase === "accelerating") {
      this.setSpeed(this.state.autopilotPeakSpeed);
      this._autopilotCourseCorrect(dt);
      const decelDist = 0.5 * this.state.speed * this.state.speed / this.config.decelerationRate;
      const remaining = distance - this.config.arrivalRadius;
      if (remaining <= decelDist) {
        this.state.autopilotPhase = "decelerating";
      } else if (this.state.speed >= this.state.autopilotPeakSpeed - 0.1) {
        this.state.autopilotPhase = "cruising";
      }

    } else if (phase === "cruising") {
      this.setSpeed(this.state.autopilotPeakSpeed);
      this._autopilotCourseCorrect(dt);
      const decelDist = 0.5 * this.state.speed * this.state.speed / this.config.decelerationRate;
      if (distance - this.config.arrivalRadius <= decelDist) {
        this.state.autopilotPhase = "decelerating";
      }

    } else if (phase === "decelerating") {
      this.setSpeed(0);
      this._autopilotCourseCorrect(dt);
      if (Math.abs(this.state.speed) < 0.5 && distance > this.config.arrivalRadius * 2) {
        this.state.autopilotPhase = "stopping";
      }
    }
  }

  _autopilotCourseCorrect(dt) {
    const courseDir = this.vectors.targetVec.normalize();
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion);
    this.lookMatrix.lookAt(courseDir, new THREE.Vector3(0, 0, 0), this.vectors.up);
    this.quaternions.desired.setFromRotationMatrix(this.lookMatrix);
    this.ship.quaternion.slerp(this.quaternions.desired, Math.min(1, this.config.autopilotTurnRate * 0.4 * dt)).normalize();
  }

  updateAutopilotRollOnly(dt) {
    let roll = 0;
    if (this.activeActions.has("rollLeft")) roll -= this.config.rollRate * dt;
    if (this.activeActions.has("rollRight")) roll += this.config.rollRate * dt;
    if (roll === 0) return;
    this.quaternions.localRotation.setFromAxisAngle(this.axes.z, roll);
    this.ship.quaternion.multiply(this.quaternions.localRotation);
    this.ship.quaternion.normalize();
  }

  updatePosition(dt) {
    this.ship.getWorldDirection(this.vectors.forward).normalize();
    this.vectors.right.set(1, 0, 0).applyQuaternion(this.ship.quaternion).normalize();
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion).normalize();

    this.vectors.movement.set(0, 0, 0);
    this.vectors.movement.addScaledVector(this.vectors.forward, this.state.speed * dt);

    if (this.state.autopilotPhase === null) {
      if (this.activeActions.has("strafeLeft")) this.vectors.movement.addScaledVector(this.vectors.right, this.config.strafeRate * dt);
      if (this.activeActions.has("strafeRight")) this.vectors.movement.addScaledVector(this.vectors.right, -this.config.strafeRate * dt);
      if (this.activeActions.has("ascend")) this.vectors.movement.addScaledVector(this.vectors.up, this.config.verticalRate * dt);
      if (this.activeActions.has("descend")) this.vectors.movement.addScaledVector(this.vectors.up, -this.config.verticalRate * dt);
    }

    this.ship.position.add(this.vectors.movement);
  }

  updateCamera(dt) {
    this.updateShipCenter();
    this.ship.getWorldDirection(this.vectors.forward).normalize();
    this.vectors.right.set(1, 0, 0).applyQuaternion(this.ship.quaternion).normalize();
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion).normalize();

    if (this.cameraControl.returningToFollow) {
      this.updateReturningCamera(dt);
      return;
    }

    if (this.cameraControl.followShip) {
      this.updateFollowCamera(dt);
      return;
    }

    this.updateOrbitCamera();
  }

  updateReturningCamera(dt) {
    this.state.cameraFxAmount = 0;
    this.vectors.cameraActionOffset.set(0, 0, 0);
    this.vectors.cameraActionTarget.set(0, 0, 0);

    this.cameraControl.returnElapsed += dt;
    const progress = Math.min(1, this.cameraControl.returnElapsed / this.config.cameraReturnDuration);
    const easedProgress = progress * progress * (3 - 2 * progress);

    this.cameraControl.returnTargetDistance = this.getFollowCameraRadius();
    this.vectors.desiredCameraPosition.copy(this.vectors.shipCenter)
      .addScaledVector(this.vectors.up, this.config.cameraFollowHeight)
      .addScaledVector(this.vectors.forward, -this.cameraControl.distance);

    this.vectors.desiredCameraUp.copy(this.vectors.up);
    this.lookMatrix.lookAt(this.vectors.desiredCameraPosition, this.vectors.shipCenter, this.vectors.desiredCameraUp);
    this.quaternions.cameraFollowTarget.setFromRotationMatrix(this.lookMatrix).normalize();
    this.quaternions.cameraReturn.copy(this.quaternions.cameraReturnStart)
      .slerp(this.quaternions.cameraFollowTarget, easedProgress)
      .normalize();

    this.vectors.cameraLocalOffset.set(
      0,
      0,
      THREE.MathUtils.lerp(
        this.cameraControl.returnStartDistance,
        this.cameraControl.returnTargetDistance,
        easedProgress
      )
    ).applyQuaternion(this.quaternions.cameraReturn);

    this.camera.position.copy(this.vectors.shipCenter).add(this.vectors.cameraLocalOffset);
    this.camera.quaternion.copy(this.quaternions.cameraReturn);
    this.vectors.cameraUp.set(0, 1, 0).applyQuaternion(this.quaternions.cameraReturn).normalize();
    this.camera.up.copy(this.vectors.cameraUp);

    if (progress >= 1) {
      this.cameraControl.returningToFollow = false;
      this.cameraControl.followShip = true;
      this.camera.position.copy(this.vectors.desiredCameraPosition);
      this.camera.quaternion.copy(this.quaternions.cameraFollowTarget);
      this.vectors.cameraUp.copy(this.vectors.desiredCameraUp);
      this.camera.up.copy(this.vectors.cameraUp);
    }
  }

  updateFollowCamera(dt) {
    this.vectors.cameraActionTarget.set(0, 0, 0);

    const cameraFxTarget = Math.abs(this.state.speedTrend) < 0.001 ? 0 : Math.sign(this.state.speedTrend);
    const fxRate = cameraFxTarget === 0 ? this.config.cameraFxOutRate : this.config.cameraFxInRate;
    this.state.cameraFxAmount = THREE.MathUtils.damp(this.state.cameraFxAmount, cameraFxTarget, fxRate, dt);
    if (cameraFxTarget === 0 && Math.abs(this.state.cameraFxAmount) < 0.001) {
      this.state.cameraFxAmount = 0;
    }

    if (this.state.autopilotPhase === null) {
      const pitchActionDirection = CONTROL_SETTINGS.arrowPitchNormal ? 1 : -1;
      this.vectors.cameraActionTarget.x += this.config.cameraYawOffset * this.getControlActionAmount("yawLeft");
      this.vectors.cameraActionTarget.x -= this.config.cameraYawOffset * this.getControlActionAmount("yawRight");
      this.vectors.cameraActionTarget.y -= this.config.cameraPitchOffset * pitchActionDirection * this.getControlActionAmount("pitchUp");
      this.vectors.cameraActionTarget.y += this.config.cameraPitchOffset * pitchActionDirection * this.getControlActionAmount("pitchDown");
      if (this.activeActions.has("strafeLeft")) this.vectors.cameraActionTarget.x -= this.config.cameraStrafeOffset;
      if (this.activeActions.has("strafeRight")) this.vectors.cameraActionTarget.x += this.config.cameraStrafeOffset;
      if (this.activeActions.has("ascend")) this.vectors.cameraActionTarget.y -= this.config.cameraVerticalOffset;
      if (this.activeActions.has("descend")) this.vectors.cameraActionTarget.y += this.config.cameraVerticalOffset;

      if (this.activeActions.has("rollLeft")) {
        this.vectors.cameraActionTarget.x += this.config.cameraRollSideOffset;
        this.vectors.cameraActionTarget.y -= this.config.cameraRollDropOffset;
      }
      if (this.activeActions.has("rollRight")) {
        this.vectors.cameraActionTarget.x -= this.config.cameraRollSideOffset;
        this.vectors.cameraActionTarget.y -= this.config.cameraRollDropOffset;
      }
    }

    const actionTargetActive = this.vectors.cameraActionTarget.lengthSq() > 0.0001;
    const actionRate = actionTargetActive ? this.config.cameraActionInRate : this.config.cameraActionOutRate;
    this.vectors.cameraActionOffset.x = THREE.MathUtils.damp(this.vectors.cameraActionOffset.x, this.vectors.cameraActionTarget.x, actionRate, dt);
    this.vectors.cameraActionOffset.y = THREE.MathUtils.damp(this.vectors.cameraActionOffset.y, this.vectors.cameraActionTarget.y, actionRate, dt);
    this.vectors.cameraActionOffset.z = THREE.MathUtils.damp(this.vectors.cameraActionOffset.z, this.vectors.cameraActionTarget.z, actionRate, dt);

    if (!actionTargetActive && this.vectors.cameraActionOffset.lengthSq() < 0.000001) {
      this.vectors.cameraActionOffset.set(0, 0, 0);
    }

    const cameraFxOffset = this.state.cameraFxAmount * this.config.cameraFxDistance;
    const distance = this.cameraControl.distance + cameraFxOffset;
    this.vectors.desiredCameraPosition.copy(this.vectors.shipCenter)
      .addScaledVector(this.vectors.forward, -distance + this.vectors.cameraActionOffset.z)
      .addScaledVector(this.vectors.up, this.config.cameraFollowHeight + this.vectors.cameraActionOffset.y)
      .addScaledVector(this.vectors.right, this.vectors.cameraActionOffset.x);

    this.vectors.desiredCameraUp.copy(this.vectors.up);
    const rollEase = 1 - Math.exp(-this.config.cameraRollRate * dt);
    this.vectors.cameraUp.lerp(this.vectors.desiredCameraUp, rollEase).normalize();

    this.camera.position.copy(this.vectors.desiredCameraPosition);
    this.camera.up.copy(this.vectors.cameraUp);
    this.camera.lookAt(this.vectors.shipCenter);
  }

  updateOrbitCamera() {
    this.state.cameraFxAmount = 0;
    if (this.vectors.cameraActionOffset.lengthSq() > 0) {
      this.vectors.cameraActionOffset.set(0, 0, 0);
    }

    this.quaternions.cameraOrbit.copy(this.quaternions.cameraOrbitTarget);
    this.vectors.cameraLocalOffset.set(
      0,
      this.config.cameraOrbitHeight,
      this.cameraControl.orbitDistance
    ).applyQuaternion(this.quaternions.cameraOrbit);

    this.vectors.desiredCameraPosition.copy(this.vectors.shipCenter).add(this.vectors.cameraLocalOffset);
    this.camera.position.copy(this.vectors.desiredCameraPosition);
    this.camera.quaternion.copy(this.quaternions.cameraOrbit);
    this.vectors.cameraUp.set(0, 1, 0).applyQuaternion(this.quaternions.cameraOrbit).normalize();
    this.camera.up.copy(this.vectors.cameraUp);
  }

  updateStars() {
    for (const layer of this.starLayers) {
      const radius = layer.userData.radius;
      const span = radius * 2;
      const positions = layer.geometry.attributes.position.array;
      let changed = false;

      for (let i = 0; i < positions.length; i += 3) {
        let x = positions[i];
        let y = positions[i + 1];
        let z = positions[i + 2];

        if (x - this.ship.position.x > radius) {
          x -= span;
          changed = true;
        } else if (this.ship.position.x - x > radius) {
          x += span;
          changed = true;
        }

        if (y - this.ship.position.y > radius) {
          y -= span;
          changed = true;
        } else if (this.ship.position.y - y > radius) {
          y += span;
          changed = true;
        }

        if (z - this.ship.position.z > radius) {
          z -= span;
          changed = true;
        } else if (this.ship.position.z - z > radius) {
          z += span;
          changed = true;
        }

        positions[i] = x;
        positions[i + 1] = y;
        positions[i + 2] = z;
      }

      if (changed) layer.geometry.attributes.position.needsUpdate = true;
    }
  }

  updateTargetMarker(dt) {
    if (!this.targetMarker.visible) return;
    this.markerRing.lookAt(this.camera.position);
    this.markerRing.rotation.z += dt * 0.75;
    const pulse = 1 + Math.sin(this.clock.elapsedTime * 4) * 0.12;
    this.markerCore.scale.setScalar(pulse);
  }

  getPlayerDataPosition() {
    const position = this.worldMapManager.toDataVector(this.ship.position);
    return { x: position.x, y: position.y, z: position.z };
  }

  syncWorldRuntimeWithPlayer({ force = false } = {}) {
    if (!this.worldMapManager?.snapshot) return null;
    const dataPosition = this.getPlayerDataPosition();
    this.worldMapManager.updateVisibleChunksFromPosition(dataPosition, { force });
    if (this.state.phase === "running") this.updateLocationBgm(dataPosition);
    return dataPosition;
  }

  getBgmIdForCurrentPlayerPosition() {
    return this.getBgmIdForPosition(this.getPlayerDataPosition());
  }

  getBgmIdForPosition(dataPosition) {
    const sector = this.worldDataManager.getSectorAtPosition(
      dataPosition.x,
      dataPosition.y,
      dataPosition.z
    );
    if (sector) return sector.theme_music_id || "bgm_sector_01";

    const chunk = this.worldDataManager.getChunkRecordAtPosition(dataPosition);
    return chunk ? "bgm_main_01" : "bgm_danger_01";
  }

  updateLocationBgm(dataPosition) {
    const nextBgmId = this.getBgmIdForPosition(dataPosition);
    if (this.currentLocationBgmId === nextBgmId) return;
    this.currentLocationBgmId = nextBgmId;

    void this.soundManager.setBgm(nextBgmId)
      .then((played) => {
        if (!played) {
          this.currentLocationBgmId = null;
          this.ui.showErrorToast("BGM unavailable");
        }
      });
  }

  updateHud() {
    this.ship.getWorldDirection(this.vectors.forward).normalize();
    this.ui.updateHud({
      phase: this.state.phase === "running" ? "Manual" : this.state.phase,
      speed: this.state.speed,
      desiredSpeed: this.state.desiredSpeed,
      position: this.ship.position,
      heading: this.vectors.forward,
      target: this.navTarget,
      autopilot: this.state.autopilotPhase !== null
    });
    this.refreshWorldSummary();
  }

  async refreshWorldSummary({ force = false } = {}) {
    if (!this.worldDataManager.db) return;
    if (!force) {
      const now = performance.now();
      if (this.worldSummaryPending || now - this.worldSummaryLastUpdatedAt < 500) return;
      this.worldSummaryLastUpdatedAt = now;
    }

    this.worldSummaryPending = true;
    const dataPosition = this.syncWorldRuntimeWithPlayer({ force }) || this.getPlayerDataPosition();
    try {
      const summary = await this.worldDataManager.getSummary(dataPosition);
      this.worldMapManager.setCurrentSectorId(summary.currentSector?.sector_id || null);
      this.ui.setWorldSummary(summary);
    } finally {
      this.worldSummaryPending = false;
    }
  }

  update(dt) {
    this.updateAutopilot(dt);
    this.updateThrottleTarget(dt);
    this.updateSpeed(dt);
    if (this.state.autopilotPhase === null) {
      this.updateManualRotation(dt);
    } else if (this.state.autopilotPhase !== "aligning" && this.state.autopilotPhase !== "stopping") {
      this.updateAutopilotRollOnly(dt);
    }
    this.updatePosition(dt);
    this.syncWorldRuntimeWithPlayer();
    this.updateCamera(dt);
    this.updateStars();
    this.worldMapManager.update(dt);
    this.savePlayerShipState();
  }

  async savePlayerShipState({ force = false } = {}) {
    if (!this.worldDataManager.db || this.playerShipSavePending || this.worldDataResetting) return;

    const now = performance.now();
    if (!force && now - this.playerShipSaveLastUpdatedAt < this.playerShipSaveInterval) return;
    this.playerShipSaveLastUpdatedAt = now;
    this.playerShipSavePending = true;

    try {
      const position = this.worldMapManager.toDataVector(this.ship.position);
      await this.worldDataManager.savePlayerShipState({
        ship_id: "PLAYER-SHIP-001",
        player_id: "default",
        position: { x: position.x, y: position.y, z: position.z },
        rotation: {
          x: this.ship.quaternion.x,
          y: this.ship.quaternion.y,
          z: this.ship.quaternion.z,
          w: this.ship.quaternion.w
        },
        speed: this.state.speed,
        desiredSpeed: this.state.desiredSpeed
      });
    } catch {
      this.ui.showErrorToast("player ship state save failed");
    } finally {
      this.playerShipSavePending = false;
    }
  }

  async regenerateWorld() {
    if (!this.worldDataManager.db) {
      this.ui.showErrorToast("world database unavailable");
      return;
    }

    try {
      const snapshot = await this.worldDataManager.createNewWorld();
      this.worldMapManager.renderWorld(snapshot);
      await this.restorePlayerShipState();
      this.syncWorldRuntimeWithPlayer({ force: true });
      await this.refreshWorldSummary({ force: true });
      this.ui.showToast("world regenerated");
    } catch (error) {
      this.ui.showErrorToast(error instanceof Error ? error.message : "world regenerate failed");
    }
  }

  async clearAllData() {
    try {
      this.worldDataResetting = true;
      this.activeActions.clear();
      this.stopTouchDpad();
      this.state.autopilotPhase = null;
      this.state.autopilotPeakSpeed = 0;
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      this.state.speedTrend = 0;
      this.state.cameraFxAmount = 0;
      this.navTarget = null;
      this.activeNavLogId = null;
      this.targetMarker.visible = false;
      await this.waitForPendingPlayerShipSave();
      if (this.worldDataManager.db) {
        this.worldDataManager.db.close();
        this.worldDataManager.db = null;
      }
      this.reloadForDataReset();
    } catch (error) {
      this.ui.showErrorToast(error instanceof Error ? error.message : "data clear failed");
      this.worldDataResetting = false;
    }
  }

  async handleDataResetRequest() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("reset")) return;

    try {
      await this.clearRuntimeCaches();
      await this.deleteGameDatabases();
    } finally {
      url.searchParams.delete("reset");
      window.history.replaceState(null, "", url.href);
    }
  }

  async deleteGameDatabases() {
    if (this.worldDataManager.db) {
      this.worldDataManager.db.close();
      this.worldDataManager.db = null;
    }

    if (typeof this.worldDataManager.deleteDatabase === "function") {
      await this.worldDataManager.deleteDatabase();
      return;
    }

    const prefix = "void-zero-";
    const names = new Set([this.worldDataManager.config.dbName]);

    if (typeof indexedDB.databases === "function") {
      try {
        const databases = await indexedDB.databases();
        databases
          .map((database) => database.name)
          .filter((name) => typeof name === "string" && name.startsWith(prefix))
          .forEach((name) => names.add(name));
      } catch {
        // Fall back to the known database name.
      }
    }

    await Promise.all(Array.from(names).map((name) => this.deleteIndexedDbByName(name)));
  }

  deleteIndexedDbByName(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`IndexedDB delete failed: ${name}`));
      request.onblocked = () => reject(new Error(`IndexedDB delete blocked: ${name}. Close other tabs and try again.`));
    });
  }

  async clearRuntimeCaches() {
    this.clearStorageNamespace(localStorage);
    this.clearStorageNamespace(sessionStorage);

    if ("caches" in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      } catch {
        // CacheStorage is best-effort and may be unavailable in local contexts.
      }
    }
  }

  async waitForPendingPlayerShipSave() {
    const startedAt = performance.now();
    while (this.playerShipSavePending && performance.now() - startedAt < 1500) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }

  clearStorageNamespace(storage) {
    const prefix = "void-zero-";
    try {
      Object.keys(storage)
        .filter((key) => key.startsWith(prefix))
        .forEach((key) => storage.removeItem(key));
    } catch {
      // Ignore storage cleanup failures; the database reset is the critical path.
    }
  }

  reloadForDataReset() {
    const url = new URL(window.location.href);
    url.searchParams.set("reset", String(Date.now()));
    window.location.replace(url.href);
  }

  async reloadWorldData() {
    if (!this.worldDataManager.db) {
      this.ui.showErrorToast("world database unavailable");
      return;
    }

    try {
      const snapshot = await this.worldDataManager.getWorldSnapshot();
      this.worldMapManager.renderWorld(snapshot);
      await this.restorePlayerShipState();
      this.syncWorldRuntimeWithPlayer({ force: true });
      await this.refreshWorldSummary({ force: true });
      this.ui.showToast("world reloaded");
    } catch (error) {
      this.ui.showErrorToast(error instanceof Error ? error.message : "world reload failed");
    }
  }

  setChunkBoundsMode(mode) {
    const nextMode = ["all", "sector", "off"].includes(mode) ? mode : "all";
    this.worldViewSettings.chunkBoundsMode = nextMode;
    this.worldMapManager.setChunkBoundsMode(nextMode);
    this.ui.setChunkBoundsMode(nextMode);
    void this.saveWorldViewSettings();
  }

  getWorldObjectList() {
    const snapshot = this.worldMapManager?.snapshot || this.worldDataManager.snapshot;
    if (!snapshot) return { buildings: [], resources: [] };

    const sectorsById = new Map(snapshot.sectors.map((sector) => [sector.sector_id, sector]));
    const playerPosition = this.getPlayerDataPosition();
    const toListItem = (object, kind) => {
      const id = object.building_instance_id || object.resource_instance_id;
      const type = object.building_id || object.resource_id || object.type || "unknown";
      const definition = kind === "building"
        ? BUILDING_DEFINITIONS[object.building_id]
        : RESOURCE_DEFINITIONS[object.resource_id || object.type];
      const producedItem = kind === "resource"
        ? ITEM_DEFINITIONS[definition?.produces_item_id]
        : null;
      const labelDefinition = kind === "building" ? definition : producedItem || definition;
      const label = this.i18n.resolveDefinitionText(labelDefinition, "name", type);
      const position = { ...object.position };
      const relativePosition = object.chunk_center_relative_position
        ? { ...object.chunk_center_relative_position }
        : null;
      const chunkCenterPosition = object.chunk_center_position
        ? { ...object.chunk_center_position }
        : null;
      const sectorDefinition = sectorsById.get(object.sector_id);
      const target = this.worldMapManager.toRenderVector(position);
      const distance = this.getDataDistance(playerPosition, position);
      return {
        id,
        kind,
        type,
        name: this.formatObjectName(label),
        typeLabel: this.formatObjectName(type),
        currentAmount: object.current_amount ?? null,
        totalCapacity: object.total_capacity ?? null,
        amountLabel: object.current_amount != null && object.total_capacity != null
          ? `${Math.round(object.current_amount)} / ${Math.round(object.total_capacity)}`
          : "unavailable",
        statusLabel: object.status || "unknown",
        hpLabel: object.hp != null ? String(object.hp) : "unavailable",
        sectorName: sectorDefinition
          ? this.i18n.resolveDefinitionText(sectorDefinition, "name", sectorDefinition.name || sectorDefinition.sector_id)
          : object.sector_id || "UNKNOWN",
        chunkId: object.chunk_id || "UNKNOWN",
        position,
        relativePosition,
        chunkCenterPosition,
        target: { x: target.x, y: target.y, z: target.z },
        distance,
        distanceText: this.formatDistance(distance)
      };
    };

    return {
      buildings: snapshot.buildings.map((building) => toListItem(building, "building")),
      resources: snapshot.resourceNodes.map((resourceNode) => toListItem(resourceNode, "resource"))
    };
  }

  navigateToWorldObject(object) {
    if (!object?.target) return;
    this.setTarget(object.target);
  }

  getDataDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  formatDistance(distance) {
    if (!Number.isFinite(distance)) return "unknown";
    if (distance >= 1000000) return `${(distance / 1000000).toFixed(2)}M`;
    if (distance >= 1000) return `${(distance / 1000).toFixed(1)}K`;
    return `${Math.round(distance)}`;
  }

  formatObjectName(type, id = "") {
    const label = String(type || "unknown")
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([0-9])/gi, "$1 $2")
      .replace(/\b\w/g, (char) => char.toUpperCase());
    return id ? `${label} / ${id}` : label;
  }

  animate() {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state.phase === "running") {
      this.update(dt);
    }

    this.updateTargetMarker(dt);
    this.updateHud();
    this.updateTargetingOverlay();
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  onPointerDown(event) {
    if (this.state.phase !== "running") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    this.startSelectionPointer(event, this.cameraControl.pointers.size === 0);
    this.cameraControl.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.renderer.domElement.setPointerCapture(event.pointerId);

    if (event.pointerType === "touch" && this.isFollowCameraMode()) {
      if (this.cameraControl.pointers.size >= 2) {
        this.cancelSelectionPointer();
        this.stopTouchDpad();
        this.cameraControl.dragging = false;
        this.cameraControl.pointerId = null;
        this.cameraControl.pinching = true;
        this.cameraControl.pinchDistance = this.getCameraPointerDistance();
        return;
      }

      this.startTouchDpad(event);
      return;
    }

    if (this.cameraControl.pointers.size >= 2) {
      this.cancelSelectionPointer();
      this.enterOrbitCameraMode();
      this.cameraControl.dragging = false;
      this.cameraControl.pointerId = null;
      this.cameraControl.pinching = true;
      this.cameraControl.pinchDistance = this.getCameraPointerDistance();
      return;
    }

    this.enterOrbitCameraMode();
    this.cameraControl.dragging = true;
    this.cameraControl.pointerId = event.pointerId;
    this.cameraControl.lastX = event.clientX;
    this.cameraControl.lastY = event.clientY;
  }

  onPointerMove(event) {
    this.updateSelectionPointer(event);

    if (this.cameraControl.pointers.has(event.pointerId)) {
      this.cameraControl.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (this.cameraControl.pinching) {
      if (this.cameraControl.pointers.size < 2) return;
      event.preventDefault();

      const nextDistance = this.getCameraPointerDistance();
      if (nextDistance <= 0 || this.cameraControl.pinchDistance <= 0) {
        this.cameraControl.pinchDistance = nextDistance;
        return;
      }

      const pinchDelta = (this.cameraControl.pinchDistance - nextDistance) * this.config.cameraZoomSensitivity;
      this.applyCameraZoomDelta(pinchDelta);
      this.cameraControl.pinchDistance = nextDistance;
      return;
    }

    if (this.cameraControl.touchDpadPointerId === event.pointerId) {
      event.preventDefault();
      this.updateTouchDpad(event);
      return;
    }

    if (!this.cameraControl.dragging || this.cameraControl.pointerId !== event.pointerId) return;
    event.preventDefault();

    const dx = event.clientX - this.cameraControl.lastX;
    const dy = event.clientY - this.cameraControl.lastY;
    this.cameraControl.lastX = event.clientX;
    this.cameraControl.lastY = event.clientY;

    if (dx === 0 && dy === 0) return;

    this.updateCameraOrbitAxes();
    const horizontalSign = this.getCameraOrbitHorizontalSign();
    this.quaternions.cameraOrbitYawDelta.setFromAxisAngle(
      this.vectors.cameraOrbitUpAxis,
      -dx * this.config.cameraOrbitSensitivity * horizontalSign
    );
    this.quaternions.cameraOrbitTarget.premultiply(this.quaternions.cameraOrbitYawDelta).normalize();

    this.vectors.cameraOrbitRightAxis.set(1, 0, 0)
      .applyQuaternion(this.quaternions.cameraOrbitTarget)
      .normalize();
    this.quaternions.cameraOrbitPitchDelta.setFromAxisAngle(
      this.vectors.cameraOrbitRightAxis,
      -dy * this.config.cameraOrbitSensitivity
    );
    this.quaternions.cameraOrbitTarget.premultiply(this.quaternions.cameraOrbitPitchDelta).normalize();
  }

  onPointerUp(event) {
    const shouldSelect = this.shouldSelectFromPointer(event);
    this.stopCameraDrag(event);
    if (shouldSelect) this.selectWorldObjectFromPointer(event.clientX, event.clientY);
    this.resetSelectionPointer(event.pointerId);
  }

  startSelectionPointer(event, maySelect) {
    this.selectionPointer.pointerId = event.pointerId;
    this.selectionPointer.startX = event.clientX;
    this.selectionPointer.startY = event.clientY;
    this.selectionPointer.maySelect = maySelect;
    this.selectionPointer.moved = false;
  }

  updateSelectionPointer(event) {
    if (this.selectionPointer.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - this.selectionPointer.startX,
      event.clientY - this.selectionPointer.startY
    );
    if (distance > 8) this.selectionPointer.moved = true;
  }

  cancelSelectionPointer() {
    this.selectionPointer.maySelect = false;
    this.selectionPointer.moved = true;
  }

  shouldSelectFromPointer(event) {
    if (this.state.phase !== "running") return false;
    if (this.selectionPointer.pointerId !== event.pointerId) return false;
    if (!this.selectionPointer.maySelect || this.selectionPointer.moved) return false;
    if (this.cameraControl.pinching || this.cameraControl.pointers.size > 1) return false;
    return true;
  }

  resetSelectionPointer(pointerId) {
    if (this.selectionPointer.pointerId !== pointerId) return;
    this.selectionPointer.pointerId = null;
    this.selectionPointer.startX = 0;
    this.selectionPointer.startY = 0;
    this.selectionPointer.maySelect = false;
    this.selectionPointer.moved = false;
  }

  stopCameraDrag(event) {
    this.cameraControl.pointers.delete(event.pointerId);
    if (this.cameraControl.pointers.size < 2) {
      this.cameraControl.pinching = false;
      this.cameraControl.pinchDistance = 0;
    }

    if (this.cameraControl.pointerId === event.pointerId) {
      this.cameraControl.dragging = false;
      this.cameraControl.pointerId = null;
    }

    if (this.cameraControl.touchDpadPointerId === event.pointerId) {
      this.stopTouchDpad();
    }

    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }

    if (event.type === "pointercancel") this.resetSelectionPointer(event.pointerId);
  }

  selectWorldObjectFromPointer(clientX, clientY) {
    const objectsGroup = this.worldMapManager?.objectsGroup;
    if (!objectsGroup || objectsGroup.children.length === 0) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const hit = this.raycaster.intersectObjects(objectsGroup.children, true)
      .map((intersection) => this.getWorldObjectRoot(intersection.object))
      .find(Boolean) || this.getWorldObjectFromScreenPoint(clientX, clientY);
    if (!hit) return;

    const selection = this.createWorldSelection(hit);
    if (!selection) return;

    this.selectedWorldObject = selection;
    this.ui.setSelectedWorldObjectName(selection.name, selection);
    this.updateTargetingOverlay();
  }

  selectWorldObjectFromListItem(object) {
    if (!object?.id || (object.kind !== "resource" && object.kind !== "building")) return;

    const visibleObject = this.findVisibleWorldObject(object.kind, object.id);
    const selection = visibleObject
      ? this.createWorldSelection(visibleObject)
      : this.createWorldSelectionFromListItem(object);
    if (!selection) return;

    this.selectedWorldObject = selection;
    this.ui.setSelectedWorldObjectName(selection.name, selection);
    this.updateTargetingOverlay();
  }

  getWorldObjectRoot(object) {
    const objectsGroup = this.worldMapManager?.objectsGroup;
    let cursor = object;
    while (cursor && cursor !== objectsGroup) {
      if (cursor.userData?.kind === "resource" || cursor.userData?.kind === "building") return cursor;
      cursor = cursor.parent;
    }
    return null;
  }

  getWorldObjectFromScreenPoint(clientX, clientY) {
    const objectsGroup = this.worldMapManager?.objectsGroup;
    if (!objectsGroup) return null;

    const hits = [];
    for (const object of objectsGroup.children) {
      if (object.userData?.kind !== "resource" && object.userData?.kind !== "building") continue;
      const bounds = this.getObjectSelectionBounds(object);
      const projection = this.projectWorldSelectionCenter(bounds.center);
      if (!projection) continue;

      const frame = this.targetingOverlay.calculateSquareFrame({
        screenCenter: projection.screenCenter,
        depth: projection.depth,
        focal: projection.focal,
        radius: bounds.radius,
        forceMinimumSide: false
      });
      if (!frame) continue;

      const pad = 8;
      const inside = clientX >= frame.minX - pad &&
        clientX <= frame.maxX + pad &&
        clientY >= frame.minY - pad &&
        clientY <= frame.maxY + pad;
      if (!inside) continue;

      hits.push({
        object,
        distance: Math.hypot(clientX - frame.cx, clientY - frame.cy),
        depth: projection.depth
      });
    }

    hits.sort((a, b) => a.distance - b.distance || a.depth - b.depth);
    return hits[0]?.object || null;
  }

  createWorldSelection(object) {
    const data = object.userData || {};
    const kind = data.kind;
    const id = data.id;
    if (!id || (kind !== "resource" && kind !== "building")) return null;

    const type = kind === "building"
      ? data.building_id || data.type || "unknown"
      : data.type || data.resource_id || "unknown";
    const bounds = this.getObjectSelectionBounds(object);

    return {
      id,
      kind,
      type,
      name: this.getWorldSelectionName(kind, type),
      iconUrl: this.getWorldSelectionIconUrl(kind, type),
      renderCenter: bounds.center.clone(),
      savedCenter: bounds.center.clone(),
      savedRadius: bounds.radius,
      startedAt: performance.now(),
      wasVisible: true,
      frameTransitionUntil: 0
    };
  }

  createWorldSelectionFromListItem(object) {
    const type = object.type || "unknown";
    const target = object.target || null;
    if (!target) return null;

    const center = new THREE.Vector3(
      Number(target.x) || 0,
      Number(target.y) || 0,
      Number(target.z) || 0
    );
    const name = object.kind === "building"
      ? object.name || this.getWorldSelectionName(object.kind, type)
      : object.name || object.typeLabel || this.getWorldSelectionName(object.kind, type);

    return {
      id: object.id,
      kind: object.kind,
      type,
      name,
      iconUrl: this.getWorldSelectionIconUrl(object.kind, type),
      renderCenter: center.clone(),
      savedCenter: center.clone(),
      savedRadius: this.getWorldSelectionFallbackRadius(object.kind, type),
      startedAt: performance.now(),
      wasVisible: false,
      frameTransitionUntil: performance.now() + 360
    };
  }

  getObjectSelectionBounds(object) {
    const cached = object.userData?.selectionLocalBounds;
    if (cached) {
      object.getWorldPosition(this.selectionBoundsCenter);
      object.getWorldScale(this.selectionWorldScale);
      return {
        center: this.selectionBoundsCenter,
        radius: Math.max(cached.radius * maxAbsComponent(this.selectionWorldScale), 0.001)
      };
    }

    object.updateWorldMatrix(true, true);
    this.selectionRootInverse.copy(object.matrixWorld).invert();
    this.selectionBounds.makeEmpty();

    object.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      if (!child.geometry.boundingBox) return;

      this.selectionChildMatrix.multiplyMatrices(this.selectionRootInverse, child.matrixWorld);
      this.selectionChildBounds.copy(child.geometry.boundingBox).applyMatrix4(this.selectionChildMatrix);
      this.selectionBounds.union(this.selectionChildBounds);
    });

    if (!this.selectionBounds.isEmpty()) {
      this.selectionBounds.getSize(this.selectionBoundsSize);
      const localRadius = Math.max(this.selectionBoundsSize.length() / 2, 0.001);
      object.userData.selectionLocalBounds = {
        radius: localRadius
      };

      object.getWorldPosition(this.selectionBoundsCenter);
      object.getWorldScale(this.selectionWorldScale);
      return {
        center: this.selectionBoundsCenter,
        radius: Math.max(localRadius * maxAbsComponent(this.selectionWorldScale), 0.001)
      };
    }

    object.getWorldPosition(this.selectionBoundsCenter);
    return {
      center: this.selectionBoundsCenter,
      radius: this.getWorldSelectionFallbackRadius(object.userData?.kind, object.userData?.building_id || object.userData?.type)
    };
  }

  getWorldSelectionName(kind, type) {
    if (kind === "building") {
      const definition = BUILDING_DEFINITIONS[type];
      return this.i18n.resolveDefinitionText(definition, "name", this.formatObjectName(type));
    }

    const definition = RESOURCE_DEFINITIONS[type];
    const producedItem = ITEM_DEFINITIONS[definition?.produces_item_id];
    return this.i18n.resolveDefinitionText(producedItem || definition, "name", this.formatObjectName(type));
  }

  getWorldSelectionIconUrl(kind, type) {
    if (kind !== "building") return new URL("../rss/svg/ind_loot.svg", import.meta.url).href;

    const size = BUILDING_DEFINITIONS[type]?.size;
    if (size === "EX") return new URL("../rss/svg/ind_ex.svg", import.meta.url).href;
    if (size === "L") return new URL("../rss/svg/ind_large.svg", import.meta.url).href;
    if (size === "S") return new URL("../rss/svg/ind_small.svg", import.meta.url).href;
    return new URL("../rss/svg/ind_medium.svg", import.meta.url).href;
  }

  getWorldSelectionFallbackRadius(kind, type) {
    const definition = kind === "building"
      ? BUILDING_DEFINITIONS[type]
      : RESOURCE_DEFINITIONS[type];
    const visualScale = Number(definition?.visual?.scale) || 8;
    return Math.max(0.001, visualScale * 1.6);
  }

  clearWorldSelection() {
    this.selectedWorldObject = null;
    this.ui.clearSelectedWorldObjectName();
    this.targetingOverlay.render(null);
  }

  updateTargetingOverlay() {
    if (!this.selectedWorldObject) {
      this.targetingOverlay.render(null);
      return;
    }

    const target = this.createTargetingOverlayTarget();
    this.targetingOverlay.render(target, performance.now());
  }

  createTargetingOverlayTarget() {
    const selection = this.selectedWorldObject;
    const visibleObject = this.findVisibleWorldObject(selection.kind, selection.id);
    const visible = !!visibleObject;
    let center = selection.savedCenter;
    let radius = selection.savedRadius;
    let forceMinimumSide = !visible;

    if (visibleObject) {
      const bounds = this.getObjectSelectionBounds(visibleObject);
      center = bounds.center.clone();
      radius = bounds.radius;
      selection.savedCenter.copy(center);
      selection.savedRadius = radius;
      if (!selection.wasVisible) {
        selection.frameTransitionUntil = performance.now() + 360;
      }
    }

    selection.wasVisible = visible;
    const projection = this.projectWorldSelectionCenter(center);
    if (!projection) return null;

    return {
      key: `${selection.kind}:${selection.id}`,
      screenCenter: projection.screenCenter,
      depth: projection.depth,
      focal: projection.focal,
      radius,
      forceMinimumSide,
      startedAt: selection.startedAt,
      iconUrl: selection.iconUrl,
      smoothFrame: performance.now() < selection.frameTransitionUntil
    };
  }

  findVisibleWorldObject(kind, id) {
    const objectsGroup = this.worldMapManager?.objectsGroup;
    if (!objectsGroup) return null;
    return objectsGroup.children.find((child) => child.userData?.kind === kind && child.userData?.id === id) || null;
  }

  projectWorldSelectionCenter(center) {
    this.camera.getWorldDirection(this.selectionCameraDirection);
    const depth = this.selectionScratch.copy(center).sub(this.camera.position).dot(this.selectionCameraDirection);
    if (depth <= this.camera.near) return null;

    this.selectionScratchB.copy(center).project(this.camera);
    if (!Number.isFinite(this.selectionScratchB.x) || !Number.isFinite(this.selectionScratchB.y)) return null;

    const height = Math.max(1, window.innerHeight);
    return {
      screenCenter: {
        x: (this.selectionScratchB.x * 0.5 + 0.5) * window.innerWidth,
        y: (-this.selectionScratchB.y * 0.5 + 0.5) * window.innerHeight
      },
      depth,
      focal: height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))
    };
  }

  isFollowCameraMode() {
    return this.cameraControl.followShip || this.cameraControl.returningToFollow;
  }

  startTouchDpad(event) {
    this.cameraControl.touchDpadPointerId = event.pointerId;
    this.cameraControl.touchDpadStartX = event.clientX;
    this.cameraControl.touchDpadStartY = event.clientY;
    this.setTouchDpadState([], 0, 0);
    this.ui.showTouchDpad({
      x: event.clientX,
      y: event.clientY,
      maxDistance: this.cameraControl.touchDpadMaxDistance
    });
  }

  updateTouchDpad(event) {
    const dx = event.clientX - this.cameraControl.touchDpadStartX;
    const dy = event.clientY - this.cameraControl.touchDpadStartY;
    const axisX = this.getTouchDpadAxisValue(dx);
    const axisY = this.getTouchDpadAxisValue(dy);
    const actions = [];

    if (axisY < 0) actions.push("pitchUp");
    if (axisY > 0) actions.push("pitchDown");
    if (axisX < 0) actions.push("yawLeft");
    if (axisX > 0) actions.push("yawRight");

    this.setTouchDpadState(actions, axisX, axisY);
    this.ui.updateTouchDpad(this.getTouchDpadVisualOffset(dx, dy));
  }

  getTouchDpadVisualOffset(dx, dy) {
    const maxDistance = this.cameraControl.touchDpadMaxDistance;
    const distance = Math.hypot(dx, dy);
    if (distance <= maxDistance || distance <= 0) {
      return { knobX: dx, knobY: dy };
    }

    const scale = maxDistance / distance;
    return { knobX: dx * scale, knobY: dy * scale };
  }

  getTouchDpadAxisValue(delta) {
    const deadzone = this.cameraControl.touchDpadDeadzone;
    const maxDistance = Math.max(deadzone + 1, this.cameraControl.touchDpadMaxDistance);
    const distance = Math.abs(delta);
    if (distance <= deadzone) return 0;

    return Math.sign(delta) * Math.min(1, (distance - deadzone) / (maxDistance - deadzone));
  }

  setTouchDpadState(actions, axisX = 0, axisY = 0) {
    const nextActions = new Set(actions);
    const previousActions = this.cameraControl.touchDpadActions;

    nextActions.forEach((action) => {
      const isNewAction = !previousActions.has(action);
      if (isNewAction && this.state.autopilotPhase !== null && this.shouldAutopilotCancelOnKey(action)) {
        this.clearTarget("autopilot cancelled");
      }
    });

    this.cameraControl.touchDpadActions = nextActions;
    this.cameraControl.touchDpadAxisX = axisX;
    this.cameraControl.touchDpadAxisY = axisY;
  }

  stopTouchDpad() {
    this.cameraControl.touchDpadActions.clear();
    this.cameraControl.touchDpadAxisX = 0;
    this.cameraControl.touchDpadAxisY = 0;
    this.cameraControl.touchDpadPointerId = null;
    this.ui.hideTouchDpad();
  }

  getControlActionAmount(action) {
    if (this.activeActions.has(action)) return 1;

    const x = this.cameraControl.touchDpadAxisX;
    const y = this.cameraControl.touchDpadAxisY;
    if (action === "pitchUp") return Math.max(0, -y);
    if (action === "pitchDown") return Math.max(0, y);
    if (action === "yawLeft") return Math.max(0, -x);
    if (action === "yawRight") return Math.max(0, x);
    return 0;
  }

  onWheel(event) {
    if (this.state.phase !== "running") return;
    event.preventDefault();
    this.applyCameraZoomDelta(event.deltaY * this.config.cameraZoomSensitivity);
  }

  shouldAutopilotCancelOnKey(action) {
    if (action === "cameraToggle") return false;
    const isFlightKey = action === "throttleUp" || action === "throttleDown" ||
      action === "maxSpeed" || action === "stopSpeed" ||
      this.isManualControlAction(action);
    if (!isFlightKey) return false;
    const phase = this.state.autopilotPhase;
    if (phase === "stopping" || phase === "aligning") return true;
    return action !== "rollLeft" && action !== "rollRight";
  }

  onKeyDown(event) {
    if (event.target instanceof HTMLInputElement) return;
    if (this.state.phase !== "running") return;

    const action = this.getActionForCode(event.code);
    if (!action) return;

    this.activeActions.add(action);

    if (this.state.autopilotPhase !== null && this.shouldAutopilotCancelOnKey(action)) {
      this.clearTarget("autopilot cancelled");
    }

    if (action === "throttleUp" || action === "throttleDown") {
      event.preventDefault();
    } else if (action === "maxSpeed") {
      event.preventDefault();
      if (this.state.autopilotPhase === null) this.setSpeed(this.config.maxSpeed);
    } else if (action === "stopSpeed") {
      event.preventDefault();
      if (this.state.autopilotPhase === null) this.setSpeed(0);
    } else if (action === "cameraToggle") {
      event.preventDefault();
      if (!event.repeat) {
        this.requestCameraToggle();
      }
    } else if (this.isManualControlAction(action)) {
      event.preventDefault();
    }
  }

  onKeyUp(event) {
    const action = this.getActionForCode(event.code);
    if (!action) return;

    this.activeActions.delete(action);
    if (
      action === "throttleUp" ||
      action === "throttleDown" ||
      action === "maxSpeed" ||
      action === "stopSpeed"
    ) {
      event.preventDefault();
    }
  }

  isManualControlAction(action) {
    return action === "pitchUp" ||
      action === "pitchDown" ||
      action === "yawLeft" ||
      action === "yawRight" ||
      action === "rollLeft" ||
      action === "rollRight" ||
      action === "ascend" ||
      action === "descend" ||
      action === "strafeLeft" ||
      action === "strafeRight";
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.updateCameraProjection();
    this.targetingOverlay.resize();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.boundEvents) {
      this.renderer.domElement.removeEventListener("pointerdown", this.boundEvents.pointerdown);
      this.renderer.domElement.removeEventListener("pointermove", this.boundEvents.pointermove);
      this.renderer.domElement.removeEventListener("pointerup", this.boundEvents.pointerup);
      this.renderer.domElement.removeEventListener("pointercancel", this.boundEvents.pointercancel);
      this.renderer.domElement.removeEventListener("wheel", this.boundEvents.wheel);
      window.removeEventListener("keydown", this.boundEvents.keydown);
      window.removeEventListener("keyup", this.boundEvents.keyup);
      window.removeEventListener("resize", this.boundEvents.resize);
      this.boundEvents = null;
    }

    this.ui.dispose();
    this.targetingOverlay.dispose();
    this.worldMapManager.dispose();
    this.soundManager.dispose();
    this.resourceManager.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function maxAbsComponent(vector) {
  return Math.max(Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z));
}
