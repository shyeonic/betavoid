import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { BloomRenderPipeline } from "./BloomRenderPipeline.js";
import { HyperdriveWarpLayer } from "./HyperdriveWarpLayer.js";
import { CONFIG, CONTROL_SETTINGS, DEFAULT_KEY_BINDINGS, KEY_BINDING_GROUPS } from "./config.js";
import { ResourceManager } from "./ResourceManager.js";
import { ShipVisualManager } from "./ShipVisualManager.js";
import { SoundManager } from "./SoundManager.js";
import { TargetingOverlay } from "./TargetingOverlay.js";
import { UIManager } from "./UIManager.js";
import { WorldDataManager } from "./WorldDataManager.js";
import { WorldMapManager } from "./WorldMapManager.js";
import {
  BLOOM_QUALITY_MODES,
  ENVIRONMENT_SETTINGS_KEY,
  ENVIRONMENT_MODES,
  DEFAULT_PERFORMANCE_SETTINGS,
  SPACE_ENVIRONMENT_PRESETS,
  getBloomResolutionScale,
  normalizeEnvironmentMode,
  normalizeBloomQualityMode,
  normalizeRenderResolutionScale,
  normalizePerformanceSettings
} from "./definitions/environmentDefinitions.js";
import { DEFAULT_SHIP_ID, SHIP_DEFINITIONS, getShipDefinition, getShipSpecs } from "./definitions/shipDefinitions.js";
import { BUILDING_DEFINITIONS, ITEM_DEFINITIONS, RESOURCE_DEFINITIONS, WORLD_CONFIG } from "./worldDefinitions.js";
import { createI18n } from "./i18n/i18n.js";

const LIGHTING_SETTINGS = {
  ship: {
    reflectionIntensity: 0.9,
    roughnessOffset: 0.02,
    fillLight: { color: 0xe8f7ff, intensity: 2, distance: 44, position: [0, 2.2, -2] },
    rimLight: { color: 0x8fdcff, intensity: 2, distance: 48, position: [-3.5, 1.2, 3.5] }
  }
};

const RENDERER_TONE_MAPPINGS = {
  acesFilmic: THREE.ACESFilmicToneMapping,
  neutral: THREE.NeutralToneMapping ?? THREE.LinearToneMapping,
  linear: THREE.LinearToneMapping,
  none: THREE.NoToneMapping
};

export class GameManager {
  constructor({ root }) {
    this.root = root;
    this.config = CONFIG;
    this.keyBindingStorageKey = "void-zero-key-bindings";
    this.keyBindings = this.loadKeyBindings();
    this.environmentMode = ENVIRONMENT_MODES.light;
    this.performanceSettings = { ...DEFAULT_PERFORMANCE_SETTINGS };
    this.i18n = createI18n();
    this.worldViewSettings = { chunkBoundsMode: "all" };
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
    this.activeNavLog = null;
    this._deactivationLog = null;
    this._lastDeactivationResolvedAt = 0;
    this._preflightSnapshot = null;
    this.hyperdriveLog = null;
    this.hyperdriveLogId = null;
    this.isHyperdrive = false;

    this.activeActions = new Set();
    this.clock = new THREE.Clock();
    this.shipStats = { ...getShipSpecs(DEFAULT_SHIP_ID) };
    this.ui = new UIManager({
      config: this.config,
      shipStats: this.shipStats,
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
    this.targetingOverlay = new TargetingOverlay({
      canvas: this.ui.elements.targetingCanvas,
      frameStyle: this.getEnvironmentPreset().targeting.frame
    });
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
      cameraLocalOffset: new THREE.Vector3(),
      targetCamPivot: new THREE.Vector3(),
      targetCamLocalOffset: new THREE.Vector3(),
      targetCamUp: new THREE.Vector3(0, 1, 0)
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
      cameraFollowTarget: new THREE.Quaternion(),
      targetCamOrbit: new THREE.Quaternion(),
      targetCamOrbitTarget: new THREE.Quaternion(),
      targetCamOrbitYawDelta: new THREE.Quaternion(),
      targetCamOrbitPitchDelta: new THREE.Quaternion()
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

    this.cameraContext = "ship"; // "ship" | "target"
    this.targetCamObject = null; // { id, kind } — object currently tracked by target cam (independent from selectedWorldObject)
    this.targetCamControl = {
      orbitDistance: 30,
      dragging: false,
      pointerId: null,
      pointers: new Map(),
      pinching: false,
      pinchDistance: 0,
      lastX: 0,
      lastY: 0
    };

    this.starLayers = [];
    this.worldLights = null;
    this.loadingStarted = false;
    this.starting = false;
    this.disposed = false;
    this.animationFrameId = null;
    this.boundEvents = null;
    this.worldSummaryLastUpdatedAt = 0;
    this.worldSummaryPending = false;
    this.betaVoidLifecycleLastCheckedAt = 0;
    this.betaVoidLifecyclePending = false;
    this.betaVoidLifecycleInterval = 30000;
    this.playerShipSaveLastUpdatedAt = 0;
    this.playerShipSavePending = false;
    this.playerShipSaveInterval = 1000;
    this._lastFrameTimestamp = 0;
    this.currentLocationBgmId = null;
    this.worldDataResetting = false;
    this.shipReflectionTexture = null;
    this.shipReflectionIntensity = LIGHTING_SETTINGS.ship.reflectionIntensity;
    this.shipRoughnessOffset = LIGHTING_SETTINGS.ship.roughnessOffset;
    this.shipFillLight = null;
    this.shipRimLight = null;
    this.renderPipeline = null;
    this.shipVisualManager = null;
    this.playerShipVisualState = null;
    this.shipEngineOutputPercent = null;
    this.selectedShipId = DEFAULT_SHIP_ID;
    this.materialMapSlots = [
      "map",
      "normalMap",
      "roughnessMap",
      "metalnessMap",
      "aoMap",
      "emissiveMap",
      "bumpMap",
      "displacementMap",
      "alphaMap",
      "lightMap",
      "specularMap",
      "envMap"
    ];
    this.disabledMaterialMapRecords = new Map();
  }

  async init() {
    await this.handleDataResetRequest();
    await this.worldDataManager.init();
    await this.loadSavedEnvironmentSettings();
    this.setupRenderer();
    this.setupScene();
    this.setupRenderPipeline();
    this.setupWorldSystems();
    this.setupWorld();
    this.setupTargetMarker();
    this.setupEvents();
    this.ui.bindControls({
      onPrepare: () => this.prepareStartSequence(),
      onStart: () => this.startGame(),
      onNavigate: (coords) => this.setTarget(coords),
      onCancelNavigate: () => this.clearTarget("navigation stopped"),
      onHyperdriveNavigate: (coords) => this.initiateHyperdrive(coords),
      onCancelHyperdrive: () => this.cancelHyperdrive(),
      onHyperdriveToWorldObject: (object) => this.hyperdriveToWorldObject(object),
      onSetSpeed: (speed) => this.setManualSpeed(speed),
      onKeyBindingsChange: (bindings) => this.setKeyBindings(bindings),
      onRegenerateWorld: () => this.regenerateWorld(),
      onClearAllData: () => this.clearAllData(),
      onReloadWorldData: () => this.reloadWorldData(),
      onChunkBoundsModeChange: (mode) => this.setChunkBoundsMode(mode),
      onEnvironmentModeChange: (mode) => this.setEnvironmentMode(mode),
      onPerformanceSettingChange: (key, enabled) => this.setPerformanceSetting(key, enabled),
      onShipSelect: (shipId) => void this.setSelectedShipId(shipId),
      onRequestObjectList: () => this.getWorldObjectList(),
      onSelectWorldObject: (object) => this.selectWorldObjectFromListItem(object),
      onNavigateToWorldObject: (object) => this.navigateToWorldObject(object),
      onClearWorldSelection: () => this.clearWorldSelection(),
      onEnterTargetCam: () => this.enterTargetCameraMode(),
      onProcessBetaVoid: (object) => this.processBetaVoidFromUi(object),
      onToggleCameraMode: () => this.requestCameraToggle()
    });
    this.ui.setChunkBoundsMode(this.worldViewSettings.chunkBoundsMode);
    this.ui.setEnvironmentMode(this.environmentMode);
    this.ui.setPerformanceSettings(this.performanceSettings);
    this.ui.setSelectedShipId(this.selectedShipId);
    void this.ui.preloadObjectRowIcons([
      new URL("../rss/svg/ind_void.svg", import.meta.url).href,
      new URL("../rss/svg/ind_loot.svg", import.meta.url).href,
      new URL("../rss/svg/ind_ex.svg", import.meta.url).href,
      new URL("../rss/svg/ind_large.svg", import.meta.url).href,
      new URL("../rss/svg/ind_small.svg", import.meta.url).href,
      new URL("../rss/svg/ind_medium.svg", import.meta.url).href,
    ]);

    this.ui.setInteractionGate();
    this.updateCameraProjection();
    this.targetingOverlay.resize();
    this.resetInitialCamera();
    this.animate();
  }

  setupWorldSystems() {
    const preset = this.getEnvironmentPreset();
    this.worldMapManager = new WorldMapManager({
      scene: this.scene,
      camera: this.camera,
      renderScale: WORLD_CONFIG.renderScale,
      renderResolutionScale: this.getRenderResolutionScale(),
      environmentVisuals: preset.worldMap,
      onRenderMutation: () => this.renderPipeline?.markTargetsDirty()
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

  getEnvironmentPreset(mode = this.environmentMode) {
    const normalizedMode = normalizeEnvironmentMode(mode);
    return SPACE_ENVIRONMENT_PRESETS[normalizedMode] || SPACE_ENVIRONMENT_PRESETS[ENVIRONMENT_MODES.light];
  }

  getObjectBloomSettings(preset = this.getEnvironmentPreset()) {
    const bloomQuality = normalizeBloomQualityMode(this.performanceSettings.bloomQuality);
    const bloomEnabled = bloomQuality !== BLOOM_QUALITY_MODES.none;
    return {
      ...preset.objectBloom,
      enabled: bloomEnabled,
      resolutionScale: bloomEnabled
        ? getBloomResolutionScale(bloomQuality)
        : preset.objectBloom.resolutionScale
    };
  }

  async loadSavedEnvironmentSettings() {
    const saved = await this.worldDataManager.getStoreValue("settings", ENVIRONMENT_SETTINGS_KEY);
    const savedMode = saved?.mode;
    const nextMode = savedMode ? normalizeEnvironmentMode(savedMode) : this.environmentMode;
    const nextPerformanceSettings = normalizePerformanceSettings(
      saved?.performanceSettings,
      saved?.renderQualityMode
    );
    this.environmentMode = nextMode;
    this.performanceSettings = nextPerformanceSettings;
    this.applyEnvironmentPreset(this.getEnvironmentPreset(nextMode));
    this.ui.setEnvironmentMode(nextMode);
    this.ui.setPerformanceSettings(nextPerformanceSettings);

    if (!saved && (nextMode !== ENVIRONMENT_MODES.light || !this.hasDefaultPerformanceSettings())) {
      await this.saveEnvironmentSettings();
    }
  }

  hasDefaultPerformanceSettings(settings = this.performanceSettings) {
    return Object.keys(DEFAULT_PERFORMANCE_SETTINGS).every((key) => {
      return settings[key] === DEFAULT_PERFORMANCE_SETTINGS[key];
    });
  }

  async saveEnvironmentSettings() {
    if (!this.worldDataManager.db) return;
    try {
      await this.worldDataManager.putStoreValue("settings", {
        key: ENVIRONMENT_SETTINGS_KEY,
        mode: this.environmentMode,
        performanceSettings: { ...this.performanceSettings }
      });
    } catch {
      this.ui.showErrorToast("settings storage unavailable");
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

  async loadSavedShipSettings() {
    const saved = await this.worldDataManager.getStoreValue("settings", "shipSettings");
    const shipId = saved?.selectedShipId;
    this.selectedShipId = (shipId && SHIP_DEFINITIONS[shipId]) ? shipId : DEFAULT_SHIP_ID;
    this._applyShipSpecs(this.selectedShipId);
    this.ui.setSelectedShipId(this.selectedShipId);
  }

  async saveShipSettings() {
    if (!this.worldDataManager.db) return;
    try {
      await this.worldDataManager.putStoreValue("settings", {
        key: "shipSettings",
        selectedShipId: this.selectedShipId
      });
    } catch {
      this.ui.showErrorToast("settings storage unavailable");
    }
  }

  _applyShipSpecs(shipId) {
    Object.assign(this.shipStats, getShipSpecs(shipId));
    this.ui.refreshSpeedGaugeRange();
  }

  async setSelectedShipId(shipId) {
    if (!SHIP_DEFINITIONS[shipId] || shipId === this.selectedShipId) return;

    const previousShipId = this.selectedShipId;

    this.shipVisualManager?.disposeShipState(this.playerShipVisualState);
    this.playerShipVisualState = null;

    const oldModel = this.ship.getObjectByName(previousShipId);
    if (oldModel) {
      this.ship.remove(oldModel);
      oldModel.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry?.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => m?.dispose());
      });
    }

    this.selectedShipId = shipId;
    this._applyShipSpecs(shipId);
    this.ui.setSelectedShipId(shipId);

    try {
      const result = await this.resourceManager.loadShipModel(shipId, { silent: true });
      if (this.disposed) return;
      this.addShipModel(result.object);
      void this.saveShipSettings();
    } catch (err) {
      console.error("[ship-swap] failed:", err);
      this.selectedShipId = previousShipId;
      this.ui.setSelectedShipId(previousShipId);
      this.ui.showErrorToast("failed to load ship model");
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
      antialias: this.performanceSettings.antialias,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(this.getRendererPixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = this.getRendererToneMapping(this.getEnvironmentPreset().renderer.toneMapping);
    this.renderer.toneMappingExposure = this.getEnvironmentPreset().renderer.toneMappingExposure;
    this.root.appendChild(this.renderer.domElement);
    this.setupShipReflectionTexture();
  }

  setupShipReflectionTexture() {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const roomEnvironment = new RoomEnvironment();
    this.shipReflectionTexture = pmremGenerator.fromScene(roomEnvironment, 0.04).texture;
    pmremGenerator.dispose();
    if (roomEnvironment.dispose) roomEnvironment.dispose();
  }

  setupScene() {
    const preset = this.getEnvironmentPreset();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(preset.scene.background);
    this.scene.fog = new THREE.FogExp2(preset.scene.fog.color, preset.scene.fog.density);
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 80000);

    this.ship = new THREE.Group();
    this.scene.add(this.ship);
    this.setupShipLocalLights();
  }

  setupRenderPipeline() {
    const preset = this.getEnvironmentPreset();
    this.renderPipeline = new BloomRenderPipeline({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      objectBloom: this.getObjectBloomSettings(preset),
      renderResolutionScale: this.getRenderResolutionScale()
    });

    this.hyperdriveWarpLayer = new HyperdriveWarpLayer({
      renderer: this.renderer,
      scene: this.scene
    });
    this.renderPipeline.setHyperdriveWarpLayer(this.hyperdriveWarpLayer);

    this.shipVisualManager = new ShipVisualManager({
      bloomLayer: this.renderPipeline.objectBloomLayerId,
      onBloomTargetsDirty: () => this.renderPipeline?.markTargetsDirty(),
      registerBloomMaterialOverride: (object, material) => {
        this.renderPipeline?.registerMaterialOverrideTarget(object, material);
      },
      registerBloomOcclusionTarget: (object) => {
        this.renderPipeline?.registerOcclusionTarget(object);
      },
      unregisterBloomMaterialOverride: (object) => {
        this.renderPipeline?.unregisterMaterialOverrideTarget(object);
      }
    });
  }

  setupShipLocalLights() {
    const { fillLight, rimLight } = LIGHTING_SETTINGS.ship;
    this.shipFillLight = new THREE.PointLight(fillLight.color, fillLight.intensity, fillLight.distance);
    this.shipFillLight.position.set(...fillLight.position);

    this.shipRimLight = new THREE.PointLight(rimLight.color, rimLight.intensity, rimLight.distance);
    this.shipRimLight.position.set(...rimLight.position);

    this.ship.add(this.shipFillLight, this.shipRimLight);
  }

  getRenderResolutionScale(settings = this.performanceSettings) {
    return normalizeRenderResolutionScale(settings.renderResolutionScale);
  }

  getRendererPixelRatio() {
    return Math.min(window.devicePixelRatio, 2) * this.getRenderResolutionScale();
  }

  applyRenderResolutionSettings() {
    if (!this.renderer) return;
    this.renderer.setPixelRatio(this.getRendererPixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderPipeline?.setRenderResolutionScale(this.getRenderResolutionScale());
    this.renderPipeline?.setSize(window.innerWidth, window.innerHeight);
    this.hyperdriveWarpLayer?.setSize(window.innerWidth, window.innerHeight);
    this.worldMapManager?.setRenderResolutionScale(this.getRenderResolutionScale());
  }

  setupWorld() {
    const preset = this.getEnvironmentPreset();
    const { ambient, key, rim, hemisphere } = preset.lights;

    const globalLight = new THREE.AmbientLight(ambient.color, ambient.intensity);
    this.scene.add(globalLight);

    const keyLight = new THREE.DirectionalLight(key.color, key.intensity);
    keyLight.position.set(...key.position);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(rim.color, rim.intensity);
    rimLight.position.set(...rim.position);
    this.scene.add(rimLight);

    const softUnderLight = new THREE.HemisphereLight(
      hemisphere.skyColor,
      hemisphere.groundColor,
      hemisphere.intensity
    );
    this.scene.add(softUnderLight);
    this.worldLights = { globalLight, keyLight, rimLight, softUnderLight };

    this.starLayers = preset.starField.layers.map((layer) => {
      return this.createStars(layer.count, layer.radius, layer.size, layer.opacity);
    });
    this.applyEnvironmentPreset(preset);
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
      pointercancel: (event) => this.cameraContext === "target" ? this.stopTargetCamDrag(event) : this.stopCameraDrag(event),
      wheel: (event) => this.onWheel(event),
      keydown: (event) => this.onKeyDown(event),
      keyup: (event) => this.onKeyUp(event),
      resize: () => this.onResize(),
      pagehide: () => {
        if (this.state.phase === "running") {
          // 임시 비활성화용 coast navLog가 있으면 취소하고 즉시 정지 navLog로 교체
          if (this._deactivationLog) {
            void this.worldDataManager.updateNavLog(this._deactivationLog.id, { status: "cancelled", cancelled_at: Date.now() });
            this._deactivationLog = null;
          }
          this._commitDeactivationNavLog(null, 0);
          if (this._deactivationLog) {
            const { id: _id, ...logData } = this._deactivationLog;
            try { localStorage.setItem("vz_deactivation_snapshot", JSON.stringify(logData)); } catch (_) {}
          }
          this.savePlayerShipState({ force: true });
        }
      },
      visibilitychange: () => {
        if (this.state.phase !== "running") return;
        if (document.visibilityState === "hidden") {
          this._commitPreflightSnapshot();
          this._commitDeactivationNavLog();
        } else if (document.visibilityState === "visible") {
          this._resolvePreflightSnapshot();
          this._resolveDeactivationNavLog();
          try { localStorage.removeItem("vz_deactivation_snapshot"); } catch (_) {}
          this._resolveHyperdriveWarp();
          this._snapToActiveNavLog();
        }
      }
    };

    this.renderer.domElement.addEventListener("pointerdown", this.boundEvents.pointerdown);
    this.renderer.domElement.addEventListener("pointermove", this.boundEvents.pointermove);
    this.renderer.domElement.addEventListener("pointerup", this.boundEvents.pointerup);
    this.renderer.domElement.addEventListener("pointercancel", this.boundEvents.pointercancel);
    this.renderer.domElement.addEventListener("wheel", this.boundEvents.wheel, { passive: false });
    window.addEventListener("keydown", this.boundEvents.keydown);
    window.addEventListener("keyup", this.boundEvents.keyup);
    window.addEventListener("resize", this.boundEvents.resize);
    window.addEventListener("pagehide", this.boundEvents.pagehide);
    document.addEventListener("visibilitychange", this.boundEvents.visibilitychange);
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
    await this.loadSavedShipSettings();
    const shipTask = this.resourceManager.loadShipModel(this.selectedShipId)
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
    if (!this.worldDataManager.db) await this.worldDataManager.init();
    await this.loadSavedEnvironmentSettings();
    await this.worldMapManager.loadAssets(this.resourceManager);
    const snapshot = await this.worldDataManager.loadOrCreateWorld();
    this.worldMapManager.renderWorld(snapshot);
    await this.loadSavedWorldViewSettings();
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

    if (activeLog?.type === "hyperdrive") {
      const hyperLog = activeLog;
      const tSinceJump = (Date.now() - hyperLog.jump_start_at) / 1000;
      const tSinceCooldown = (Date.now() - hyperLog.cooldown_start_at) / 1000;
      const navTargetVec = new THREE.Vector3(hyperLog.target.x, hyperLog.target.y, hyperLog.target.z);

      this.hyperdriveLog = hyperLog;
      this.hyperdriveLogId = hyperLog.id;
      this.isHyperdrive = true;
      this.navTarget = navTargetVec;
      this.targetMarker.visible = true;
      this.targetMarker.position.copy(navTargetVec);

      if (tSinceJump >= hyperLog.flight_duration) {
        // 워프 완료 — 목적지 스냅
        this.ship.position.set(hyperLog.target.x, hyperLog.target.y, hyperLog.target.z);
        this.state.speed = 0;
        this.state.desiredSpeed = 0;
        void this.worldDataManager.updateNavLog(hyperLog.id, { status: "completed", committed: true, completed_at: Date.now() });
        this.isHyperdrive = false;
        this.hyperdriveLog = null;
        this.hyperdriveLogId = null;
        this.navTarget = null;
        this.targetMarker.visible = false;
        usedNavLog = true;
      } else if (tSinceJump >= 0) {
        // 워프 비행 중 — 결정론적 위치 복원
        const warpPos = this.computeHyperdrivePositionAtTime(hyperLog, tSinceJump);
        this.ship.position.copy(warpPos);
        const toTarget = navTargetVec.clone().sub(warpPos);
        if (toTarget.lengthSq() > 0.0001) {
          this.lookMatrix.lookAt(toTarget.clone().normalize(), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
          this.ship.quaternion.setFromRotationMatrix(this.lookMatrix).normalize();
        }
        this.state.speed = 0;
        this.state.desiredSpeed = 0;
        this.hyperdriveLog.committed = true;
        this.state.autopilotPhase = "warping";
        usedNavLog = true;
      } else if (tSinceCooldown >= 0) {
        // 쿨타임 중 — from_position에서 정지 상태
        // 설계 의도: 쿨타임이 부재 중 경과하면 jump_start_at 도달로 이어지고
        // tSinceJump >= 0 분기(위)에서 자동 커밋 처리됨.
        // 쿨타임 취소는 반드시 사용자의 명시적 키 입력을 요구하며,
        // 부재 중 경과된 쿨타임은 암묵적 취소 사유가 되지 않는다.
        this.ship.position.set(hyperLog.from_position.x, hyperLog.from_position.y, hyperLog.from_position.z);
        const dir = new THREE.Vector3(hyperLog.heading_at_jump.x, hyperLog.heading_at_jump.y, hyperLog.heading_at_jump.z);
        if (dir.lengthSq() > 0.0001) {
          this.lookMatrix.lookAt(dir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
          this.ship.quaternion.setFromRotationMatrix(this.lookMatrix).normalize();
        }
        this.state.speed = 0;
        this.state.desiredSpeed = 0;
        this.state.autopilotPhase = "cooldown";
        usedNavLog = true;
      } else {
        // 정지/정렬 단계 — playerShipState에서 위치/속도 복원
        this.state.autopilotPhase = "stopping";
        // usedNavLog = false → 아래 playerShipState 블록에서 위치 복원 후 preflight 전진
      }
    } else if (activeLog?.flight_start_at != null && activeLog?.from_position != null) {
      const tSec = (Date.now() - activeLog.flight_start_at) / 1000;

      if (activeLog.type === "deactivation") {
        if (tSec >= activeLog.flight_duration) {
          this.ship.position.set(activeLog.target.x, activeLog.target.y, activeLog.target.z);
          this.state.speed = 0;
          this.state.desiredSpeed = 0;
          void this.worldDataManager.updateNavLog(activeLog.id, { status: "completed", completed_at: Date.now() });
        } else {
          const computedPos = this.computeDeactivationPositionAtTime(activeLog, tSec);
          const computedSpeed = this.computeDeactivationSpeedAtTime(activeLog, tSec);
          this.ship.position.copy(computedPos);
          this.state.speed = computedSpeed;
          this.state.desiredSpeed = 0;
          const deactDir = new THREE.Vector3(activeLog.target.x, activeLog.target.y, activeLog.target.z).sub(computedPos);
          if (deactDir.lengthSq() > 0.0001) {
            this.lookMatrix.lookAt(deactDir.normalize(), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
            this.ship.quaternion.setFromRotationMatrix(this.lookMatrix).normalize();
          }
          void this.worldDataManager.updateNavLog(activeLog.id, { status: "cancelled", cancelled_at: Date.now() });
        }
        usedNavLog = true;
        try { localStorage.removeItem("vz_deactivation_snapshot"); } catch (_) {}
      } else {
        if (tSec < 0) {
          // Pre-flight: navLog is complete but flight_start_at is in the future
          // Restore position/speed from playerShipState, then advance pre-flight
          const navTargetVec = new THREE.Vector3(activeLog.target.x, activeLog.target.y, activeLog.target.z);
          this.navTarget = navTargetVec;
          this.activeNavLogId = activeLog.id;
          this.activeNavLog = activeLog;
          this.state.autopilotPeakSpeed = activeLog.peak_speed ?? 0;
          this.targetMarker.visible = true;
          this.targetMarker.position.copy(navTargetVec);
          this.state.autopilotPhase = "stopping";
          // usedNavLog = false → position/speed from playerShipState, then preflight advancement
        } else if (tSec >= activeLog.flight_duration) {
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
          const toTargetDist = toTarget.length();

          if (toTarget.lengthSq() > 0.0001) {
            this.lookMatrix.lookAt(toTarget.clone().normalize(), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
            this.ship.quaternion.setFromRotationMatrix(this.lookMatrix).normalize();
          }

          this.navTarget = navTargetVec;
          this.activeNavLogId = activeLog.id;
          this.activeNavLog = activeLog;
          this.state.autopilotPeakSpeed = activeLog.peak_speed;
          this.targetMarker.visible = true;
          this.targetMarker.position.copy(navTargetVec);

          const remaining = toTargetDist - this.shipStats.arrivalRadius;
          const decelDist = computedSpeed > 0
            ? 0.5 * computedSpeed * computedSpeed / this.shipStats.decelerationRate
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
      }
    } else if (activeLog) {
      // flight_start_at 없는 활성 log (구버전 호환): stopping에서 재개
      const navTargetVec = new THREE.Vector3(activeLog.target.x, activeLog.target.y, activeLog.target.z);
      this.navTarget = navTargetVec;
      this.activeNavLogId = activeLog.id;
      this.targetMarker.visible = true;
      this.targetMarker.position.copy(navTargetVec);
      this.state.autopilotPhase = "stopping";
      this.state.autopilotPeakSpeed = 0;
      // usedNavLog = false: 위치/속도는 아래 playerShipState에서 복원
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
      if (savedAt > 0 && this.state.autopilotPhase === "stopping") {
        // 자동항해 pre-flight 중 페이지 저장 → 경과 시간 기반으로 결정론적 전진
        const fwd = new THREE.Vector3();
        this.ship.getWorldDirection(fwd);
        this._preflightSnapshot = {
          savedAt,
          phase: "stopping",
          isHyperdrive: this.isHyperdrive,
          hyperdriveLogId: this.hyperdriveLogId,
          hyperdriveLog: this.hyperdriveLog ? { ...this.hyperdriveLog } : null,
          position: { x: this.ship.position.x, y: this.ship.position.y, z: this.ship.position.z },
          speed: this.state.speed,
          heading: { x: fwd.x, y: fwd.y, z: fwd.z },
          qx: this.ship.quaternion.x, qy: this.ship.quaternion.y,
          qz: this.ship.quaternion.z, qw: this.ship.quaternion.w,
          targetPos: { x: this.navTarget.x, y: this.navTarget.y, z: this.navTarget.z },
          navLogId: this.activeNavLogId
        };
        this._resolvePreflightSnapshot();
      } else if (savedAt > 0 && this.state.speed !== 0) {
        // 수동 비행 중 비활성화 구간 결정론적 항법 적용
        const elapsed = (Date.now() - savedAt) / 1000;
        if (elapsed > 0) {
          let snapshotLog = null;
          try {
            const raw = localStorage.getItem("vz_deactivation_snapshot");
            if (raw) snapshotLog = JSON.parse(raw);
          } catch (_) {}

          if (snapshotLog?.flight_start_at && snapshotLog?.from_position) {
            // pagehide 시점의 정확한 위치/속도/타임스탬프로 navLog 재생성
            const id = this.worldDataManager.createNavLog({ ...snapshotLog, status: "active" });
            this._deactivationLog = { ...snapshotLog, id };
          } else {
            // desired_speed=0 강제: 게임 종료 시점부터 즉시 감속
            this._commitDeactivationNavLog(savedAt, 0);
          }
          try { localStorage.removeItem("vz_deactivation_snapshot"); } catch (_) {}
          this._resolveDeactivationNavLog();
          if (this.state.autopilotPhase === null) {
            this.state.desiredSpeed = 0;
          }
        }
      }
    }

    if (this.state.autopilotPhase === null) {
      this.state.autopilotPeakSpeed = 0;
      this.navTarget = null;
      this.activeNavLogId = null;
      this.activeNavLog = null;
      this.targetMarker.visible = false;
    }

    // pre-flight가 비행 단계까지 전진된 경우 결정론적 위치로 점프
    this._snapToActiveNavLog();

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
    const shipId = this.selectedShipId;
    const shipVisualDefinition = getShipDefinition(shipId).visual;
    model.name = shipId;
    model.rotation.y = Math.PI;
    this.ship.add(model);

    this.ship.updateWorldMatrix(true, true);
    this.shipBounds.setFromObject(model, true);
    if (!this.shipBounds.isEmpty()) {
      this.shipBounds.getCenter(this.vectors.modelCenter);
      this.ship.worldToLocal(this.vectors.modelCenter);
      model.position.sub(this.vectors.modelCenter);
    }
    this.ship.updateWorldMatrix(true, true);
    this.applyShipReflection(model, shipVisualDefinition);
    this.playerShipVisualState = this.shipVisualManager?.applyToShip({
      shipId,
      root: this.ship,
      object: model
    }) || null;
    this.shipEngineOutputPercent = null;
    this.updateShipEngineOutput();
    this.applyMaterialMapPerformanceSettings();
    this.applyLightingPerformanceSettings();
    this.renderPipeline?.markTargetsDirty();
  }

  applyShipReflection(model, shipVisualDefinition = getShipDefinition(DEFAULT_SHIP_ID).visual) {
    if (!this.shipReflectionTexture) return;
    const reflectionIntensity = shipVisualDefinition?.materials?.reflectionIntensity ?? this.shipReflectionIntensity;

    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material || !("envMapIntensity" in material)) return;
        material.envMap = this.shipReflectionTexture;
        material.envMapIntensity = reflectionIntensity;
        if ("roughness" in material) {
          material.roughness = Math.min(1, material.roughness + this.shipRoughnessOffset);
        }
        material.needsUpdate = true;
      });
    });
  }

  collectSceneMaterials(root = this.scene) {
    const materials = new Set();
    root?.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      objectMaterials.forEach((material) => {
        if (material?.isMaterial) materials.add(material);
      });
    });
    return materials;
  }

  disableMaterialMaps(material, disposedTextures) {
    let record = this.disabledMaterialMapRecords.get(material);
    let changed = false;

    this.materialMapSlots.forEach((slot) => {
      if (!(slot in material) || !material[slot]) return;
      if (!record) {
        record = { material, slots: {} };
        this.disabledMaterialMapRecords.set(material, record);
      }
      if (!(slot in record.slots)) record.slots[slot] = material[slot];
      disposedTextures.add(material[slot]);
      material[slot] = null;
      changed = true;
    });

    if (changed) material.needsUpdate = true;
  }

  restoreMaterialMaps() {
    this.disabledMaterialMapRecords.forEach(({ material, slots }) => {
      Object.entries(slots).forEach(([slot, texture]) => {
        if (slot in material) material[slot] = texture;
      });
      material.needsUpdate = true;
    });
    this.disabledMaterialMapRecords.clear();
  }

  applyMaterialMapPerformanceSettings() {
    if (this.performanceSettings.materialMaps) {
      this.restoreMaterialMaps();
      return;
    }

    const disposedTextures = new Set();
    this.collectSceneMaterials().forEach((material) => this.disableMaterialMaps(material, disposedTextures));
    disposedTextures.forEach((texture) => texture?.dispose?.());
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
    // Star vertices wrap around the ship, so static geometry bounds can cull a valid layer.
    points.frustumCulled = false;
    points.userData.radius = radius;
    points.userData.count = count;
    this.scene.add(points);
    return points;
  }

  applyEnvironmentPreset(preset = this.getEnvironmentPreset()) {
    if (this.renderer) {
      this.renderer.toneMapping = this.getRendererToneMapping(preset.renderer.toneMapping);
      this.renderer.toneMappingExposure = preset.renderer.toneMappingExposure;
    }

    this.renderPipeline?.setObjectBloomSettings(this.getObjectBloomSettings(preset));

    if (this.scene) {
      this.scene.background = new THREE.Color(preset.scene.background);
      this.scene.fog = new THREE.FogExp2(preset.scene.fog.color, preset.scene.fog.density);
    }

    this.targetingOverlay?.setFrameStyle(preset.targeting.frame);

    if (this.worldLights) {
      const { ambient, key, rim, hemisphere } = preset.lights;
      this.worldLights.globalLight.color.setHex(ambient.color);
      this.worldLights.globalLight.intensity = ambient.intensity;
      this.worldLights.keyLight.color.setHex(key.color);
      this.worldLights.keyLight.intensity = key.intensity;
      this.worldLights.keyLight.position.set(...key.position);
      this.worldLights.rimLight.color.setHex(rim.color);
      this.worldLights.rimLight.intensity = rim.intensity;
      this.worldLights.rimLight.position.set(...rim.position);
      this.worldLights.softUnderLight.color.setHex(hemisphere.skyColor);
      this.worldLights.softUnderLight.groundColor.setHex(hemisphere.groundColor);
      this.worldLights.softUnderLight.intensity = hemisphere.intensity;
    }
    this.worldMapManager?.setEnvironmentVisuals(preset.worldMap);
    this.hyperdriveWarpLayer?.setEnvironmentPreset(preset);
    this.applyLightingPerformanceSettings();
  }

  applyLightingPerformanceSettings() {
    const enabled = this.performanceSettings.lightingEffects;
    if (this.worldLights) {
      this.worldLights.globalLight.visible = true;
      this.worldLights.keyLight.visible = enabled;
      this.worldLights.rimLight.visible = enabled;
      this.worldLights.softUnderLight.visible = enabled;
    }

    if (this.shipFillLight) this.shipFillLight.visible = enabled;
    if (this.shipRimLight) this.shipRimLight.visible = enabled;
    this.applyShipVfxLightingPerformanceSettings(enabled);
  }

  applyShipVfxLightingPerformanceSettings(enabled = this.performanceSettings.lightingEffects) {
    const shipState = this.playerShipVisualState;
    if (!shipState) return;

    shipState.lightRuntimeAnchors.forEach((anchor) => {
      const controlState = shipState.lightControlState[anchor.type] || {};
      if (anchor.glowSprite) anchor.glowSprite.visible = enabled && controlState.billboard !== false;
      if (anchor.pointLight) anchor.pointLight.visible = enabled && controlState.pointLight !== false;
    });
  }

  getRendererToneMapping(toneMapping) {
    return RENDERER_TONE_MAPPINGS[toneMapping] ?? RENDERER_TONE_MAPPINGS.acesFilmic;
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

  enterFollowCameraDirectly() {
    this.updateShipCenter();
    this.ship.getWorldDirection(this.vectors.forward).normalize();
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion).normalize();

    this.stopTouchDpad();
    this.state.cameraFxAmount = 0;
    this.vectors.cameraActionOffset.set(0, 0, 0);
    this.vectors.cameraActionTarget.set(0, 0, 0);
    this.cameraControl.dragging = false;
    this.cameraControl.pointerId = null;
    this.cameraControl.pointers.clear();
    this.cameraControl.pinching = false;
    this.cameraControl.pinchDistance = 0;
    this.cameraControl.followShip = true;
    this.cameraControl.returningToFollow = false;

    // Immediately position camera at follow position — no lerp animation
    this.vectors.desiredCameraPosition.copy(this.vectors.shipCenter)
      .addScaledVector(this.vectors.forward, -this.cameraControl.distance)
      .addScaledVector(this.vectors.up, this.config.cameraFollowHeight);
    this.camera.position.copy(this.vectors.desiredCameraPosition);
    this.vectors.cameraUp.copy(this.vectors.up);
    this.camera.up.copy(this.vectors.cameraUp);
    this.camera.lookAt(this.vectors.shipCenter);

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
    if (this.cameraContext === "target") {
      this.applyTargetCamZoomDelta(delta);
      return;
    }

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

  applyTargetCamZoomDelta(delta) {
    const minDist = this.selectedWorldObject
      ? Math.max(0.5, this.selectedWorldObject.savedRadius * 1.2)
      : 0.5;
    this.targetCamControl.orbitDistance = Math.max(minDist, this.targetCamControl.orbitDistance + delta);
  }

  getTargetCamPointerDistance() {
    const pointers = Array.from(this.targetCamControl.pointers.values());
    if (pointers.length < 2) return 0;
    return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
  }

  stopTargetCamDrag(event) {
    this.targetCamControl.pointers.delete(event.pointerId);
    if (this.targetCamControl.pointers.size < 2) {
      this.targetCamControl.pinching = false;
      this.targetCamControl.pinchDistance = 0;
    }
    if (this.targetCamControl.pointerId === event.pointerId) {
      this.targetCamControl.dragging = false;
      this.targetCamControl.pointerId = null;
    }
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
    if (event.type === "pointercancel") this.resetSelectionPointer(event.pointerId);
  }

  getCameraPointerDistance() {
    const pointers = Array.from(this.cameraControl.pointers.values());
    if (pointers.length < 2) return 0;

    return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
  }

  setSpeed(value) {
    const nextSpeed = THREE.MathUtils.clamp(value, this.shipStats.minSpeed, this.shipStats.maxSpeed);
    const changed = nextSpeed !== this.state.desiredSpeed;
    this.state.desiredSpeed = nextSpeed;
    return changed;
  }

  setManualSpeed(value) {
    if (this.state.phase !== "running") return false;
    if (this.isHyperdrive && this.state.autopilotPhase === "warping") return false;
    if (this.isHyperdrive) {
      this.clearTarget();
    } else {
      this.cancelAutopilot();
    }
    return this.setSpeed(value);
  }

  moveToward(value, target, maxDelta) {
    if (Math.abs(target - value) <= maxDelta) return target;
    return value + Math.sign(target - value) * maxDelta;
  }

  setTarget({ x, y, z }) {
    if (this.isHyperdrive) return;
    const { decelerationRate, accelerationRate, pitchRate, yawRate, arrivalRadius } = this.shipStats;

    // Stopping phase: deterministic kinematics
    const v0 = this.state.speed;
    const stopRate = v0 > 0 ? decelerationRate : v0 < 0 ? accelerationRate : 0;
    const stopDuration = stopRate > 0 ? Math.abs(v0) / stopRate : 0;
    this.ship.getWorldDirection(this.vectors.forward);
    const heading = this.vectors.forward.clone();
    const sign = v0 > 0 ? 1 : -1;
    const stopDist = stopDuration > 0
      ? v0 * stopDuration - sign * 0.5 * stopRate * stopDuration * stopDuration
      : 0;
    const fromPos = this.ship.position.clone().addScaledVector(heading, stopDist);

    // Aligning phase: exponential decay model (slerp rate = pitchRate, threshold dot > 0.99999 ≈ 0.00447 rad)
    const toTarget = new THREE.Vector3(x, y, z).sub(fromPos);
    const targetDir = toTarget.clone().normalize();
    const dotVal = Math.max(-1, Math.min(1, heading.dot(targetDir)));
    const angle = Math.acos(dotVal);
    const alignRate = Math.min(pitchRate, yawRate);
    const alignDuration = angle > 0.00447 ? Math.log(angle / 0.00447) / alignRate : 0;

    // Flight phase
    const effectiveDist = Math.max(0, toTarget.length() - arrivalRadius);
    const peakSpeed = this.computeAutopilotPeakSpeed(effectiveDist);
    const flightDuration = this.computeFlightDuration(effectiveDist, peakSpeed);
    const flightStartAt = Date.now() + Math.round((stopDuration + alignDuration) * 1000);

    this.navTarget = new THREE.Vector3(x, y, z);
    this.state.autopilotPhase = stopDuration > 0 ? "stopping" : "aligning";
    this.state.autopilotPeakSpeed = peakSpeed;
    this.targetMarker.visible = true;
    this.targetMarker.position.copy(this.navTarget);

    const eta = stopDuration + alignDuration + flightDuration;
    this.ui.showToast(`navigation engaged (~${Math.round(eta)}s)`);

    const from = { x: fromPos.x, y: fromPos.y, z: fromPos.z };
    this.activeNavLog = {
      type: "standard",
      from_position: from,
      target: { x, y, z },
      flight_start_at: flightStartAt,
      peak_speed: peakSpeed,
      flight_duration: flightDuration
    };

    this.activeNavLogId = this.worldDataManager.createNavLog({
      target: { x, y, z },
      from_position: from,
      flight_start_at: flightStartAt,
      peak_speed: peakSpeed,
      flight_duration: flightDuration
    });

    this.savePlayerShipState({ force: true });
  }

  clearTarget(message, completed = false) {
    const now = Date.now();
    const wasHyperdrive = this.isHyperdrive || !!this.hyperdriveLogId;
    if (this.hyperdriveLogId) {
      void this.worldDataManager.updateNavLog(this.hyperdriveLogId, completed
        ? { status: "completed", committed: true, completed_at: now }
        : { status: "cancelled", cancel_reason: "user_manual", cancelled_at: now }
      );
      this.hyperdriveLogId = null;
      this.hyperdriveLog = null;
      this.isHyperdrive = false;
    }
    if (wasHyperdrive) {
      this.hyperdriveLogId = null;
      this.hyperdriveLog = null;
      this.isHyperdrive = false;
    }
    if (this.activeNavLogId) {
      void this.worldDataManager.updateNavLog(this.activeNavLogId, completed
        ? { status: "completed", completed_at: now }
        : { status: "cancelled", cancelled_at: now }
      );
      this.activeNavLogId = null;
    }
    this.state.autopilotPhase = null;
    this.state.autopilotPeakSpeed = 0;
    this.navTarget = null;
    this.activeNavLog = null;
    this.targetMarker.visible = false;
    if (message && !(wasHyperdrive && message === "arrived")) this.ui.showToast(message);
    this.savePlayerShipState({ force: true });
  }

  cancelAutopilot() {
    if (this.state.autopilotPhase === null) return;
    if (this.isHyperdrive) return;
    if (this.activeNavLogId) {
      this.worldDataManager.updateNavLog(this.activeNavLogId, { status: "cancelled", cancelled_at: Date.now() });
      this.activeNavLogId = null;
    }
    this.state.autopilotPhase = null;
    this.state.autopilotPeakSpeed = 0;
    this.navTarget = null;
    this.activeNavLog = null;
    this.targetMarker.visible = false;
  }

  initiateHyperdrive({ x, y, z }) {
    if (this.isHyperdrive) return;
    if (this.state.autopilotPhase !== null) this.cancelAutopilot();

    const { decelerationRate, accelerationRate, pitchRate, yawRate, hyperdriveSpecs } = this.shipStats;
    if (!hyperdriveSpecs) {
      this.ui.showToast("hyperdrive not available");
      return;
    }

    const now = Date.now();
    const v0 = this.state.speed;
    const stopRate = v0 > 0 ? decelerationRate : v0 < 0 ? accelerationRate : 0;
    const stopDuration = stopRate > 0 ? Math.abs(v0) / stopRate : 0;

    this.ship.getWorldDirection(this.vectors.forward);
    const heading = this.vectors.forward.clone();
    const sign = v0 >= 0 ? 1 : -1;
    const stopDist = stopDuration > 0
      ? v0 * stopDuration - sign * 0.5 * stopRate * stopDuration * stopDuration
      : 0;
    const fromPos = this.ship.position.clone().addScaledVector(heading, stopDist);

    const toTarget = new THREE.Vector3(x, y, z).sub(fromPos);
    const targetDir = toTarget.clone().normalize();
    const dotVal = Math.max(-1, Math.min(1, heading.dot(targetDir)));
    const angle = Math.acos(dotVal);
    const alignRate = Math.min(pitchRate, yawRate);
    const alignDuration = angle > 0.00447 ? Math.log(angle / 0.00447) / alignRate : 0;

    const { cooldownDuration, warpEntryDuration, warpExitDuration, warpMinFlightDuration, warpFlightSpeed } = hyperdriveSpecs;
    const distance = toTarget.length();
    const warpCruiseDuration = Math.max(warpMinFlightDuration, distance / warpFlightSpeed);
    const flightDuration = warpEntryDuration + warpCruiseDuration + warpExitDuration;

    const stopStartAt = now;
    const alignStartAt = now + Math.round(stopDuration * 1000);
    const cooldownStartAt = alignStartAt + Math.round(alignDuration * 1000);
    const jumpStartAt = cooldownStartAt + Math.round(cooldownDuration * 1000);

    this.navTarget = new THREE.Vector3(x, y, z);
    this.isHyperdrive = true;
    this.state.autopilotPhase = stopDuration > 0 ? "stopping" : alignDuration > 0 ? "aligning" : "cooldown";
    this.targetMarker.visible = true;
    this.targetMarker.position.copy(this.navTarget);

    const from = { x: fromPos.x, y: fromPos.y, z: fromPos.z };
    const log = {
      type: "hyperdrive",
      issued_at: now,
      from_position: from,
      target: { x, y, z },
      heading_at_jump: { x: targetDir.x, y: targetDir.y, z: targetDir.z },
      stop_start_at: stopStartAt,
      align_start_at: alignStartAt,
      cooldown_start_at: cooldownStartAt,
      jump_start_at: jumpStartAt,
      stop_duration: stopDuration,
      align_duration: alignDuration,
      cooldown_duration: cooldownDuration,
      warp_entry_duration: warpEntryDuration,
      warp_cruise_duration: warpCruiseDuration,
      warp_exit_duration: warpExitDuration,
      flight_duration: flightDuration,
      committed: false,
      status: "active",
      cancel_reason: null,
      completed_at: null,
      cancelled_at: null
    };

    this.hyperdriveLog = log;
    this.hyperdriveLogId = this.worldDataManager.createHyperdriveNavLog(log);

    this.savePlayerShipState({ force: true });
  }

  canCancelHyperdrive() {
    if (!this.isHyperdrive || !this.hyperdriveLog) return false;
    return Date.now() < this.hyperdriveLog.jump_start_at;
  }

  cancelHyperdrive() {
    if (!this.canCancelHyperdrive()) return;
    this.clearTarget("hyperdrive cancelled");
  }

  computeHyperdrivePositionAtTime(log, tSec) {
    const from = new THREE.Vector3(log.from_position.x, log.from_position.y, log.from_position.z);
    const target = new THREE.Vector3(log.target.x, log.target.y, log.target.z);
    if (tSec <= 0) return from.clone();
    if (tSec >= log.flight_duration) return target.clone();
    const t = tSec / log.flight_duration;
    const eased = t * t * (3 - 2 * t);
    return from.clone().lerp(target, eased);
  }

  _setShipDirectionPreservingUp(direction) {
    if (!direction || direction.lengthSq() <= 0.0001) return false;
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion).normalize();
    this.lookMatrix.lookAt(direction.clone().normalize(), new THREE.Vector3(0, 0, 0), this.vectors.up);
    this.ship.quaternion.setFromRotationMatrix(this.lookMatrix).normalize();
    return true;
  }

  _commitHyperdrive() {
    const log = this.hyperdriveLog;
    if (!log) return;
    const target = new THREE.Vector3(log.target.x, log.target.y, log.target.z);
    const fromPos = this.ship.position.clone();
    const toTarget = target.sub(fromPos);
    const distance = toTarget.length();
    const dir = distance > 0.0001
      ? toTarget.multiplyScalar(1 / distance)
      : new THREE.Vector3(log.heading_at_jump.x, log.heading_at_jump.y, log.heading_at_jump.z).normalize();

    if (dir.lengthSq() > 0.0001) {
      log.from_position = { x: fromPos.x, y: fromPos.y, z: fromPos.z };
      log.heading_at_jump = { x: dir.x, y: dir.y, z: dir.z };

      const specs = this.shipStats.hyperdriveSpecs || {};
      const entry = log.warp_entry_duration ?? specs.warpEntryDuration ?? 0.6;
      const exit = log.warp_exit_duration ?? specs.warpExitDuration ?? 0.6;
      const minCruise = specs.warpMinFlightDuration ?? log.warp_cruise_duration ?? 5;
      const flightSpeed = specs.warpFlightSpeed ?? 4000;
      const cruise = Math.max(minCruise, distance / flightSpeed);
      log.warp_cruise_duration = cruise;
      log.flight_duration = entry + cruise + exit;

      this._setShipDirectionPreservingUp(dir);
    }

    log.committed = true;
    this.state.autopilotPhase = "warping";
    this.state.speed = 0;
    this.state.desiredSpeed = 0;
    if (this.hyperdriveLogId) {
      void this.worldDataManager.updateNavLog(this.hyperdriveLogId, {
        committed: true,
        from_position: log.from_position,
        heading_at_jump: log.heading_at_jump,
        warp_cruise_duration: log.warp_cruise_duration,
        flight_duration: log.flight_duration
      });
    }
  }

  getHyperdriveWarpVisualState(now = Date.now()) {
    if (!this.isHyperdrive || this.state.autopilotPhase !== "warping" || !this.hyperdriveLog) {
      return { active: false, intensity: 0 };
    }

    const log = this.hyperdriveLog;
    const t = (now - log.jump_start_at) / 1000;

    if (t < 0 || t >= log.flight_duration) {
      return { active: false, intensity: 0 };
    }

    const entry     = log.warp_entry_duration ?? 0.6;
    const exit      = log.warp_exit_duration  ?? 0.6;
    const remaining = log.flight_duration - t;
    const entryRamp = Math.min(1, t / entry);
    const exitRamp  = Math.min(1, remaining / exit);
    const intensity = Math.max(0, Math.min(entryRamp, exitRamp));

    return {
      active: true,
      intensity,
      elapsed:      t,
      duration:     log.flight_duration,
      heading:      log.heading_at_jump,
      shipQuaternion: this.ship.quaternion,
      shipPosition: this.ship.position
    };
  }

  _resolveHyperdriveWarp() {
    if (!this.isHyperdrive || !this.hyperdriveLog) return;
    if (this.state.autopilotPhase !== "warping") return;

    const log = this.hyperdriveLog;
    const tSec = (Date.now() - log.jump_start_at) / 1000;

    if (tSec >= log.flight_duration) {
      this.ship.position.set(log.target.x, log.target.y, log.target.z);
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      this.clearTarget(null, true);
      return;
    }

    const pos = this.computeHyperdrivePositionAtTime(log, tSec);
    this.ship.position.copy(pos);
    this.state.speed = 0;
    this.state.desiredSpeed = 0;
  }

  computeAutopilotPeakSpeed(distance) {
    const { maxSpeed, accelerationRate, decelerationRate } = this.shipStats;
    const accelDist = 0.5 * maxSpeed * maxSpeed / accelerationRate;
    const decelDist = 0.5 * maxSpeed * maxSpeed / decelerationRate;
    if (distance >= accelDist + decelDist) return maxSpeed;
    const peak = Math.sqrt(2 * distance * accelerationRate * decelerationRate / (accelerationRate + decelerationRate));
    return Math.max(0, peak);
  }

  computeFlightDuration(effectiveDist, peakSpeed) {
    if (peakSpeed <= 0 || effectiveDist <= 0) return 0;
    const { accelerationRate, decelerationRate } = this.shipStats;
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
    const effectiveDist = Math.max(0, totalDist - this.shipStats.arrivalRadius);
    if (effectiveDist <= 0) return target.clone();
    dir.normalize();

    const { accelerationRate, decelerationRate } = this.shipStats;
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
    const { accelerationRate, decelerationRate } = this.shipStats;
    const accelTime = peak / accelerationRate;
    const decelTime = peak / decelerationRate;
    const cruiseTime = Math.max(0, navLog.flight_duration - accelTime - decelTime);
    const t = Math.min(tSec, navLog.flight_duration);
    if (t <= accelTime) return accelerationRate * t;
    if (t <= accelTime + cruiseTime) return peak;
    const decelT = t - accelTime - cruiseTime;
    return Math.max(0, peak - decelerationRate * decelT);
  }

  _deactivationKinematics(v0, vd, ar, dr, coastDuration, tSec) {
    let dist = 0, speed = v0, t = 0;

    if (Math.abs(speed - vd) > 0.001) {
      const accelerating = vd > speed;
      const rate = accelerating ? ar : dr;
      const phase1End = Math.min(Math.abs(vd - speed) / rate, coastDuration, tSec);
      dist += speed * phase1End + (accelerating ? 1 : -1) * 0.5 * rate * phase1End * phase1End;
      speed = accelerating ? Math.min(speed + rate * phase1End, vd) : Math.max(speed - rate * phase1End, vd);
      t = phase1End;
    }

    if (t >= tSec || speed === 0) return { dist, speed };

    if (t < coastDuration) {
      const phase2End = Math.min(coastDuration, tSec);
      dist += speed * (phase2End - t);
      t = phase2End;
    }

    if (t >= tSec || speed === 0) return { dist, speed };

    // Phase 3: 속도 부호에 따라 감속률 결정 (음수 → accelerationRate로 0에 접근)
    const stopRate = speed > 0 ? dr : ar;
    const decelTime = Math.min(tSec - t, Math.abs(speed) / stopRate);
    dist += speed * decelTime + (speed < 0 ? 0.5 : -0.5) * stopRate * decelTime * decelTime;
    speed = speed > 0
      ? Math.max(0, speed - stopRate * decelTime)
      : Math.min(0, speed + stopRate * decelTime);
    return { dist, speed };
  }

  computeDeactivationPositionAtTime(log, tSec) {
    const { accelerationRate, decelerationRate } = this.shipStats;
    const from = new THREE.Vector3(log.from_position.x, log.from_position.y, log.from_position.z);
    // heading 필드 우선 사용 — totalDist가 음수일 때 target-from 방향이 반전되는 문제 방지
    const dir = log.heading
      ? new THREE.Vector3(log.heading.x, log.heading.y, log.heading.z)
      : new THREE.Vector3(log.target.x, log.target.y, log.target.z).sub(from).normalize();
    if (dir.lengthSq() < 0.0001) return from.clone();
    const { dist } = this._deactivationKinematics(
      log.peak_speed, log.desired_speed ?? 0, accelerationRate, decelerationRate,
      log.coast_duration ?? this.shipStats.deactivationCoastDuration,
      Math.min(tSec, log.flight_duration)
    );
    return from.clone().addScaledVector(dir, dist);
  }

  computeDeactivationSpeedAtTime(log, tSec) {
    const { accelerationRate, decelerationRate } = this.shipStats;
    const { speed } = this._deactivationKinematics(
      log.peak_speed, log.desired_speed ?? 0, accelerationRate, decelerationRate,
      log.coast_duration ?? this.shipStats.deactivationCoastDuration,
      Math.min(tSec, log.flight_duration)
    );
    return speed;
  }

  _commitPreflightSnapshot() {
    const phase = this.state.autopilotPhase;
    if (phase !== "stopping" && phase !== "aligning" && phase !== "cooldown") return;
    if (!this.navTarget) return;

    this.ship.getWorldDirection(this.vectors.forward);
    this._preflightSnapshot = {
      savedAt: Date.now(),
      phase,
      isHyperdrive: this.isHyperdrive,
      hyperdriveLogId: this.hyperdriveLogId,
      hyperdriveLog: this.hyperdriveLog ? { ...this.hyperdriveLog } : null,
      position: { x: this.ship.position.x, y: this.ship.position.y, z: this.ship.position.z },
      speed: this.state.speed,
      heading: { x: this.vectors.forward.x, y: this.vectors.forward.y, z: this.vectors.forward.z },
      qx: this.ship.quaternion.x,
      qy: this.ship.quaternion.y,
      qz: this.ship.quaternion.z,
      qw: this.ship.quaternion.w,
      targetPos: { x: this.navTarget.x, y: this.navTarget.y, z: this.navTarget.z },
      navLogId: this.activeNavLogId
    };
  }

  _resolveHyperdriveAfterAlign(snap, pos, targetPos) {
    const hyperLog = snap.hyperdriveLog;
    if (!hyperLog) return;

    this.isHyperdrive = true;
    this.hyperdriveLog = hyperLog;
    this.hyperdriveLogId = snap.hyperdriveLogId;
    this.navTarget = targetPos.clone();
    this.targetMarker.visible = true;
    this.targetMarker.position.copy(this.navTarget);

    const tSinceJump = (Date.now() - hyperLog.jump_start_at) / 1000;

    if (tSinceJump >= hyperLog.flight_duration) {
      this.ship.position.set(hyperLog.target.x, hyperLog.target.y, hyperLog.target.z);
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      this.clearTarget(null, true);
    } else if (tSinceJump >= 0) {
      this.hyperdriveLog.committed = true;
      this.state.autopilotPhase = "warping";
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      this.ship.position.copy(this.computeHyperdrivePositionAtTime(hyperLog, tSinceJump));
      void this.worldDataManager.updateNavLog(snap.hyperdriveLogId, { committed: true });
    } else {
      this.state.autopilotPhase = "cooldown";
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
    }
  }

  _resolveHyperdriveCooldownSnapshot(snap) {
    const hyperLog = snap.hyperdriveLog;
    if (!hyperLog) return;

    this.isHyperdrive = true;
    this.hyperdriveLog = hyperLog;
    this.hyperdriveLogId = snap.hyperdriveLogId;
    this.ship.position.set(snap.position.x, snap.position.y, snap.position.z);
    this.ship.quaternion.set(snap.qx, snap.qy, snap.qz, snap.qw).normalize();
    this.state.speed = 0;
    this.state.desiredSpeed = 0;
    this.navTarget = new THREE.Vector3(snap.targetPos.x, snap.targetPos.y, snap.targetPos.z);
    this.targetMarker.visible = true;
    this.targetMarker.position.copy(this.navTarget);

    const tSinceJump = (Date.now() - hyperLog.jump_start_at) / 1000;

    if (tSinceJump >= hyperLog.flight_duration) {
      this.ship.position.set(hyperLog.target.x, hyperLog.target.y, hyperLog.target.z);
      this.clearTarget(null, true);
    } else if (tSinceJump >= 0) {
      this.hyperdriveLog.committed = true;
      this.state.autopilotPhase = "warping";
      this.ship.position.copy(this.computeHyperdrivePositionAtTime(hyperLog, tSinceJump));
      void this.worldDataManager.updateNavLog(snap.hyperdriveLogId, { committed: true });
    } else {
      this.state.autopilotPhase = "cooldown";
    }
  }

  _resolvePreflightSnapshot() {
    const snap = this._preflightSnapshot;
    if (!snap) return;
    this._preflightSnapshot = null;

    if (snap.isHyperdrive && snap.phase === "cooldown") {
      this._resolveHyperdriveCooldownSnapshot(snap);
      return;
    }

    const { decelerationRate, accelerationRate, pitchRate, yawRate } = this.shipStats;
    let remainingElapsed = (Date.now() - snap.savedAt) / 1000;

    const pos = new THREE.Vector3(snap.position.x, snap.position.y, snap.position.z);
    const targetPos = new THREE.Vector3(snap.targetPos.x, snap.targetPos.y, snap.targetPos.z);
    let currentSpeed = snap.speed;

    this.ship.quaternion.set(snap.qx, snap.qy, snap.qz, snap.qw).normalize();

    // Phase 1: Stopping
    if (snap.phase === "stopping" && Math.abs(currentSpeed) > 0.001) {
      const stopRate = currentSpeed > 0 ? decelerationRate : accelerationRate;
      const stopDuration = Math.abs(currentSpeed) / stopRate;
      const stopElapsed = Math.min(stopDuration, remainingElapsed);
      const heading = new THREE.Vector3(snap.heading.x, snap.heading.y, snap.heading.z);
      const sign = currentSpeed > 0 ? 1 : -1;
      const stopDist = currentSpeed * stopElapsed - sign * 0.5 * stopRate * stopElapsed * stopElapsed;
      pos.addScaledVector(heading, stopDist);
      currentSpeed = sign * Math.max(0, Math.abs(currentSpeed) - stopRate * stopElapsed);
      remainingElapsed -= stopElapsed;

      this.ship.position.copy(pos);
      this.state.speed = currentSpeed;
      this.state.desiredSpeed = currentSpeed;

      if (remainingElapsed <= 0) return;

      currentSpeed = 0;
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      this.state.autopilotPhase = "aligning";
    }

    // Phase 2: Aligning
    const toTarget = targetPos.clone().sub(pos);
    if (toTarget.length() <= this.shipStats.arrivalRadius) {
      this.ship.position.copy(pos);
      this.clearTarget(snap.isHyperdrive ? null : "arrived", true);
      return;
    }
    const targetDir = toTarget.clone().normalize();

    const currentForward = new THREE.Vector3();
    this.ship.getWorldDirection(currentForward);
    const dot = Math.max(-1, Math.min(1, currentForward.dot(targetDir)));
    const angle = Math.acos(dot);

    // Exponential decay model: remaining_angle(t) = angle * e^(-alignRate * t)
    // Completion threshold: dot > 0.99999 → remaining ≈ 0.00447 rad
    const alignRate = Math.min(pitchRate, yawRate);
    const alignThreshold = 0.00447;
    const alignDuration = angle > alignThreshold
      ? Math.log(angle / alignThreshold) / alignRate
      : 0;

    if (remainingElapsed < alignDuration) {
      this.lookMatrix.lookAt(targetDir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
      this.quaternions.desired.setFromRotationMatrix(this.lookMatrix);
      const movedFraction = 1 - Math.exp(-alignRate * remainingElapsed);
      this.ship.quaternion.slerp(this.quaternions.desired, movedFraction).normalize();
      this.state.autopilotPhase = "aligning";
      return;
    }

    // Alignment complete — snap quaternion and begin flight
    remainingElapsed -= alignDuration;
    this.lookMatrix.lookAt(targetDir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    this.ship.quaternion.setFromRotationMatrix(this.lookMatrix).normalize();
    this.ship.position.copy(pos);

    const effectiveDist = toTarget.length() - this.shipStats.arrivalRadius;
    if (effectiveDist <= 0) {
      this.clearTarget(snap.isHyperdrive ? null : "arrived", true);
      return;
    }

    if (snap.isHyperdrive) {
      this._resolveHyperdriveAfterAlign(snap, pos, targetPos);
      return;
    }

    const peakSpeed = this.computeAutopilotPeakSpeed(effectiveDist);
    const flightDuration = this.computeFlightDuration(effectiveDist, peakSpeed);
    const flightStartAt = Date.now() - Math.round(remainingElapsed * 1000);

    this.state.autopilotPeakSpeed = peakSpeed;
    this.state.autopilotPhase = "accelerating";
    this.activeNavLog = {
      type: "standard",
      from_position: { x: pos.x, y: pos.y, z: pos.z },
      target: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
      flight_start_at: flightStartAt,
      peak_speed: peakSpeed,
      flight_duration: flightDuration
    };

    if (snap.navLogId) {
      void this.worldDataManager.updateNavLog(snap.navLogId, {
        from_position: { x: pos.x, y: pos.y, z: pos.z },
        flight_start_at: flightStartAt,
        peak_speed: peakSpeed,
        flight_duration: flightDuration
      });
    }
    // _snapToActiveNavLog() runs after this and advances position/phase based on flightStartAt
  }

  _commitDeactivationNavLog(overrideStartAt = null, overrideDesiredSpeed = null) {
    if (this.isHyperdrive && this.state.autopilotPhase === "warping") return;
    if (this.state.autopilotPhase !== null || this.state.speed === 0) return;

    const { decelerationRate, accelerationRate, deactivationCoastDuration } = this.shipStats;
    const v0 = this.state.speed;
    const vd = overrideDesiredSpeed !== null ? overrideDesiredSpeed : this.state.desiredSpeed;
    const coastDuration = vd === 0 ? 0 : deactivationCoastDuration;

    this.ship.getWorldDirection(this.vectors.forward).normalize();
    const dir = this.vectors.forward.clone();
    const from = { x: this.ship.position.x, y: this.ship.position.y, z: this.ship.position.z };

    const { speed: speedAtCoastEnd } = this._deactivationKinematics(
      v0, vd, accelerationRate, decelerationRate, coastDuration, coastDuration
    );
    const stopRate = speedAtCoastEnd > 0 ? decelerationRate : accelerationRate;
    const flightDuration = speedAtCoastEnd === 0
      ? (Math.abs(vd - v0) > 0.001 ? Math.abs(vd - v0) / (vd < v0 ? decelerationRate : accelerationRate) : 0)
      : coastDuration + Math.abs(speedAtCoastEnd) / stopRate;
    const { dist: totalDist } = this._deactivationKinematics(
      v0, vd, accelerationRate, decelerationRate, coastDuration, flightDuration
    );
    const stopPos = this.ship.position.clone().addScaledVector(dir, totalDist);

    const log = {
      type: "deactivation",
      from_position: from,
      target: { x: stopPos.x, y: stopPos.y, z: stopPos.z },
      heading: { x: dir.x, y: dir.y, z: dir.z },
      flight_start_at: overrideStartAt ?? Date.now(),
      peak_speed: v0,
      desired_speed: vd,
      coast_duration: coastDuration,
      flight_duration: flightDuration,
      status: "active"
    };

    const id = this.worldDataManager.createNavLog(log);
    this._deactivationLog = { ...log, id };
  }

  _resolveDeactivationNavLog() {
    const log = this._deactivationLog;
    if (!log) return;
    this._deactivationLog = null;
    this._lastDeactivationResolvedAt = Date.now();

    const { accelerationRate, decelerationRate } = this.shipStats;
    const tSec = (Date.now() - log.flight_start_at) / 1000;

    if (tSec >= log.flight_duration) {
      this.ship.position.set(log.target.x, log.target.y, log.target.z);
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      void this.worldDataManager.updateNavLog(log.id, { status: "completed", completed_at: Date.now() });
      return;
    }

    const from = new THREE.Vector3(log.from_position.x, log.from_position.y, log.from_position.z);
    const dir = log.heading
      ? new THREE.Vector3(log.heading.x, log.heading.y, log.heading.z)
      : new THREE.Vector3(log.target.x, log.target.y, log.target.z).sub(from).normalize();

    const { dist, speed } = this._deactivationKinematics(
      log.peak_speed, log.desired_speed ?? 0, accelerationRate, decelerationRate,
      log.coast_duration ?? this.shipStats.deactivationCoastDuration, tSec
    );

    this.ship.position.copy(from).addScaledVector(dir, dist);
    this.state.speed = speed;
    this.state.desiredSpeed = speed;

    if (dir.lengthSq() > 0.0001) {
      this.lookMatrix.lookAt(dir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
      this.ship.quaternion.setFromRotationMatrix(this.lookMatrix).normalize();
    }

    void this.worldDataManager.updateNavLog(log.id, { status: "cancelled", cancelled_at: Date.now() });
  }

  _snapToActiveNavLog() {
    const log = this.activeNavLog;
    if (!log?.flight_start_at || !this.navTarget) return;

    const tSec = (Date.now() - log.flight_start_at) / 1000;

    if (tSec < 0) return; // pre-flight: flight hasn't started yet, real-time simulation handles it

    if (tSec >= log.flight_duration) {
      this.ship.position.set(log.target.x, log.target.y, log.target.z);
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      this.clearTarget("arrived", true);
      return;
    }

    const computedPos = this.computeNavPositionAtTime(log, tSec);
    const computedSpeed = this.computeNavSpeedAtTime(log, tSec);
    this.ship.position.copy(computedPos);
    this.state.speed = computedSpeed;

    const toTarget = this.navTarget.clone().sub(computedPos);
    const remaining = toTarget.length() - this.shipStats.arrivalRadius;
    if (toTarget.lengthSq() > 0.0001) {
      this.lookMatrix.lookAt(toTarget.clone().normalize(), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
      this.ship.quaternion.setFromRotationMatrix(this.lookMatrix).normalize();
    }

    const decelDist = computedSpeed > 0
      ? 0.5 * computedSpeed * computedSpeed / this.shipStats.decelerationRate
      : 0;

    if (remaining <= decelDist) {
      this.state.autopilotPhase = "decelerating";
      this.state.desiredSpeed = 0;
    } else {
      this.state.autopilotPhase = "cruising";
      this.state.desiredSpeed = log.peak_speed;
    }
  }

  updateThrottleTarget(dt) {
    if (this.state.autopilotPhase !== null) return;

    const accelerating = this.activeActions.has("throttleUp");
    const decelerating = this.activeActions.has("throttleDown");
    if (accelerating === decelerating) return;

    const target = accelerating ? this.shipStats.maxSpeed : this.shipStats.minSpeed;
    const nextSpeed = this.moveToward(
      this.state.desiredSpeed,
      target,
      this.shipStats.throttleAdjustRate * dt
    );
    this.setSpeed(nextSpeed);
  }

  updateSpeed(dt) {
    const previousSpeed = this.state.speed;
    const rate = this.state.desiredSpeed >= this.state.speed
      ? this.shipStats.accelerationRate
      : this.shipStats.decelerationRate;
    this.state.speed = this.moveToward(this.state.speed, this.state.desiredSpeed, rate * dt);
    this.state.speedTrend = this.state.speed - previousSpeed;
  }

  getShipEngineOutputPercent() {
    const maxSpeed = Number(this.shipStats.maxSpeed);
    if (!Number.isFinite(maxSpeed) || maxSpeed <= 0) return 0;
    return THREE.MathUtils.clamp(Math.max(0, this.state.speed) / maxSpeed, 0, 1) * 100;
  }

  updateShipEngineOutput() {
    if (!this.playerShipVisualState || !this.shipVisualManager) return;

    const nextOutput = this.getShipEngineOutputPercent();
    if (this.shipEngineOutputPercent !== null && Math.abs(nextOutput - this.shipEngineOutputPercent) < 0.01) return;

    this.shipEngineOutputPercent = nextOutput;
    this.playerShipVisualState.engineOutputSettings.value = nextOutput;
    this.shipVisualManager.applyEngineOutputSettings(this.playerShipVisualState);
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

    if (pitchUp > 0) pitch += this.shipStats.pitchRate * dt * pitchDirection * pitchUp;
    if (pitchDown > 0) pitch -= this.shipStats.pitchRate * dt * pitchDirection * pitchDown;
    if (yawLeft > 0) yaw += this.shipStats.yawRate * dt * yawLeft;
    if (yawRight > 0) yaw -= this.shipStats.yawRate * dt * yawRight;
    if (this.activeActions.has("rollLeft")) roll -= this.shipStats.rollRate * dt;
    if (this.activeActions.has("rollRight")) roll += this.shipStats.rollRate * dt;

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
    const phase = this.state.autopilotPhase;

    if (distance <= this.shipStats.arrivalRadius) {
      if (!(this.isHyperdrive && phase === "warping")) {
        this.clearTarget(this.isHyperdrive ? null : "arrived", true);
        this.setSpeed(0);
        return;
      }
    }

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
      this.ship.quaternion.slerp(this.quaternions.desired, Math.min(1, Math.min(this.shipStats.pitchRate, this.shipStats.yawRate) * dt)).normalize();
      this.ship.getWorldDirection(this.vectors.forward);
      if (this.vectors.forward.dot(direction) > 0.99999) {
        this.state.autopilotPhase = this.isHyperdrive ? "cooldown" : "accelerating";
      }

    } else if (phase === "cooldown") {
      this.setSpeed(0);
      this.state.desiredSpeed = 0;
      if (!this.hyperdriveLog || Date.now() >= this.hyperdriveLog.jump_start_at) {
        this._commitHyperdrive();
      }

    } else if (phase === "warping") {
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      const hyperLog = this.hyperdriveLog;
      if (!hyperLog) {
        this.clearTarget("hyperdrive error");
        return;
      }
      const tSec = (Date.now() - hyperLog.jump_start_at) / 1000;
      if (tSec >= hyperLog.flight_duration) {
        this.ship.position.set(hyperLog.target.x, hyperLog.target.y, hyperLog.target.z);
        this.clearTarget(null, true);
        return;
      }
      this.ship.position.copy(this.computeHyperdrivePositionAtTime(hyperLog, tSec));

    } else if (phase === "accelerating") {
      this.setSpeed(this.state.autopilotPeakSpeed);
      this._autopilotCourseCorrect(dt);
      const decelDist = 0.5 * this.state.speed * this.state.speed / this.shipStats.decelerationRate;
      const remaining = distance - this.shipStats.arrivalRadius;
      if (remaining <= decelDist) {
        this.state.autopilotPhase = "decelerating";
      } else if (this.state.speed >= this.state.autopilotPeakSpeed - 0.1) {
        this.state.autopilotPhase = "cruising";
      }

    } else if (phase === "cruising") {
      this.setSpeed(this.state.autopilotPeakSpeed);
      this._autopilotCourseCorrect(dt);
      const decelDist = 0.5 * this.state.speed * this.state.speed / this.shipStats.decelerationRate;
      if (distance - this.shipStats.arrivalRadius <= decelDist) {
        this.state.autopilotPhase = "decelerating";
      }

    } else if (phase === "decelerating") {
      this.setSpeed(0);
      this._autopilotCourseCorrect(dt);
      if (Math.abs(this.state.speed) < 0.5 && distance > this.shipStats.arrivalRadius * 2) {
        this.state.autopilotPhase = "stopping";
      }
    }
  }

  _autopilotCourseCorrect(dt) {
    const courseDir = this.vectors.targetVec.normalize();
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion);
    this.lookMatrix.lookAt(courseDir, new THREE.Vector3(0, 0, 0), this.vectors.up);
    this.quaternions.desired.setFromRotationMatrix(this.lookMatrix);
    this.ship.quaternion.slerp(this.quaternions.desired, Math.min(1, Math.min(this.shipStats.pitchRate, this.shipStats.yawRate) * 0.4 * dt)).normalize();
  }

  updateAutopilotRollOnly(dt) {
    let roll = 0;
    if (this.activeActions.has("rollLeft")) roll -= this.shipStats.rollRate * dt;
    if (this.activeActions.has("rollRight")) roll += this.shipStats.rollRate * dt;
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
      if (this.activeActions.has("strafeLeft")) this.vectors.movement.addScaledVector(this.vectors.right, this.shipStats.strafeRate * dt);
      if (this.activeActions.has("strafeRight")) this.vectors.movement.addScaledVector(this.vectors.right, -this.shipStats.strafeRate * dt);
      if (this.activeActions.has("ascend")) this.vectors.movement.addScaledVector(this.vectors.up, this.shipStats.verticalRate * dt);
      if (this.activeActions.has("descend")) this.vectors.movement.addScaledVector(this.vectors.up, -this.shipStats.verticalRate * dt);
    }

    this.ship.position.add(this.vectors.movement);
  }

  updateCamera(dt) {
    if (this.cameraContext === "target") {
      this.updateTargetCamera(dt);
      return;
    }

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

  updateTargetCamera() {
    if (!this.targetCamObject) {
      this.exitTargetCameraMode();
      return;
    }

    const visibleObject = this.findVisibleWorldObject(this.targetCamObject.kind, this.targetCamObject.id);
    if (!visibleObject) {
      this.exitTargetCameraMode();
      return;
    }

    const bounds = this.getObjectSelectionBounds(visibleObject);
    this.vectors.targetCamPivot.copy(bounds.center);

    this.quaternions.targetCamOrbit.copy(this.quaternions.targetCamOrbitTarget);
    this.vectors.targetCamLocalOffset.set(0, 0, this.targetCamControl.orbitDistance)
      .applyQuaternion(this.quaternions.targetCamOrbit);

    this.camera.position.copy(this.vectors.targetCamPivot).add(this.vectors.targetCamLocalOffset);
    this.camera.quaternion.copy(this.quaternions.targetCamOrbit);
    this.vectors.targetCamUp.set(0, 1, 0).applyQuaternion(this.quaternions.targetCamOrbit).normalize();
    this.camera.up.copy(this.vectors.targetCamUp);
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
    const hyperdrivePhase = this.isHyperdrive ? this.state.autopilotPhase : null;
    const hyperdriveElapsed = hyperdrivePhase === "warping" && this.hyperdriveLog
      ? Math.max(0, (Date.now() - this.hyperdriveLog.jump_start_at) / 1000)
      : null;
    const hyperdriveDuration = hyperdrivePhase === "warping" && this.hyperdriveLog
      ? this.hyperdriveLog.flight_duration
      : null;

    this.ui.updateHud({
      phase: this.state.phase === "running" ? "Manual" : this.state.phase,
      speed: this.state.speed,
      desiredSpeed: this.state.desiredSpeed,
      position: this.ship.position,
      heading: this.vectors.forward,
      target: this.navTarget,
      autopilot: this.state.autopilotPhase !== null && !this.isHyperdrive,
      hyperdrivePhase,
      hyperdriveElapsed,
      hyperdriveDuration,
      cooldownStartAt: this.isHyperdrive ? (this.hyperdriveLog?.cooldown_start_at ?? null) : null,
      jumpStartAt: this.isHyperdrive ? (this.hyperdriveLog?.jump_start_at ?? null) : null
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
    void this.updateBetaVoidLifecycle();
    this.updateAutopilot(dt);
    this.updateThrottleTarget(dt);
    this.updateSpeed(dt);
    if (this.state.autopilotPhase === null) {
      this.updateManualRotation(dt);
    } else if (
      this.state.autopilotPhase !== "aligning" &&
      this.state.autopilotPhase !== "stopping" &&
      this.state.autopilotPhase !== "warping"
    ) {
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
      await this.worldDataManager.processBetaVoidLifecycle();
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

  setEnvironmentMode(mode) {
    const nextMode = normalizeEnvironmentMode(mode);
    if (this.environmentMode === nextMode) {
      this.ui.setEnvironmentMode(nextMode);
      return;
    }

    this.environmentMode = nextMode;
    this.applyEnvironmentPreset(this.getEnvironmentPreset(nextMode));
    this.ui.setEnvironmentMode(nextMode);
    void this.saveEnvironmentSettings();
  }

  setPerformanceSetting(key, value) {
    if (!(key in DEFAULT_PERFORMANCE_SETTINGS)) {
      return;
    }

    let nextValue = value === true;
    if (key === "bloomQuality") {
      nextValue = normalizeBloomQualityMode(value);
    } else if (key === "renderResolutionScale") {
      nextValue = normalizeRenderResolutionScale(value);
    }
    const nextSettings = normalizePerformanceSettings({
      ...this.performanceSettings,
      [key]: nextValue
    });
    if (this.performanceSettings[key] === nextSettings[key]) {
      this.ui.setPerformanceSettings(nextSettings);
      return;
    }

    this.performanceSettings = nextSettings;
    if (key === "bloomQuality") {
      this.renderPipeline?.setObjectBloomSettings(this.getObjectBloomSettings());
    } else if (key === "renderResolutionScale") {
      this.applyRenderResolutionSettings();
    } else if (key === "materialMaps") {
      this.applyMaterialMapPerformanceSettings();
    } else if (key === "lightingEffects") {
      this.applyLightingPerformanceSettings();
    } else if (key === "antialias") {
      this.ui.showToast("anti-alias applies after reload");
    }
    this.ui.setPerformanceSettings(nextSettings);
    void this.saveEnvironmentSettings();
  }

  getWorldObjectList() {
    const snapshot = this.worldMapManager?.snapshot || this.worldDataManager.snapshot;
    if (!snapshot) return { buildings: [], resources: [], betaVoids: [] };

    const sectorsById = new Map(snapshot.sectors.map((sector) => [sector.sector_id, sector]));
    const playerPosition = this.getPlayerDataPosition();
    const toListItem = (object, kind) => {
      const id = object.building_instance_id || object.resource_instance_id || object.id;
      const type = kind === "betaVoid"
        ? "beta_void"
        : object.building_id || object.resource_id || object.type || "unknown";
      const definition = kind === "building"
        ? BUILDING_DEFINITIONS[object.building_id]
        : kind === "resource"
          ? RESOURCE_DEFINITIONS[object.resource_id || object.type]
          : null;
      const producedItem = kind === "resource"
        ? ITEM_DEFINITIONS[definition?.produces_item_id]
        : null;
      const labelDefinition = kind === "building" ? definition : producedItem || definition;
      const label = kind === "betaVoid"
        ? this.i18n.t("betaVoid.name", {}, "Beta Void")
        : this.i18n.resolveDefinitionText(labelDefinition, "name", type);
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
        iconUrl: this.getWorldSelectionIconUrl(kind, type),
        currentAmount: object.current_amount ?? null,
        totalCapacity: object.total_capacity ?? null,
        amountLabel: object.current_amount != null && object.total_capacity != null
          ? `${Math.round(object.current_amount)} / ${Math.round(object.total_capacity)}`
          : "unavailable",
        statusLabel: object.status || "unknown",
        status: object.status || null,
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
      resources: snapshot.resourceNodes.map((resourceNode) => toListItem(resourceNode, "resource")),
      betaVoids: (snapshot.betaVoids || [])
        .filter((betaVoid) => betaVoid.status === "active")
        .map((betaVoid) => toListItem(betaVoid, "betaVoid"))
    };
  }

  navigateToWorldObject(object) {
    if (!object?.target) return;
    this.setTarget(object.target);
  }

  hyperdriveToWorldObject(object) {
    if (!object?.target) return;
    this.initiateHyperdrive(object.target);
  }

  async processBetaVoidFromUi(object) {
    if (!object?.id || object.kind !== "betaVoid") return;
    if (!this.worldDataManager.db) {
      this.ui.showErrorToast("world database unavailable");
      return;
    }

    try {
      await this.worldDataManager.processBetaVoid(object.id);
      const snapshot = await this.worldDataManager.getWorldSnapshot();
      this.worldMapManager.renderWorld(snapshot, this.getPlayerDataPosition());
      if (this.selectedWorldObject?.kind === "betaVoid" && this.selectedWorldObject.id === object.id) {
        this.clearWorldSelection();
      }
      this.ui.showToast(this.i18n.t("betaVoid.processed", {}, "Beta Void processed"));
    } catch (error) {
      this.ui.showErrorToast(error instanceof Error ? error.message : this.i18n.t("betaVoid.processFailed", {}, "Beta Void process failed"));
    }
  }

  async updateBetaVoidLifecycle({ force = false } = {}) {
    if (!this.worldDataManager.db || this.betaVoidLifecyclePending) return;

    const now = performance.now();
    if (!force && now - this.betaVoidLifecycleLastCheckedAt < this.betaVoidLifecycleInterval) return;
    this.betaVoidLifecycleLastCheckedAt = now;
    this.betaVoidLifecyclePending = true;

    try {
      const result = await this.worldDataManager.processBetaVoidLifecycle();
      if (!result?.changed) return;

      const snapshot = await this.worldDataManager.getWorldSnapshot();
      this.worldMapManager.renderWorld(snapshot, this.getPlayerDataPosition());
      this.syncWorldRuntimeWithPlayer({ force: true });
      this.updateTargetingOverlay();
    } catch (error) {
      console.error("Beta Void lifecycle failed:", error);
    } finally {
      this.betaVoidLifecyclePending = false;
    }
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

    const nowMs = Date.now();
    const frameGapMs = this._lastFrameTimestamp ? nowMs - this._lastFrameTimestamp : 0;
    this._lastFrameTimestamp = nowMs;

    const gapStartAt = nowMs - frameGapMs;
    if (
      this.state.phase === "running" &&
      this.state.autopilotPhase === null &&
      this.state.speed !== 0 &&
      frameGapMs > this.config.gapDetectionThresholdMs &&
      !this._deactivationLog &&
      gapStartAt > this._lastDeactivationResolvedAt
    ) {
      this.activeActions.clear();
      this._commitDeactivationNavLog(nowMs - frameGapMs);
      this._resolveDeactivationNavLog();
      try { localStorage.removeItem("vz_deactivation_snapshot"); } catch (_) {}
    }

    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state.phase === "running") {
      this.update(dt);
    } else {
      this.worldMapManager?.update(dt);
    }

    this.updateTargetMarker(dt);
    this.updateShipEngineOutput();
    this.updateHud();
    this.updateTargetingOverlay();

    const warpVisualState = this.getHyperdriveWarpVisualState();
    this.hyperdriveWarpLayer?.update(dt, warpVisualState);

    if (this.renderPipeline) {
      this.renderPipeline.render();
    } else {
      this.renderer.render(this.scene, this.camera);
      this.hyperdriveWarpLayer?.render(this.camera);
    }
    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  onPointerDown(event) {
    if (this.state.phase !== "running") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();

    if (this.cameraContext === "target") {
      this.startSelectionPointer(event, this.targetCamControl.pointers.size === 0);
      this.targetCamControl.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.renderer.domElement.setPointerCapture(event.pointerId);
      if (this.targetCamControl.pointers.size >= 2) {
        this.cancelSelectionPointer();
        this.targetCamControl.dragging = false;
        this.targetCamControl.pointerId = null;
        this.targetCamControl.pinching = true;
        this.targetCamControl.pinchDistance = this.getTargetCamPointerDistance();
      } else {
        this.targetCamControl.dragging = true;
        this.targetCamControl.pointerId = event.pointerId;
        this.targetCamControl.lastX = event.clientX;
        this.targetCamControl.lastY = event.clientY;
      }
      return;
    }

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

    if (this.cameraContext === "target") {
      if (this.targetCamControl.pointers.has(event.pointerId)) {
        this.targetCamControl.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (this.targetCamControl.pinching) {
        if (this.targetCamControl.pointers.size < 2) return;
        event.preventDefault();
        const nextDistance = this.getTargetCamPointerDistance();
        if (nextDistance <= 0 || this.targetCamControl.pinchDistance <= 0) {
          this.targetCamControl.pinchDistance = nextDistance;
          return;
        }
        const pinchDelta = (this.targetCamControl.pinchDistance - nextDistance) * this.config.cameraZoomSensitivity;
        this.applyTargetCamZoomDelta(pinchDelta);
        this.targetCamControl.pinchDistance = nextDistance;
        return;
      }

      if (!this.targetCamControl.dragging || this.targetCamControl.pointerId !== event.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - this.targetCamControl.lastX;
      const dy = event.clientY - this.targetCamControl.lastY;
      this.targetCamControl.lastX = event.clientX;
      this.targetCamControl.lastY = event.clientY;
      if (dx === 0 && dy === 0) return;

      this.quaternions.targetCamOrbitYawDelta.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -dx * this.config.cameraOrbitSensitivity
      );
      this.quaternions.targetCamOrbitTarget.premultiply(this.quaternions.targetCamOrbitYawDelta).normalize();

      this.vectors.targetCamLocalOffset.set(1, 0, 0)
        .applyQuaternion(this.quaternions.targetCamOrbitTarget)
        .normalize();
      this.quaternions.targetCamOrbitPitchDelta.setFromAxisAngle(
        this.vectors.targetCamLocalOffset,
        -dy * this.config.cameraOrbitSensitivity
      );
      this.quaternions.targetCamOrbitTarget.premultiply(this.quaternions.targetCamOrbitPitchDelta).normalize();
      return;
    }

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
    if (this.cameraContext === "target") {
      const shouldSelect = this.shouldSelectFromPointer(event);
      this.stopTargetCamDrag(event);
      // Selection updates independently of target cam tracking
      if (shouldSelect) this.selectWorldObjectFromPointer(event.clientX, event.clientY);
      this.resetSelectionPointer(event.pointerId);
      return;
    }

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

  isSelectableWorldKind(kind) {
    return kind === "resource" || kind === "building" || kind === "betaVoid";
  }

  selectWorldObjectFromListItem(object) {
    if (!object?.id || !this.isSelectableWorldKind(object.kind)) return;

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
      if (this.isSelectableWorldKind(cursor.userData?.kind)) return cursor;
      cursor = cursor.parent;
    }
    return null;
  }

  getWorldObjectFromScreenPoint(clientX, clientY) {
    const objectsGroup = this.worldMapManager?.objectsGroup;
    if (!objectsGroup) return null;

    const hits = [];
    for (const object of objectsGroup.children) {
      if (!this.isSelectableWorldKind(object.userData?.kind)) continue;
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
    if (!id || !this.isSelectableWorldKind(kind)) return null;

    const type = kind === "building"
      ? data.building_id || data.type || "unknown"
      : kind === "betaVoid"
        ? "beta_void"
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
    if (kind === "betaVoid") return this.i18n.t("betaVoid.name", {}, "Beta Void");

    if (kind === "building") {
      const definition = BUILDING_DEFINITIONS[type];
      return this.i18n.resolveDefinitionText(definition, "name", this.formatObjectName(type));
    }

    const definition = RESOURCE_DEFINITIONS[type];
    const producedItem = ITEM_DEFINITIONS[definition?.produces_item_id];
    return this.i18n.resolveDefinitionText(producedItem || definition, "name", this.formatObjectName(type));
  }

  getWorldSelectionIconUrl(kind, type) {
    if (kind === "betaVoid") return new URL("../rss/svg/ind_void.svg", import.meta.url).href;
    if (kind !== "building") return new URL("../rss/svg/ind_loot.svg", import.meta.url).href;

    const size = BUILDING_DEFINITIONS[type]?.size;
    if (size === "EX") return new URL("../rss/svg/ind_ex.svg", import.meta.url).href;
    if (size === "L") return new URL("../rss/svg/ind_large.svg", import.meta.url).href;
    if (size === "S") return new URL("../rss/svg/ind_small.svg", import.meta.url).href;
    return new URL("../rss/svg/ind_medium.svg", import.meta.url).href;
  }

  getWorldSelectionFallbackRadius(kind, type) {
    if (kind === "betaVoid") return 30;

    const definition = kind === "building"
      ? BUILDING_DEFINITIONS[type]
      : RESOURCE_DEFINITIONS[type];
    const visualScale = Number(definition?.visual?.scale) || 8;
    return Math.max(0.001, visualScale * 1.6);
  }

  enterTargetCameraMode() {
    const selection = this.selectedWorldObject;
    if (!selection) {
      this.targetCamObject = null;
      this.cameraContext = "ship";
      this.enterFollowCameraDirectly();
      return;
    }

    // Toggle off if already tracking this exact object
    if (this.cameraContext === "target" && this.targetCamObject?.id === selection.id) {
      this.exitTargetCameraMode();
      return;
    }

    const visibleObject = this.findVisibleWorldObject(selection.kind, selection.id);
    if (!visibleObject) {
      this.ui.showToast("out of range");
      // Requirement 2: any failed entry → ship follow cam (exit target cam if active)
      this.targetCamObject = null;
      this.cameraContext = "ship";
      this.enterFollowCameraDirectly();
      return;
    }

    const bounds = this.getObjectSelectionBounds(visibleObject);
    this.vectors.targetCamPivot.copy(bounds.center);
    this.targetCamControl.orbitDistance = Math.max(
      bounds.radius * this.config.targetCamDistanceMult,
      bounds.radius * 1.5
    );

    const direction = this.camera.position.clone().sub(this.vectors.targetCamPivot).normalize();
    const initialPos = this.vectors.targetCamPivot.clone()
      .addScaledVector(direction, this.targetCamControl.orbitDistance);
    this.lookMatrix.lookAt(initialPos, this.vectors.targetCamPivot, new THREE.Vector3(0, 1, 0));
    this.quaternions.targetCamOrbitTarget.setFromRotationMatrix(this.lookMatrix).normalize();

    this.targetCamObject = { id: selection.id, kind: selection.kind };
    this.cameraContext = "target";
    this.ui.showToast("cam: target");
  }

  exitTargetCameraMode() {
    if (this.cameraContext !== "target") return;
    this.targetCamObject = null;
    this.cameraContext = "ship";
    this.targetCamControl.dragging = false;
    this.targetCamControl.pointerId = null;
    this.targetCamControl.pointers.clear();
    this.targetCamControl.pinching = false;
    this.targetCamControl.pinchDistance = 0;
    // Direct snap to ship follow — no lerp (camera was positioned at target object, not ship)
    this.enterFollowCameraDirectly();
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

    // Derive button state from actual camera/tracking state — idempotent, no manual toggle needed
    const isTrackedObject = this.cameraContext === "target" &&
      this.targetCamObject?.id === this.selectedWorldObject.id;
    this.ui.setFocusButtonVisible(this.selectedWorldObject.wasVisible || isTrackedObject);
    this.ui.setTargetCamActive(isTrackedObject);
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
    const projection = this.projectWorldSelectionCenter(center, { allowBehind: true });
    if (!projection) return null;

    return {
      key: `${selection.kind}:${selection.id}`,
      screenCenter: projection.screenCenter,
      depth: projection.depth,
      focal: projection.focal,
      radius,
      forceMinimumSide: forceMinimumSide || projection.behind,
      startedAt: selection.startedAt,
      iconUrl: selection.iconUrl,
      smoothFrame: performance.now() < selection.frameTransitionUntil,
      iconOnly: projection.behind
    };
  }

  findVisibleWorldObject(kind, id) {
    const objectsGroup = this.worldMapManager?.objectsGroup;
    if (!objectsGroup) return null;
    return objectsGroup.children.find((child) => child.userData?.kind === kind && child.userData?.id === id) || null;
  }

  projectWorldSelectionCenter(center, { allowBehind = false } = {}) {
    this.camera.getWorldDirection(this.selectionCameraDirection);
    const depth = this.selectionScratch.copy(center).sub(this.camera.position).dot(this.selectionCameraDirection);
    const height = Math.max(1, window.innerHeight);
    const focal = height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    if (depth <= this.camera.near) {
      if (!allowBehind) return null;
      return {
        screenCenter: this.getBehindScreenCenter(center),
        depth: this.camera.near,
        focal,
        behind: true
      };
    }

    this.selectionScratchB.copy(center).project(this.camera);
    if (!Number.isFinite(this.selectionScratchB.x) || !Number.isFinite(this.selectionScratchB.y)) return null;

    return {
      screenCenter: {
        x: (this.selectionScratchB.x * 0.5 + 0.5) * window.innerWidth,
        y: (-this.selectionScratchB.y * 0.5 + 0.5) * window.innerHeight
      },
      depth,
      focal,
      behind: false
    };
  }

  getBehindScreenCenter(center) {
    this.selectionScratchB.copy(center).applyMatrix4(this.camera.matrixWorldInverse);
    let dx = this.selectionScratchB.x;
    let dy = -this.selectionScratchB.y;
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
      dy = 1;
    }

    const halfWidth = Math.max(1, window.innerWidth * 0.5);
    const halfHeight = Math.max(1, window.innerHeight * 0.5);
    const scale = Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight, 0.0001);
    return {
      x: halfWidth + dx / scale,
      y: halfHeight + dy / scale
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
        this.clearTarget(this.isHyperdrive ? "hyperdrive cancelled" : "autopilot cancelled");
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
    const phase = this.state.autopilotPhase;
    if (phase === "warping") return false;
    const isFlightKey = action === "throttleUp" || action === "throttleDown" ||
      action === "maxSpeed" || action === "stopSpeed" ||
      this.isManualControlAction(action);
    if (!isFlightKey) return false;
    if (phase === "stopping" || phase === "aligning" || phase === "cooldown") return true;
    return action !== "rollLeft" && action !== "rollRight";
  }

  onKeyDown(event) {
    if (event.target instanceof HTMLInputElement) return;
    if (this.state.phase !== "running") return;

    const action = this.getActionForCode(event.code);
    if (!action) return;

    this.activeActions.add(action);

    if (this.state.autopilotPhase !== null && this.shouldAutopilotCancelOnKey(action)) {
      this.clearTarget(this.isHyperdrive ? "hyperdrive cancelled" : "autopilot cancelled");
    }

    if (action === "throttleUp" || action === "throttleDown") {
      event.preventDefault();
    } else if (action === "maxSpeed") {
      event.preventDefault();
      if (this.state.autopilotPhase === null) this.setSpeed(this.shipStats.maxSpeed);
    } else if (action === "stopSpeed") {
      event.preventDefault();
      if (this.state.autopilotPhase === null) this.setSpeed(0);
    } else if (action === "cameraToggle") {
      event.preventDefault();
      if (!event.repeat) {
        if (this.cameraContext === "target") {
          this.exitTargetCameraMode();
        } else {
          this.requestCameraToggle();
        }
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
    this.applyRenderResolutionSettings();
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
      window.removeEventListener("pagehide", this.boundEvents.pagehide);
      document.removeEventListener("visibilitychange", this.boundEvents.visibilitychange);
      this.boundEvents = null;
    }

    this.ui.dispose();
    this.targetingOverlay.dispose();
    this.worldMapManager.dispose();
    this.soundManager.dispose();
    this.resourceManager.dispose();
    this.shipVisualManager?.disposeShipState(this.playerShipVisualState);
    this.shipVisualManager?.dispose();
    this.hyperdriveWarpLayer?.dispose();
    this.renderPipeline?.dispose();
    if (this.shipReflectionTexture) {
      this.shipReflectionTexture.dispose();
      this.shipReflectionTexture = null;
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function maxAbsComponent(vector) {
  return Math.max(Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z));
}
