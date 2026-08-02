import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { BloomRenderPipeline } from "./BloomRenderPipeline.js";
import { BetaSpaceManager } from "./BetaSpaceManager.js";
import { DialogueManager } from "./DialogueManager.js";
import { HyperdriveWarpLayer } from "./HyperdriveWarpLayer.js";
import { CONFIG, CONTROL_SETTINGS, DEFAULT_KEY_BINDINGS, KEY_BINDING_GROUPS } from "./config.js";
import { MinimapManager } from "./MinimapManager.js";
import {
  ManualMovementSettlementTracker,
  isManualMovementActive
} from "./manualMovementSettlement.js";
import { deriveMovementState } from "./navigationKinematics.js";
import { OnlinePresenceClient } from "./OnlinePresenceClient.js";
import { RemotePlayerManager } from "./RemotePlayerManager.js";
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
  normalizeStylizedRenderMode,
  normalizePerformanceSettings
} from "./definitions/environmentDefinitions.js";
import { WORLD_CONFIG } from "./worldDefinitions.js";
import { createI18n } from "./i18n/i18n.js";

// Touch devices have far less GPU/thermal headroom, so cap the render resolution and
// frame rate there. Desktop keeps full pixel ratio and uncapped (vsync-bound) frames.
const IS_MOBILE_DEVICE = typeof window !== "undefined"
  && ((typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches)
    || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ""));
const DESKTOP_MAX_PIXEL_RATIO = 2;
const MOBILE_MAX_PIXEL_RATIO = 1.25;
const MAX_PIXEL_RATIO = IS_MOBILE_DEVICE ? MOBILE_MAX_PIXEL_RATIO : DESKTOP_MAX_PIXEL_RATIO;
const MOBILE_FRAME_CAP_FPS = 40;
const FRAME_INTERVAL_MS = IS_MOBILE_DEVICE ? 1000 / MOBILE_FRAME_CAP_FPS : 0;

// The ship's local fill/rim/engine lights illuminate ONLY the ship — confined to this
// dedicated light layer so they don't spill onto nearby world objects (which would show as
// hotspots, especially with the flat MeshToon cell tones). Global scene lights stay on
// layer 0 and still light both the ship and the world. (Bloom uses layer 1.)
const SHIP_LOCAL_LIGHT_LAYER = 3;

const LIGHTING_SETTINGS = {
  ship: {
    reflectionIntensity: 0.9,
    roughnessOffset: 0.02,
    fillLight: { color: 0xe8f7ff, intensity: 2, distance: 44, position: [0, 2.2, -2] },
    rimLight: { color: 0x8fdcff, intensity: 2, distance: 48, position: [-3.5, 1.2, 3.5] }
  }
};

const COMBAT_SLOT_TYPES = ["weapon", "shield", "equipment"];
const DAMAGE_TYPES = ["kinetic", "thermal", "energy", "beta"];
const DEFAULT_CHARACTER_ID = "default";
// Designated display sizes (longest-axis, in world units). normalizeModel fits every ship's
// longest axis to SHIP_DISPLAY_SIZE; the docking hangar is sized 32× ship_01 for absolute scale.
const SHIP_DISPLAY_SIZE = 6;
const DOCK_INTERIOR_SIZE = SHIP_DISPLAY_SIZE * 32;
const EMPTY_COMBAT_BASE_STATS = {
  processing_capacity: 0,
  power_capacity: 0,
  power_recharge: 0,
  cargo_capacity: 0,
  evasion: 0,
  hull_capacity: 0,
  hull_recharge_base: 0
};

const RENDERER_TONE_MAPPINGS = {
  acesFilmic: THREE.ACESFilmicToneMapping,
  neutral: THREE.NeutralToneMapping ?? THREE.LinearToneMapping,
  linear: THREE.LinearToneMapping,
  none: THREE.NoToneMapping
};

function requireDefinitionMap(gameData, key) {
  const definitions = gameData?.[key];
  if (!definitions || Object.keys(definitions).length === 0) {
    throw new Error(`Game data is missing ${key}.`);
  }
  return definitions;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clampRatio(value) {
  return Math.max(0, Math.min(1, numberOrZero(value)));
}

function resolveDefaultShipId(gameData, shipDefinitions) {
  if (gameData?.defaultShipId && shipDefinitions[gameData.defaultShipId]) return gameData.defaultShipId;
  if (shipDefinitions.ship_01) return "ship_01";
  return Object.keys(shipDefinitions)[0];
}

export class GameManager {
  constructor({
    root,
    gameData = null,
    identity = null,
    onlineApi = null,
    playerState = null,
    navigationState = null,
    worldBootstrap = null
  }) {
    if (!gameData) throw new Error("GameManager requires loaded gameData.");
    if (!onlineApi || !playerState) throw new Error("GameManager requires server player state.");
    if (!navigationState) throw new Error("GameManager requires server navigation state.");
    if (!worldBootstrap) throw new Error("GameManager requires a server world bootstrap.");

    this.root = root;
    this.gameData = gameData;
    this.identity = identity;
    this.onlineApi = onlineApi;
    this.worldBootstrap = worldBootstrap;
    this.config = CONFIG;
    this.worldConfig = gameData.worldConfig || WORLD_CONFIG;
    this.buildingDefinitions = requireDefinitionMap(gameData, "buildingDefinitions");
    this.itemDefinitions = requireDefinitionMap(gameData, "itemDefinitions");
    this.resourceDefinitions = requireDefinitionMap(gameData, "resourceDefinitions");
    this.shipDefinitions = requireDefinitionMap(gameData, "shipDefinitions");
    this.defaultShipId = resolveDefaultShipId(gameData, this.shipDefinitions);
    this.weaponDefinitions = gameData.weaponDefinitions || {};
    this.shieldDefinitions = gameData.shieldDefinitions || {};
    this.equipmentDefinitions = gameData.equipmentDefinitions || {};
    this.combatCompatibilityDefinitions = gameData.combatCompatibilityDefinitions || {};
    this.playerShipLoadouts = this.createInitialPlayerShipLoadouts(gameData.playerShipLoadouts);
    this.ownedEquipmentDefinitions = this.createInitialOwnedEquipmentDefinitions(
      gameData.ownedEquipmentDefinitions || gameData.playerOwnedEquipmentDefinitions
    );
    this.characterId = identity?.characterId || DEFAULT_CHARACTER_ID;
    this.playerAssets = null;
    this.activeShipUid = null;
    this.shipCombatSummaries = this.buildShipCombatSummaries();
    this.keyBindingStorageKey = "beta-void-key-bindings";
    this.keyBindings = this.loadKeyBindings();
    this.environmentMode = ENVIRONMENT_MODES.light;
    this.performanceSettings = { ...DEFAULT_PERFORMANCE_SETTINGS };
    this.i18n = createI18n({ messages: gameData?.messages });
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
    this.pendingNavigationCommand = null;

    this.miningSession = null;          // { logId, nodeId, storageId } while gathering, else null
    this.miningAligning = null;         // { nodeId, storageId, targetPos, committing } during pre-mining alignment
    this._miningBusy = false;
    this._miningVisAccumMs = 0;
    this._lastGatherDerive = null;

    this.activeActions = new Set();
    this.clock = new THREE.Clock();
    this.shipStats = { ...this.getShipSpecs(this.defaultShipId) };
    this.shipCombatStats = this.getShipCombatSummary(this.defaultShipId);
    this.fittingPreview = null;
    this.ui = new UIManager({
      config: this.config,
      shipStats: this.shipStats,
      shipDefinitions: this.shipDefinitions,
      shipCombatSummaries: this.shipCombatSummaries,
      weaponDefinitions: this.weaponDefinitions,
      shieldDefinitions: this.shieldDefinitions,
      equipmentDefinitions: this.equipmentDefinitions,
      combatCompatibilityDefinitions: this.combatCompatibilityDefinitions,
      defaultShipId: this.defaultShipId,
      i18n: this.i18n,
      keyBindings: this.keyBindings,
      keyBindingGroups: KEY_BINDING_GROUPS,
      defaultKeyBindings: DEFAULT_KEY_BINDINGS
    });
    this.dialogue = new DialogueManager({
      i18n: this.i18n,
      dialogueDefinitions: gameData.dialogueDefinitions || { speakers: {}, dialogues: {} },
      assetBaseUrl: new URL("../", gameData.baseUrl).href
    });
    this.messageDefinitions = gameData.messageDefinitions || { messages: {} };
    this.inboxState = null;
    this.resourceManager = new ResourceManager({
      onChange: (snapshot) => this.ui.setResourceProgress(snapshot)
    });
    this.soundManager = new SoundManager(this.resourceManager, {
      audioRegistry: gameData.assetRegistry?.audio,
      assetBaseUrl: new URL("../", gameData.baseUrl).href
    });
    this.unknownNavigationCommands = new Set();
    this.worldDataManager = new WorldDataManager({
      config: this.worldConfig,
      gameData,
      onlineApi,
      onNavigationCommandStatus: (feedback) => this.handleNavigationCommandStatus(feedback),
      playerState,
      navigationState,
      worldBootstrap
    });
    this.betaSpaceManager = new BetaSpaceManager({
      worldConfig: this.worldConfig
    });
    this.betaSpaceSession = null;
    this.betaSpaceExitPending = false;
    this.worldMapManager = null;
    this.minimapManager = null;
    this.remotePlayerManager = null;
    this.presenceClient = new OnlinePresenceClient({
      identity: onlineApi.identity,
      onMessage: (message) => this.remotePlayerManager?.handlePresenceMessage(message),
      onStateChange: (state) => {
        if (state === "disconnected") this.remotePlayerManager?.replacePresencePeers([]);
      }
    });
    this.presenceZoneId = null;
    this.presenceRouteSignature = null;
    this.presenceSequence = 0;
    this.manualSettlementTracker = new ManualMovementSettlementTracker();
    this.fieldShipRefreshInterval = 5 * 60 * 1000;
    this.fieldShipLastRefreshedAt = 0;
    this.fieldShipRefreshPending = false;
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

    // Docking is a deterministic ship state (persisted in playerShip meta), rendered
    // as a local-only presentational scene (NOT a world/MO field). dockingState !== null
    // means the ship is docked; on reconnect the persisted state reproduces the docking scene.
    this.dockingState = null;
    this.dockingScene = null;
    this.dockingPivot = new THREE.Vector3(0, 0, 0);
    this.dockingOrbitTarget = new THREE.Quaternion();
    this.dockingControl = { dragging: false, pointerId: null, lastX: 0, lastY: 0, orbitDistance: 40 };
    this._shipReturnParent = null;
    this.dockProximityRange = 150; // render-units; dock affordance proximity threshold
    this.dockInteriorObject = null;
    this._dockInteriorPending = false;
    this._stationBloomTargets = []; // station meshes registered with the bloom pipeline while docked
    this.dockingCameraFocus = new THREE.Vector3(); // camera orbit center (the docked ship's center)
    this.dockCutscene = null;            // active dock cutscene state, or null
    this._dockCutscenePending = false;   // set by dock() (space→station); consumed on scene enter
    this._enterWithCutscene = false;
    this.dockHangarMixer = null;
    this.dockShipMixer = null;
    this.dockLandingAction = null;
    this.shipAnimationClips = [];         // ship model's animation clips (e.g. anim_landing)
    // Fixed docking placement offsets, measured from the LANDED pose (gear deployed), so the
    // cutscene approach and the resting placement share one basis (no gear-state drift).
    this.dockBottomOffset = null;
    this.dockCenterOffset = null;

    this.starLayers = [];
    this.dockStarLayers = []; // static star backdrop for the docking scene (centered on the station pivot)
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
    this.betaVoidLifecycleInterval = 5 * 60 * 1000;
    this.playerShipSavePendingCount = 0;
    this._lastFrameTimestamp = 0;
    this._frameIntervalMs = FRAME_INTERVAL_MS;
    this._lastRenderAt = 0;
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
    this.selectedShipId = this.defaultShipId;
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
      onEnterBetaSpace: (object) => this.enterBetaSpaceFromUi(object),
      onExitBetaSpace: () => this.exitBetaSpace({ reason: "manual" }),
      onDock: (station) => void this.dock(station),
      onUndock: () => void this.undock(),
      onGetDockState: (stationId) => this.getDockState(stationId),
      onGetBuildingStorage: (buildingId) => this.getBuildingStorageView(buildingId),
      onTradeAtStation: (buildingId, itemId, direction, amount) => this.tradeAtDockedStation(itemId, direction, amount),
      onToggleCameraMode: () => this.requestCameraToggle(),
      onOpenMinimap: () => this.minimapManager?.open(),
      onOpenFittingSimulator: ({ canvas, shipId, mode }) => void this.openFittingPreview({ canvas, shipId, mode }),
      onCloseFittingSimulator: () => this.closeFittingPreview(),
      onBuildFittingSummary: (shipId, overrides) => this.calculateShipCombatSummary(shipId, overrides),
      onGetFittingCandidates: (context) => this.getFittingCandidatesForSlot(context),
      onCheckEquipmentOwned: (type, definitionId) => this.isEquipmentDefinitionOwned(type, definitionId),
      onApplyShipLoadoutChange: (change) => this.applyShipLoadoutChange(change),
      onRefreshPlayerAssets: () => this.runExclusiveAssetMutation(() => this.loadPlayerAssets()),
      onGetActiveShipCargo: () => this.getActiveShipCargoListView(),
      onGatherWorldObject: (object) => this.startGatheringAtObject(object),
      onStopGatherWorldObject: (object) => void this.stopGatheringAtObject(object),
      onStopGathering: () => void this.stopGatheringControl(),
      onGetGatherState: (objectId) => this.getGatherState(objectId),
      onPlayerProfileNameChange: (displayName) => this.updatePlayerDisplayName(displayName),
      onRequestInbox: () => this.getInboxView(),
      onOpenMessage: (messageId) => this.openMessage(messageId)
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
    await this.loadInbox();
    this.ui.setInboxState(this.getInboxView());
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
      worldConfig: this.worldConfig,
      renderScale: this.worldConfig.renderScale,
      renderResolutionScale: this.getRenderResolutionScale(),
      environmentVisuals: preset.worldMap,
      buildingDefinitions: this.buildingDefinitions,
      resourceDefinitions: this.resourceDefinitions,
      assetRegistry: this.gameData.assetRegistry,
      assetBaseUrl: new URL("../", this.gameData.baseUrl).href,
      registerStylizedRenderTarget: (object) => {
        this.renderPipeline?.registerStylizedRenderTarget(object);
      },
      unregisterStylizedRenderTarget: (object) => {
        this.renderPipeline?.unregisterStylizedRenderTarget(object);
      },
      onRenderMutation: () => this.renderPipeline?.markTargetsDirty()
    });
    this.worldMapManager.setChunkBoundsMode(this.worldViewSettings.chunkBoundsMode);
    this.minimapManager = new MinimapManager({
      gameData: this.gameData,
      worldDataManager: this.worldDataManager,
      i18n: this.i18n,
      getShipDataPosition: () => (this.worldMapManager && this.ship ? this.getPlayerDataPosition() : null),
      getEnvironmentMode: () => this.environmentMode,
      onVisibilityChange: (visible) => this.ui.setMinimapExpanded(visible),
      onSelectObject: (object) => this.selectWorldObjectFromMinimap(object),
      onShowObjectDetail: (ref) => this.showObjectDetailFromMinimap(ref)
    });
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
    const nextPerformanceSettings = normalizePerformanceSettings(saved?.performanceSettings);
    this.environmentMode = nextMode;
    this.performanceSettings = nextPerformanceSettings;
    this.applyEnvironmentPreset(this.getEnvironmentPreset(nextMode));
    this.applyPerformanceSettingsToRuntime();
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

  async loadInbox() {
    let saved = null;
    if (this.worldDataManager.db) {
      try {
        saved = await this.worldDataManager.getStoreValue("settings", "messageInbox");
      } catch {
        saved = null;
      }
    }
    if (saved && Array.isArray(saved.items)) {
      this.inboxState = { items: saved.items };
      return;
    }
    // First start (no persisted inbox): receive the catalog's messages, all unread.
    this.inboxState = { items: this.createInitialInboxItems() };
    await this.saveInbox();
  }

  createInitialInboxItems() {
    const now = Date.now();
    return Object.keys(this.messageDefinitions.messages || {}).map((messageId) => ({
      messageId,
      read: false,
      receivedAt: now
    }));
  }

  async saveInbox() {
    if (!this.worldDataManager.db) return;
    try {
      await this.worldDataManager.putStoreValue("settings", {
        key: "messageInbox",
        items: this.inboxState?.items || []
      });
    } catch {
      this.ui.showErrorToast("settings storage unavailable");
    }
  }

  getInboxView() {
    const items = this.inboxState?.items || [];
    return items
      .filter((item) => this.messageDefinitions.messages?.[item.messageId])
      .map((item) => {
        const definition = this.messageDefinitions.messages[item.messageId];
        return {
          messageId: item.messageId,
          title: this.i18n.t(definition.title_id),
          sender: this.dialogue.resolveSpeaker(definition.sender),
          read: item.read === true,
          receivedAt: item.receivedAt || 0
        };
      })
      .sort((a, b) => b.receivedAt - a.receivedAt);
  }

  openMessage(messageId) {
    const definition = this.messageDefinitions.messages?.[messageId];
    if (!definition) return;

    const item = (this.inboxState?.items || []).find((entry) => entry.messageId === messageId);
    if (item && !item.read) {
      item.read = true;
      void this.saveInbox();
    }

    this.ui.setInboxState(this.getInboxView());
    this.ui.closeMessageInbox();
    if (definition.dialogue_id) this.dialogue.play(definition.dialogue_id);
  }

  applyPerformanceSettingsToRuntime() {
    this.renderPipeline?.setObjectBloomSettings(this.getObjectBloomSettings());
    this.renderPipeline?.setStylizedRenderMode(this.performanceSettings.stylizedRenderMode);
    this.renderPipeline?.setRenderResolutionScale(this.getRenderResolutionScale());
    this.applyMaterialMapPerformanceSettings();
    this.applyLightingPerformanceSettings();
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
    const worldMeta = await this.worldDataManager.getStoreValue("meta", "world");
    if (!worldMeta || worldMeta.data_source_key !== this.worldDataManager.dataSourceKey) {
      this.selectedShipId = this.defaultShipId;
      this._applyShipSpecs(this.selectedShipId);
      this.ui.setSelectedShipId(this.selectedShipId);
      return;
    }
    const saved = await this.worldDataManager.getStoreValue("settings", "shipSettings");
    const shipId = saved?.selectedShipId;
    this.selectedShipId = (shipId && this.shipDefinitions[shipId]) ? shipId : this.defaultShipId;
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
    Object.assign(this.shipStats, this.getShipSpecs(shipId));
    this.shipCombatStats = this.getShipCombatSummary(shipId);
    this.ui.refreshSpeedGaugeRange();
  }

  getShipDefinition(shipId) {
    return this.shipDefinitions[shipId] || this.shipDefinitions[this.defaultShipId];
  }

  getShipSpecs(shipId) {
    const specs = this.getShipDefinition(shipId)?.specs || {};
    return {
      ...specs,
      hyperdriveSpecs: { ...(specs.hyperdriveSpecs || {}) }
    };
  }

  async loadPlayerAssets() {
    this.playerAssets = await this.worldDataManager.loadOrCreatePlayerAssets(this.characterId);
    this.activeShipUid = this.playerAssets?.profile?.active_ship_uid || null;
    // While docked the active ship lives server-side in the station's docked_ships
    // zone (not in player stores). Reconstruct an in-memory player view of it so
    // ship accessors (cargo/fitting/render/dock scene) keep working.
    await this.reconstructDockedShipIntoAssets();
    this.rebuildPlayerShipLoadoutsFromAssets();
    this.ownedEquipmentDefinitions = this.createOwnedEquipmentDefinitionsFromAssets();
    this.shipCombatSummaries = this.buildShipCombatSummaries();
    this.shipCombatStats = this.getShipCombatSummary(this.selectedShipId);
    this.ui?.setPlayerProfile(this.playerAssets?.profile || null);
    this.ui?.setPlayerShips({
      shipDefinitions: this.getOwnedShipDefinitions(),
      shipCombatSummaries: this.shipCombatSummaries,
      weaponDefinitions: this.weaponDefinitions,
      shieldDefinitions: this.shieldDefinitions,
      equipmentDefinitions: this.equipmentDefinitions,
      combatCompatibilityDefinitions: this.combatCompatibilityDefinitions,
      defaultShipId: this.defaultShipId
    });
    this.syncDockingPresentation();
  }

  // In-memory reconstruction. "Docked" is DERIVED from location: if the active ship
  // is NOT in the player namespace, it lives in some station's docked_ships zone.
  // Pull it and rebuild its player-asset view (ship located in a station_hangar +
  // cargo + fittings) so accessors/scene keep working. NOT persisted — docked_ships
  // remains the truth; deriveDockingState reads the reconstructed location.
  async reconstructDockedShipIntoAssets() {
    if (!this.playerAssets) return;
    const shipUid = this.playerAssets.profile?.active_ship_uid;
    if (!shipUid) return;
    // Active ship present in the player namespace → flying; nothing to reconstruct.
    if (this.playerAssets.uniqueItems.some((u) => u.item_uid === shipUid)) return;
    const located = await this.worldDataManager.findDockedShip(shipUid);
    if (!located) return;
    const { station_id: stationId, entry } = located;
    const now = Date.now();
    const hangarStorageId = `station-hangar-${this.characterId}-${stationId}`;
    const cargoStorageId = `storage-${shipUid}-cargo`;
    const restored = this.worldDataManager.restoreDockedShipRecords(entry, {
      activeShipStorageId: hangarStorageId, cargoStorageId, characterId: this.characterId, createdAt: now
    });
    // The ship's location while docked = a station_hangar anchored to the station.
    this.playerAssets.storageLocations.push({
      storage_id: hangarStorageId, storage_type: "station_hangar", owner_character_id: this.characterId,
      world_object_id: stationId, parent_item_uid: null, capacity: null, created_at: now, updated_at: now
    });
    restored.storageLocationsToPut.forEach((s) => this.playerAssets.storageLocations.push(s));
    restored.uniqueItemsToPut.forEach((u) => {
      if (u.item_uid === shipUid && Number.isInteger(entry.dock_slot)) u.dock_slot = entry.dock_slot;
      this.playerAssets.uniqueItems.push(u);
    });
    restored.quantityItemsToPut.forEach((e) => this.playerAssets.quantityItems.push(e));
    restored.slotAssignmentsToPut.forEach((a) => this.playerAssets.slotAssignments.push(a));
  }

  async updatePlayerDisplayName(displayName) {
    if (!this.playerAssets?.profile) return null;
    const normalizedName = this.normalizePlayerDisplayName(displayName);
    const nextProfile = await this.worldDataManager.putCharacterProfile({
      ...this.playerAssets.profile,
      display_name: normalizedName
    });
    this.playerAssets.profile = nextProfile;
    this.ui?.setPlayerProfile(nextProfile);
    return nextProfile;
  }

  normalizePlayerDisplayName(value) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    return text.slice(0, 32) || "Pilot";
  }

  getOwnedShipDefinitions() {
    if (!this.playerAssets) return this.shipDefinitions;
    const ownedShipIds = new Set(
      (this.playerAssets.uniqueItems || [])
        .filter((item) => this.getItemKind(item) === "ship" && this.shipDefinitions[item.item_id])
        .map((item) => item.item_id)
    );
    if (ownedShipIds.size === 0) return this.shipDefinitions;
    return Object.fromEntries(
      Object.entries(this.shipDefinitions).filter(([shipId]) => ownedShipIds.has(shipId))
    );
  }

  rebuildPlayerShipLoadoutsFromAssets() {
    const loadouts = this.createInitialPlayerShipLoadouts({}, { includeFactoryDefaults: false });
    const activeShip = this.getActiveShipItem();
    const shipId = activeShip?.item_id || this.selectedShipId || this.defaultShipId;
    const slotAssignments = this.getActiveShipSlotAssignments();
    const activeCombat = this.getShipDefinition(shipId)?.combat || {};

    for (const type of COMBAT_SLOT_TYPES) {
      loadouts[shipId] ??= {};
      loadouts[shipId][type] ??= {};
      for (const slot of Array.isArray(activeCombat.slots?.[type]) ? activeCombat.slots[type] : []) {
        loadouts[shipId][type][slot.id] = "";
      }
    }

    for (const assignment of slotAssignments) {
      const type = assignment.slot_type;
      const slotId = assignment.slot_id;
      if (!COMBAT_SLOT_TYPES.includes(type) || !slotId) continue;
      loadouts[shipId] ??= {};
      loadouts[shipId][type] ??= {};
      loadouts[shipId][type][slotId] = assignment.item_uid || assignment.item_id || "";
    }

    this.playerShipLoadouts = loadouts;
  }

  createOwnedEquipmentDefinitionsFromAssets() {
    const owned = Object.fromEntries(COMBAT_SLOT_TYPES.map((type) => [type, new Set()]));
    for (const item of this.playerAssets?.quantityItems || []) {
      const kind = this.getItemKind(item);
      if (!COMBAT_SLOT_TYPES.includes(kind) || !item.item_id || numberOrZero(item.quantity) <= 0) continue;
      owned[kind].add(item.item_id);
    }
    for (const item of this.playerAssets?.uniqueItems || []) {
      const kind = this.getItemKind(item);
      if (!COMBAT_SLOT_TYPES.includes(kind) || !item.item_id) continue;
      owned[kind].add(item.item_id);
    }
    for (const assignment of this.playerAssets?.slotAssignments || []) {
      if (!COMBAT_SLOT_TYPES.includes(assignment.slot_type) || !assignment.item_id) continue;
      owned[assignment.slot_type].add(assignment.item_id);
    }
    return owned;
  }

  getItemKind(item = null) {
    if (!item) return "item";
    return item.kind || item.category || this.itemDefinitions?.[item.item_id]?.kind || "item";
  }

  getActiveShipItem() {
    const activeShipUid = this.activeShipUid || this.playerAssets?.profile?.active_ship_uid;
    return (this.playerAssets?.uniqueItems || []).find((item) => item.item_uid === activeShipUid) || null;
  }

  getActiveShipStorage(type) {
    const activeShipUid = this.getActiveShipItem()?.item_uid || this.activeShipUid;
    return (this.playerAssets?.storageLocations || []).find((storage) => {
      return storage.storage_type === type && storage.parent_item_uid === activeShipUid;
    }) || null;
  }

  getActiveShipCargoStorage() {
    return this.getActiveShipStorage("ship_cargo");
  }

  getActiveShipSlotAssignments() {
    const activeShipUid = this.getActiveShipItem()?.item_uid || this.activeShipUid;
    return (this.playerAssets?.slotAssignments || []).filter((assignment) => {
      return assignment.owner_item_uid === activeShipUid && COMBAT_SLOT_TYPES.includes(assignment.slot_type);
    });
  }

  getSlotAssignmentForSlot(type, slotId) {
    return this.getActiveShipSlotAssignments().find((assignment) => {
      return assignment.slot_type === type && assignment.slot_id === slotId;
    }) || null;
  }

  getUniqueItemByUid(itemUid) {
    return (this.playerAssets?.uniqueItems || []).find((item) => item.item_uid === itemUid) || null;
  }

  parseFittingCandidateId(candidateId) {
    const value = String(candidateId || "");
    if (!value) return { mode: "empty", itemId: "", itemUid: "" };
    if (value.startsWith("qty:")) return { mode: "quantity", itemId: value.slice(4), itemUid: "" };
    const item = this.getUniqueItemByUid(value);
    if (item) return { mode: "unique", itemId: item.item_id, itemUid: item.item_uid, item };
    return { mode: "definition", itemId: value, itemUid: "" };
  }

  resolveEquippedDefinition(type, equippedValue) {
    if (!equippedValue) return { definitionId: "", item: null, definition: null };
    const parsed = this.parseFittingCandidateId(equippedValue);
    const item = parsed.mode === "unique" ? parsed.item : null;
    const definitionId = item?.item_id || parsed.itemId || "";
    const definition = this.getCombatDefinitionsForType(type)?.[definitionId] || null;
    return { definitionId, item, definition };
  }

  getItemMass(type, itemId) {
    const parsed = this.parseFittingCandidateId(itemId);
    const definitionId = parsed.itemId || itemId;
    return numberOrZero(this.itemDefinitions?.[definitionId]?.mass);
  }

  getRuntimeItemDefinition(category, itemId) {
    if (this.itemDefinitions?.[itemId]) return this.itemDefinitions[itemId];
    if (category === "ship") return this.shipDefinitions[itemId] || null;
    if (COMBAT_SLOT_TYPES.includes(category)) return this.getCombatDefinitionsForType(category)?.[itemId] || null;
    return this.itemDefinitions?.[itemId] || null;
  }

  buildItemListView(storageId, { capacity = null } = {}) {
    const storage = (this.playerAssets?.storageLocations || []).find((item) => item.storage_id === storageId) || null;
    const rows = [];

    for (const item of this.playerAssets?.quantityItems || []) {
      if (item.storage_id !== storageId) continue;
      const definition = this.getRuntimeItemDefinition(this.getItemKind(item), item.item_id);
      const unitMass = numberOrZero(definition?.mass);
      const quantity = numberOrZero(item.quantity);
      if (quantity <= 0) continue;
      rows.push({
        row_id: item.entry_id || `qty:${storageId}:${item.item_id}`,
        row_type: "quantity",
        item_id: item.item_id,
        item_uid: null,
        quantity,
        storage_id: storageId,
        category: this.getItemKind(item),
        unit_mass: unitMass,
        total_mass: unitMass * quantity
      });
    }

    for (const item of this.playerAssets?.uniqueItems || []) {
      if (item.storage_id !== storageId) continue;
      const kind = this.getItemKind(item);
      const definition = this.getRuntimeItemDefinition(kind, item.item_id);
      const unitMass = numberOrZero(definition?.mass);
      rows.push({
        row_id: `unique:${item.item_uid}`,
        row_type: "unique",
        item_id: item.item_id,
        item_uid: item.item_uid,
        quantity: 1,
        storage_id: storageId,
        category: kind,
        unit_mass: unitMass,
        total_mass: unitMass,
        fixed_options: item.fixed_options || {}
      });
    }

    const usedCapacity = rows.reduce((total, row) => total + numberOrZero(row.total_mass), 0);
    const resolvedCapacity = capacity ?? storage?.capacity ?? null;
    return {
      scope: {
        type: "storage",
        storage_id: storageId
      },
      storage_type: storage?.storage_type || null,
      capacity: resolvedCapacity,
      used_capacity: usedCapacity,
      rows
    };
  }

  getStorageUsedCapacity(storageId) {
    if (!storageId) return 0;
    let used = 0;
    for (const item of this.playerAssets?.quantityItems || []) {
      if (item.storage_id !== storageId) continue;
      const quantity = numberOrZero(item.quantity);
      if (quantity <= 0) continue;
      const definition = this.getRuntimeItemDefinition(this.getItemKind(item), item.item_id);
      used += numberOrZero(definition?.mass) * quantity;
    }
    for (const item of this.playerAssets?.uniqueItems || []) {
      if (item.storage_id !== storageId) continue;
      const definition = this.getRuntimeItemDefinition(this.getItemKind(item), item.item_id);
      used += numberOrZero(definition?.mass);
    }
    return used;
  }

  getCargoStatus(summary = this.getShipCombatSummary(this.selectedShipId)) {
    const cargoStorageId = this.getActiveShipCargoStorage()?.storage_id || null;
    const used = this.getStorageUsedCapacity(cargoStorageId);
    return {
      storage_id: cargoStorageId,
      used,
      capacity: numberOrZero(summary?.stats?.cargo_capacity)
    };
  }

  getActiveShipCargoListView() {
    const cargoStorage = this.getActiveShipCargoStorage();
    const summary = this.getShipCombatSummary(this.selectedShipId);
    if (!cargoStorage) {
      return {
        scope: { type: "storage", storage_id: null },
        storage_type: "ship_cargo",
        capacity: 0,
        used_capacity: 0,
        rows: []
      };
    }
    const view = this.buildItemListView(cargoStorage.storage_id, {
      capacity: numberOrZero(summary?.stats?.cargo_capacity)
    });
    return {
      ...view,
      rows: view.rows
        .map((row) => ({
          ...row,
          kind: row.category,
          display_name: this.getInventoryItemDisplayName(row.category, row.item_id)
        }))
        .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)) || String(a.item_id).localeCompare(String(b.item_id)))
    };
  }

  getInventoryItemDisplayName(kind, itemId) {
    const domainDefinition = COMBAT_SLOT_TYPES.includes(kind)
      ? this.getCombatDefinitionsForType(kind)?.[itemId]
      : kind === "ship"
        ? this.shipDefinitions?.[itemId]
        : null;
    const definition = domainDefinition || this.itemDefinitions?.[itemId] || { id: itemId };
    return this.i18n.resolveDefinitionText(definition, "name", definition.name || itemId || "Item");
  }

  createInitialPlayerShipLoadouts(source = {}, { includeFactoryDefaults = true } = {}) {
    const loadouts = {};
    for (const [shipId, ship] of Object.entries(this.shipDefinitions || {})) {
      loadouts[shipId] = {};
      const combat = ship?.combat || {};
      for (const type of COMBAT_SLOT_TYPES) {
        const sourceSlots = source?.[shipId]?.[type] || {};
        loadouts[shipId][type] = {};
        for (const slot of Array.isArray(combat.slots?.[type]) ? combat.slots[type] : []) {
          const hasSourceValue = Object.prototype.hasOwnProperty.call(sourceSlots, slot.id);
          const factoryDefault = includeFactoryDefaults ? slot.equipped_id || "" : "";
          loadouts[shipId][type][slot.id] = hasSourceValue ? sourceSlots[slot.id] || "" : factoryDefault;
        }
      }
    }
    return loadouts;
  }

  createInitialOwnedEquipmentDefinitions(source = null) {
    const owned = Object.fromEntries(COMBAT_SLOT_TYPES.map((type) => [type, new Set()]));
    for (const type of COMBAT_SLOT_TYPES) {
      this.addOwnedEquipmentSource(owned[type], source?.[type]);
    }
    for (const shipLoadout of Object.values(this.playerShipLoadouts || {})) {
      for (const type of COMBAT_SLOT_TYPES) {
        Object.values(shipLoadout?.[type] || {}).forEach((definitionId) => {
          if (definitionId) owned[type].add(definitionId);
        });
      }
    }
    return owned;
  }

  addOwnedEquipmentSource(target, source) {
    if (!target || !source) return;
    if (source instanceof Set || Array.isArray(source)) {
      source.forEach((definitionId) => {
        if (definitionId) target.add(definitionId);
      });
      return;
    }
    if (typeof source !== "object") return;
    for (const [definitionId, value] of Object.entries(source)) {
      if (value !== false && value != null) target.add(definitionId);
    }
  }

  ensurePlayerShipLoadout(shipId) {
    if (!this.playerShipLoadouts[shipId]) {
      this.playerShipLoadouts[shipId] = this.createInitialPlayerShipLoadouts({}, {
        includeFactoryDefaults: !this.playerAssets
      })[shipId] || {};
    }
    for (const type of COMBAT_SLOT_TYPES) {
      if (!this.playerShipLoadouts[shipId][type]) this.playerShipLoadouts[shipId][type] = {};
    }
    return this.playerShipLoadouts[shipId];
  }

  getPlayerShipLoadoutSlot(shipId, type, slotId, fallback = "") {
    const loadoutSlots = this.playerShipLoadouts?.[shipId]?.[type] || {};
    return Object.prototype.hasOwnProperty.call(loadoutSlots, slotId) ? loadoutSlots[slotId] || "" : fallback || "";
  }

  isEquipmentDefinitionOwned(type, definitionId) {
    if (!definitionId) return false;
    if (this.playerAssets) {
      if ((this.playerAssets.quantityItems || []).some((item) => {
        return this.getItemKind(item) === type && item.item_id === definitionId && numberOrZero(item.quantity) > 0;
      })) return true;
      if ((this.playerAssets.uniqueItems || []).some((item) => {
        return this.getItemKind(item) === type && item.item_id === definitionId;
      })) return true;
      return (this.playerAssets.slotAssignments || []).some((assignment) => {
        return assignment.slot_type === type && assignment.item_id === definitionId;
      });
    }
    return this.ownedEquipmentDefinitions?.[type]?.has(definitionId) || false;
  }

  getCombatSlotDefinition(shipId, type, slotId) {
    const combat = this.getShipDefinition(shipId)?.combat || {};
    return (Array.isArray(combat.slots?.[type]) ? combat.slots[type] : []).find((slot) => slot.id === slotId) || null;
  }

  isDefinitionCompatibleWithSlot(type, slot, definition) {
    if (!slot || !definition) return false;
    const preset = this.combatCompatibilityDefinitions?.compatibilityPresets?.[type]?.[slot.compatibility_preset_id];
    const presetIds = Array.isArray(preset?.compatible_ids) ? new Set(preset.compatible_ids) : null;
    const allowedSizes = this.combatCompatibilityDefinitions?.sizeCompatibility?.[slot.size] || [slot.size];
    return (!presetIds || presetIds.has(definition.id)) && allowedSizes.includes(definition.size);
  }

  canEquipDefinitionToShipSlot(shipId, type, slotId, definitionId, { requireOwned = true } = {}) {
    const slot = this.getCombatSlotDefinition(shipId, type, slotId);
    if (!slot) return false;
    if (!definitionId) return true;
    const definition = this.getCombatDefinitionsForType(type)?.[definitionId];
    if (!definition) return false;
    if (requireOwned && !this.isEquipmentDefinitionOwned(type, definitionId)) return false;
    return this.isDefinitionCompatibleWithSlot(type, slot, definition);
  }

  runExclusiveAssetMutation(task) {
    const previous = this._assetMutationChain || Promise.resolve();
    const resultPromise = previous.then(() => task());
    this._assetMutationChain = resultPromise.then(() => {}, () => {});
    return resultPromise;
  }

  async syncPlayerAssetsToServer(reason) {
    try {
      await this.worldDataManager.syncPlayerAssets(this.characterId, reason);
      return true;
    } catch (error) {
      await this.recoverServerPlayerState(error);
      return false;
    }
  }

  async recoverServerPlayerState(error) {
    try {
      await this.worldDataManager.refreshPlayerState();
      await this.loadPlayerAssets();
    } catch (refreshError) {
      console.error("[player-state] recovery failed.", refreshError);
    }
    this.ui.showErrorToast(error?.code === "PLAYER_STATE_CONFLICT"
      ? "player state changed in another session"
      : "player state sync failed");
  }

  applyShipLoadoutChange(change) {
    // While docked the active ship lives server-side in the station's docked_ships
    // zone; the in-memory view is read-only. Block asset changes (refit/cargo) so
    // they can't desync from the authoritative dock-moment snapshot. (Even a forced
    // player-store write can't corrupt it: docked_ships is the SSoT, re-asserted on
    // next load. Docked-change write-back is a future feature.)
    if (this.isDocked()) {
      this.ui?.showToast?.(this.ui?.t?.("ui.fitting.dockedLocked", "정박 중에는 함선을 변경할 수 없습니다") || "정박 중에는 함선을 변경할 수 없습니다");
      return Promise.resolve({ status: "blocked", toast: "docked" });
    }
    return this.runExclusiveAssetMutation(() => this._applyShipLoadoutChange(change));
  }

  async _applyShipLoadoutChange(change) {
    const { shipId, type } = change;
    if (!COMBAT_SLOT_TYPES.includes(type)) return null;

    // The decision is made from the data the transaction reads (not this.playerAssets),
    // so it stays correct even if another tab mutated the assets in the meantime.
    let outcome = { status: "invalid" };
    try {
      await this.worldDataManager.runPlayerAssetMutation(this.characterId, (assets) => {
        const previousAssets = this.playerAssets;
        this.playerAssets = assets;
        try {
          outcome = this._buildLoadoutMutation(change);
        } finally {
          this.playerAssets = previousAssets;
        }
        return outcome.status === "ok" ? outcome.mutation : null;
      });
    } catch (error) {
      await this.recoverServerPlayerState(error);
      return null;
    }

    if (outcome.status === "ok") {
      await this.loadPlayerAssets();
      const summary = this.getShipCombatSummary(shipId);
      this.ui?.showToast(outcome.installed ? "installed" : "unequipped");
      return summary;
    }
    if (!this.playerAssets) await this.loadPlayerAssets();
    if (outcome.status === "error") {
      this.ui.showErrorToast(outcome.toast);
      return null;
    }
    if (outcome.status === "noop") return this.getShipCombatSummary(shipId);
    return null;
  }

  // Pure, synchronous: validates and builds the loadout mutation against the
  // currently-installed this.playerAssets (which the caller sets to the freshly
  // read transaction data). Returns a structured outcome; performs no IO/UI so it
  // is safe to run inside an IndexedDB transaction callback.
  _buildLoadoutMutation({ shipId, type, slotId, equippedId }) {
    const cargoStorage = this.getActiveShipCargoStorage();
    const activeShip = this.getActiveShipItem();
    if (!cargoStorage || !activeShip) return { status: "invalid" };

    const slot = this.getCombatSlotDefinition(shipId, type, slotId);
    if (!slot) return { status: "invalid" };

    const currentAssignment = this.getSlotAssignmentForSlot(type, slotId);
    const currentUniqueItem = currentAssignment?.item_uid ? this.getUniqueItemByUid(currentAssignment.item_uid) : null;
    const currentDefinitionId = currentUniqueItem?.item_id || currentAssignment?.item_id || "";
    const target = this.resolveFittingSelection(equippedId, cargoStorage.storage_id);
    if (equippedId && !target) return { status: "error", toast: "item not found" };
    if (target?.mode === "unique" && target.item?.storage_id !== cargoStorage.storage_id) {
      return { status: "error", toast: "item is not in cargo" };
    }
    if (target?.mode === "quantity" && numberOrZero(target.quantityEntry?.quantity) <= 0) {
      return { status: "error", toast: "item is not in cargo" };
    }
    if (target?.mode === "definition") return { status: "error", toast: "item is not in cargo" };
    if (target?.mode === "unique" && currentAssignment?.item_uid === target.itemUid) return { status: "noop" };
    if (target?.mode === "quantity" && !currentAssignment?.item_uid && currentDefinitionId === target.itemId) {
      return { status: "noop" };
    }
    if (!target && !currentAssignment) return { status: "noop" };

    const targetDefinitionId = target?.itemId || "";
    if (!this.canEquipDefinitionToShipSlot(shipId, type, slotId, targetDefinitionId, { requireOwned: false })) {
      return { status: "error", toast: "incompatible item" };
    }

    const currentCargoUsed = this.getStorageUsedCapacity(cargoStorage.storage_id);
    const targetMass = targetDefinitionId ? this.getItemMass(type, targetDefinitionId) : 0;
    const currentMass = currentDefinitionId ? this.getItemMass(type, currentDefinitionId) : 0;
    const nextCargoUsed = currentCargoUsed - targetMass + currentMass;
    const previewSummary = this.calculateShipCombatSummary(shipId, {
      [`${type}:${slotId}`]: targetDefinitionId
    });
    const nextCargoCapacity = numberOrZero(previewSummary?.stats?.cargo_capacity);
    if (nextCargoUsed > nextCargoCapacity) {
      return { status: "error", toast: "cargo capacity exceeded" };
    }

    const now = Date.now();
    const quantityItemsToPut = new Map();
    const quantityItemIdsToDelete = new Set();
    const uniqueItemsToPut = [];
    const slotAssignmentsToPut = [];
    const slotAssignmentIdsToDelete = new Set();
    const adjustQuantity = (storageId, itemId, delta) => {
      const entryId = `qty-${storageId}-${itemId}`;
      const source = quantityItemsToPut.get(entryId)
        || (this.playerAssets.quantityItems || []).find((item) => item.entry_id === entryId)
        || this.worldDataManager.createQuantityItemEntry({ storageId, itemId, quantity: 0, createdAt: now });
      const next = {
        ...source,
        storage_id: storageId,
        item_id: itemId,
        kind: this.itemDefinitions?.[itemId]?.kind || source.kind || type,
        quantity: numberOrZero(source.quantity) + delta,
        updated_at: now
      };
      if (next.quantity <= 0) {
        quantityItemsToPut.delete(entryId);
        quantityItemIdsToDelete.add(entryId);
        return;
      }
      quantityItemIdsToDelete.delete(entryId);
      quantityItemsToPut.set(entryId, next);
    };

    if (currentAssignment) {
      slotAssignmentIdsToDelete.add(currentAssignment.assignment_id);
      if (currentUniqueItem) {
        uniqueItemsToPut.push({
          ...currentUniqueItem,
          storage_id: cargoStorage.storage_id,
          parent_item_uid: activeShip.item_uid,
          updated_at: now
        });
      } else if (currentDefinitionId) {
        adjustQuantity(cargoStorage.storage_id, currentDefinitionId, 1);
      }
    }

    if (target) {
      if (target.mode === "unique") {
        uniqueItemsToPut.push({
          ...target.item,
          storage_id: null,
          parent_item_uid: activeShip.item_uid,
          updated_at: now
        });
        slotAssignmentsToPut.push(this.createSlotAssignmentForMutation({
          ownerItemUid: activeShip.item_uid,
          slotType: type,
          slotId,
          itemId: target.itemId,
          itemUid: target.itemUid,
          now
        }));
      } else if (target.mode === "quantity") {
        adjustQuantity(cargoStorage.storage_id, target.itemId, -1);
        slotAssignmentsToPut.push(this.createSlotAssignmentForMutation({
          ownerItemUid: activeShip.item_uid,
          slotType: type,
          slotId,
          itemId: target.itemId,
          itemUid: null,
          now
        }));
      }
    }

    return {
      status: "ok",
      installed: Boolean(target),
      mutation: {
        quantityItemsToPut: [...quantityItemsToPut.values()],
        quantityItemIdsToDelete: [...quantityItemIdsToDelete],
        uniqueItemsToPut,
        slotAssignmentsToPut,
        slotAssignmentIdsToDelete: [...slotAssignmentIdsToDelete]
      }
    };
  }

  resolveFittingSelection(equippedId, cargoStorageId) {
    const parsed = this.parseFittingCandidateId(equippedId);
    if (parsed.mode === "empty") return null;
    if (parsed.mode === "unique") return parsed;
    if (parsed.mode === "quantity") {
      return {
        ...parsed,
        quantityEntry: this.getQuantityItemEntry(cargoStorageId, parsed.itemId)
      };
    }
    const quantityEntry = this.getQuantityItemEntry(cargoStorageId, parsed.itemId);
    if (quantityEntry) {
      return {
        mode: "quantity",
        itemId: parsed.itemId,
        itemUid: "",
        quantityEntry
      };
    }
    return parsed;
  }

  getQuantityItemEntry(storageId, itemId) {
    return (this.playerAssets?.quantityItems || []).find((item) => {
      return item.storage_id === storageId && item.item_id === itemId;
    }) || null;
  }

  createSlotAssignmentForMutation({ ownerItemUid, slotType, slotId, itemId, itemUid = null, now = Date.now() }) {
    const assignmentId = `${ownerItemUid}:${slotType}:${slotId}`;
    const previous = (this.playerAssets?.slotAssignments || []).find((assignment) => assignment.assignment_id === assignmentId);
    return {
      ...(previous || {}),
      assignment_id: assignmentId,
      owner_item_uid: ownerItemUid,
      slot_type: slotType,
      slot_id: slotId,
      item_id: itemId,
      item_uid: itemUid,
      kind: this.itemDefinitions?.[itemId]?.kind || slotType,
      item_identity: itemUid ? "unique" : "quantity",
      quantity: 1,
      location_type: "ship_slot",
      created_at: previous?.created_at || now,
      updated_at: now
    };
  }

  getFittingCandidatesForSlot({ shipId, type, slot, candidateScope = "owned" } = {}) {
    if (candidateScope !== "owned" || !COMBAT_SLOT_TYPES.includes(type) || !slot) return null;
    if (!this.playerAssets) return null;
    const cargoStorageId = this.getActiveShipCargoStorage()?.storage_id || null;
    const candidates = [];

    for (const item of this.playerAssets?.quantityItems || []) {
      if (item.storage_id !== cargoStorageId || this.getItemKind(item) !== type || numberOrZero(item.quantity) <= 0) continue;
      const definition = this.getCombatDefinitionsForType(type)?.[item.item_id];
      if (!this.isDefinitionCompatibleWithSlot(type, slot, definition)) continue;
      candidates.push({
        ...definition,
        candidate_id: `qty:${item.item_id}`,
        item_uid: null,
        storage_id: item.storage_id,
        quantity: numberOrZero(item.quantity),
        source_label: "Cargo"
      });
    }

    for (const item of this.playerAssets?.uniqueItems || []) {
      if (item.storage_id !== cargoStorageId || this.getItemKind(item) !== type) continue;
      const definition = this.getCombatDefinitionsForType(type)?.[item.item_id];
      if (!this.isDefinitionCompatibleWithSlot(type, slot, definition)) continue;
      candidates.push({
        ...definition,
        candidate_id: item.item_uid,
        item_uid: item.item_uid,
        storage_id: item.storage_id,
        fixed_options: item.fixed_options || {},
        source_label: "Cargo"
      });
    }

    return candidates.sort((a, b) => {
      const sourceOrder = String(a.source_label).localeCompare(String(b.source_label));
      return sourceOrder || String(a.id).localeCompare(String(b.id)) || String(a.candidate_id).localeCompare(String(b.candidate_id));
    });
  }

  buildShipCombatSummaries() {
    const cargoUsed = this.getStorageUsedCapacity(this.getActiveShipCargoStorage()?.storage_id || null);
    const summaries = {};
    for (const shipId of Object.keys(this.shipDefinitions || {})) {
      summaries[shipId] = this.calculateShipCombatSummary(shipId, {}, { cargoUsed });
    }
    return summaries;
  }

  getShipCombatSummary(shipId) {
    return this.shipCombatSummaries?.[shipId]
      || this.shipCombatSummaries?.[this.defaultShipId]
      || this.calculateShipCombatSummary(shipId || this.defaultShipId);
  }

  calculateShipCombatSummary(shipId, slotOverrides = {}, { cargoUsed = null } = {}) {
    const ship = this.getShipDefinition(shipId);
    const combat = ship?.combat || {};
    const baseStats = {
      ...EMPTY_COMBAT_BASE_STATS,
      ...(combat.base_stats || {})
    };
    const stats = {
      processing_capacity: numberOrZero(baseStats.processing_capacity),
      processing_load: 0,
      processing_free: 0,
      power_capacity: numberOrZero(baseStats.power_capacity),
      power_recharge: numberOrZero(baseStats.power_recharge),
      weapon_power_use: 0,
      shield_power_use_cap: 0,
      power_balance: 0,
      cargo_capacity: numberOrZero(baseStats.cargo_capacity),
      installed_mass: 0,
      evasion: clampRatio(baseStats.evasion),
      hull_capacity: numberOrZero(baseStats.hull_capacity),
      hull_recharge_base: numberOrZero(baseStats.hull_recharge_base),
      shield_capacity: 0,
      shield_recharge_base: 0,
      shield_recharge_rate: 0,
      shield_recharge_boost: 0,
      shield_recharge_power: 0
    };
    const weaponDamage = Object.fromEntries(DAMAGE_TYPES.map((type) => [type, 0]));
    const shieldDefense = {
      kinetic: 0,
      thermal: 0,
      energy: 0
    };
    const slots = {};
    const slotCounts = {};
    const equippedCounts = {};
    let weaponAccuracyTotal = 0;
    let weaponCritChanceTotal = 0;
    let weaponCritDamageTotal = 0;
    let weaponCount = 0;
    let weaponRangeMax = 0;

    for (const type of COMBAT_SLOT_TYPES) {
      const definitions = this.getCombatDefinitionsForType(type);
      const sourceSlots = Array.isArray(combat.slots?.[type]) ? combat.slots[type] : [];
      slots[type] = sourceSlots.map((slot) => {
        const overrideKey = `${type}:${slot.id}`;
        const factoryFallback = this.playerAssets ? "" : slot.equipped_id;
        const loadoutEquippedId = this.getPlayerShipLoadoutSlot(shipId, type, slot.id, factoryFallback);
        const equippedValue = Object.prototype.hasOwnProperty.call(slotOverrides, overrideKey)
          ? slotOverrides[overrideKey]
          : loadoutEquippedId;
        const resolved = this.resolveEquippedDefinition(type, equippedValue);
        const effectiveSlot = {
          ...slot,
          equipped_id: resolved.definitionId || null,
          equipped_item_uid: resolved.item?.item_uid || null
        };
        const definition = effectiveSlot.equipped_id ? definitions[effectiveSlot.equipped_id] : null;
        const summary = {
          ...effectiveSlot,
          equipped_definition: definition || null,
          equipped: Boolean(definition)
        };
        if (!definition) return summary;

        stats.processing_load += numberOrZero(definition.processing_load);
        stats.installed_mass += numberOrZero(definition.mass);

        if (type === "weapon") {
          for (const damageType of DAMAGE_TYPES) {
            weaponDamage[damageType] += numberOrZero(definition[`damage_${damageType}`]);
          }
          stats.weapon_power_use += numberOrZero(definition.power_use);
          weaponAccuracyTotal += numberOrZero(definition.acc);
          weaponCritChanceTotal += numberOrZero(definition.crit_chance);
          weaponCritDamageTotal += numberOrZero(definition.crit_damage);
          weaponRangeMax = Math.max(weaponRangeMax, numberOrZero(definition.range));
          weaponCount += 1;
        } else if (type === "shield") {
          const rechargeBase = numberOrZero(definition.recharge_base);
          const rechargeRate = numberOrZero(definition.recharge_rate);
          const powerUseCap = numberOrZero(definition.power_use_cap);
          stats.shield_capacity += numberOrZero(definition.capacity);
          stats.shield_recharge_base += rechargeBase;
          stats.shield_recharge_rate += rechargeRate;
          stats.shield_power_use_cap += powerUseCap;
          stats.shield_recharge_boost += powerUseCap * rechargeRate;
          stats.shield_recharge_power += rechargeBase + powerUseCap * rechargeRate;
          shieldDefense.kinetic = Math.max(shieldDefense.kinetic, numberOrZero(definition.def_bonus_kinetic));
          shieldDefense.thermal = Math.max(shieldDefense.thermal, numberOrZero(definition.def_bonus_thermal));
          shieldDefense.energy = Math.max(shieldDefense.energy, numberOrZero(definition.def_bonus_energy));
        } else if (type === "equipment") {
          stats.processing_capacity += numberOrZero(definition.processing_capacity_bonus);
          stats.power_capacity += numberOrZero(definition.power_capacity_bonus);
          stats.power_recharge += numberOrZero(definition.power_recharge_bonus);
          stats.cargo_capacity += numberOrZero(definition.cargo_capacity_bonus);
          stats.evasion = clampRatio(stats.evasion + numberOrZero(definition.evasion_bonus));
          stats.hull_capacity += numberOrZero(definition.hull_capacity_bonus);
          stats.hull_recharge_base += numberOrZero(definition.hull_recharge_base_bonus);
        }

        return summary;
      });
      slotCounts[type] = slots[type].length;
      equippedCounts[type] = slots[type].filter((slot) => slot.equipped).length;
    }

    stats.processing_free = stats.processing_capacity - stats.processing_load;
    stats.power_balance = stats.power_recharge - stats.weapon_power_use;
    const cargoStorageId = this.getActiveShipCargoStorage()?.storage_id || null;
    const cargoUsedValue = cargoUsed == null ? this.getStorageUsedCapacity(cargoStorageId) : cargoUsed;

    return {
      ship_id: ship?.id || shipId,
      ship_class: combat.ship_class || "lf",
      base_stats: baseStats,
      stats,
      weapon_damage: weaponDamage,
      weapon_damage_total: Object.values(weaponDamage).reduce((total, value) => total + value, 0),
      weapon_average_accuracy: weaponCount > 0 ? weaponAccuracyTotal / weaponCount : 0,
      weapon_average_crit_chance: weaponCount > 0 ? weaponCritChanceTotal / weaponCount : 0,
      weapon_average_crit_damage: weaponCount > 0 ? weaponCritDamageTotal / weaponCount : 0,
      weapon_range_max: weaponRangeMax,
      shield_defense: shieldDefense,
      cargo: {
        storage_id: cargoStorageId,
        used: cargoUsedValue,
        capacity: stats.cargo_capacity,
        free: stats.cargo_capacity - cargoUsedValue
      },
      slots,
      slot_counts: slotCounts,
      equipped_counts: equippedCounts
    };
  }

  getCombatDefinitionsForType(type) {
    if (type === "weapon") return this.weaponDefinitions;
    if (type === "shield") return this.shieldDefinitions;
    if (type === "equipment") return this.equipmentDefinitions;
    return {};
  }

  async openFittingPreview({ canvas, shipId = this.selectedShipId, mode = "info" } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    this.closeFittingPreview();
    const previewMode = mode === "simulation" ? "simulation" : "info";

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = this.renderer?.toneMapping ?? THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.renderer?.toneMappingExposure ?? 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.HemisphereLight(0xddeeff, 0x172033, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(4, 6, 8);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x7bdcff, 1.2);
    rimLight.position.set(-5, 2, -4);
    scene.add(rimLight);

    const preview = {
      canvas,
      scene,
      camera,
      renderer,
      root,
      mode: previewMode,
      disposables: [],
      frameId: 0,
      disposed: false,
      resize: () => this.resizeFittingPreview()
    };
    this.fittingPreview = preview;
    window.addEventListener("resize", preview.resize);
    this.resizeFittingPreview();

    try {
      const model = await this.createFittingPreviewModel(shipId, {
        mode: previewMode,
        disposables: preview.disposables
      });
      if (this.fittingPreview !== preview || preview.disposed) return;
      root.add(model);
      this.fitFittingPreviewCamera(model);
    } catch (error) {
      console.warn("[fitting-preview] model unavailable:", error?.message ?? error);
    }

    const clock = new THREE.Clock();
    const render = () => {
      if (this.fittingPreview !== preview || preview.disposed) return;
      preview.frameId = requestAnimationFrame(render);
      preview.root.rotation.y += clock.getDelta() * 0.36;
      preview.renderer.render(preview.scene, preview.camera);
    };
    render();
  }

  closeFittingPreview() {
    const preview = this.fittingPreview;
    if (!preview) return;
    preview.disposed = true;
    if (preview.frameId) cancelAnimationFrame(preview.frameId);
    window.removeEventListener("resize", preview.resize);
    preview.scene.clear();
    preview.disposables?.forEach((resource) => resource?.dispose?.());
    preview.disposables = [];
    preview.renderer.dispose();
    this.fittingPreview = null;
  }

  async createFittingPreviewModel(shipId, { disposables = [] } = {}) {
    const activeModel = this.ship?.getObjectByName(shipId);
    const model = activeModel
      ? activeModel.clone(true)
      : (await this.resourceManager.loadShipModel(this.getShipModelId(shipId), { silent: true })).object.clone(true);
    this.applyFittingSimulationPreviewStyle(model, disposables);
    return model;
  }

  prepareFittingPreviewModelMaterials(model, disposables = []) {
    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      child.frustumCulled = false;
      const cloneMaterial = (material) => {
        if (!material) return material;
        const clone = material.clone();
        clone.depthWrite = true;
        clone.transparent = clone.transparent === true;
        clone.needsUpdate = true;
        disposables.push(clone);
        return clone;
      };
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => cloneMaterial(material))
        : cloneMaterial(child.material);
    });
  }

  applyFittingSimulationPreviewStyle(model, disposables = []) {
    const bodyMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
      toneMapped: false
    });
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x263442,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
      toneMapped: false
    });
    disposables.push(bodyMaterial, edgeMaterial);

    const meshes = [];
    model.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      child.frustumCulled = false;
      child.material = bodyMaterial;
      child.castShadow = false;
      child.receiveShadow = false;
      meshes.push(child);
    });

    meshes.forEach((mesh) => {
      const edgesGeometry = new THREE.EdgesGeometry(mesh.geometry, 28);
      const edges = new THREE.LineSegments(edgesGeometry, edgeMaterial);
      edges.name = `${mesh.name || "mesh"}_simulation_edges`;
      edges.frustumCulled = false;
      edges.renderOrder = (mesh.renderOrder || 0) + 1;
      mesh.add(edges);
      disposables.push(edgesGeometry);
    });
  }

  resizeFittingPreview() {
    const preview = this.fittingPreview;
    if (!preview) return;
    const rect = preview.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || preview.canvas.clientWidth || 1));
    const height = Math.max(1, Math.floor(rect.height || preview.canvas.clientHeight || 1));
    preview.renderer.setSize(width, height, false);
    preview.camera.aspect = width / height;
    preview.camera.updateProjectionMatrix();
  }

  fitFittingPreviewCamera(model) {
    const preview = this.fittingPreview;
    if (!preview) return;
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) {
      preview.camera.position.set(0, 2, 12);
      preview.camera.lookAt(0, 0, 0);
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(center);
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.65;
    preview.camera.position.set(radius * 0.25, radius * 0.42, radius * 2.35);
    preview.camera.lookAt(0, 0, 0);
    preview.camera.updateProjectionMatrix();
  }

  getShipModelId(shipId) {
    const visual = this.getShipDefinition(shipId)?.visual || {};
    return visual.model_id || visual.modelId || shipId;
  }

  async setSelectedShipId(shipId) {
    if (!this.shipDefinitions[shipId] || shipId === this.selectedShipId) return;
    if (this.playerAssets && !this.getOwnedShipDefinitions()[shipId]) {
      this.ui.showErrorToast("ship not owned");
      return;
    }

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
      const result = await this.resourceManager.loadShipModel(this.getShipModelId(shipId), { silent: true });
      if (this.disposed) return;
      this.addShipModel(result.object);
      void this.saveShipSettings();
    } catch (err) {
      console.error("[ship-swap] failed:", err);
      this.selectedShipId = previousShipId;
      this._applyShipSpecs(previousShipId);
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
      renderResolutionScale: this.getRenderResolutionScale(),
      maxPixelRatio: MAX_PIXEL_RATIO
    });
    this.renderPipeline.registerStylizedRenderTarget(this.ship);
    this.renderPipeline.setStylizedRenderMode(this.performanceSettings.stylizedRenderMode);

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
    this.shipVisualManager.setShipDefinitions(this.shipDefinitions, this.defaultShipId);
    this.remotePlayerManager = new RemotePlayerManager({
      scene: this.scene,
      resourceManager: this.resourceManager,
      shipDefinitions: this.shipDefinitions,
      defaultShipId: this.defaultShipId,
      toRenderVector: (position) => this.worldMapManager.toRenderVector(position),
      registerStylizedRenderTarget: (object) => {
        this.renderPipeline?.registerStylizedRenderTarget(object);
      },
      unregisterStylizedRenderTarget: (object) => {
        this.renderPipeline?.unregisterStylizedRenderTarget(object);
      }
    });
  }

  setupShipLocalLights() {
    const { fillLight, rimLight } = LIGHTING_SETTINGS.ship;
    this.shipFillLight = new THREE.PointLight(fillLight.color, fillLight.intensity, fillLight.distance);
    this.shipFillLight.position.set(...fillLight.position);

    this.shipRimLight = new THREE.PointLight(rimLight.color, rimLight.intensity, rimLight.distance);
    this.shipRimLight.position.set(...rimLight.position);

    this.shipFillLight.layers.set(SHIP_LOCAL_LIGHT_LAYER);
    this.shipRimLight.layers.set(SHIP_LOCAL_LIGHT_LAYER);
    this.ship.add(this.shipFillLight, this.shipRimLight);
  }

  // Confine every light under the ship to the ship-only light layer, and make the ship's
  // own meshes receive that layer so they stay lit. Called after the ship model and its
  // engine lights are (re)created so spill onto world objects is eliminated.
  isolateShipLocalLights() {
    if (!this.ship) return;
    this.ship.traverse((child) => {
      if (child.isLight) child.layers.set(SHIP_LOCAL_LIGHT_LAYER);
      else if (child.isMesh) child.layers.enable(SHIP_LOCAL_LIGHT_LAYER);
    });
  }

  getRenderResolutionScale(settings = this.performanceSettings) {
    return normalizeRenderResolutionScale(settings.renderResolutionScale);
  }

  getRendererPixelRatio() {
    return Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO) * this.getRenderResolutionScale();
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
          if (this.isBetaSpaceActive()) return;
          // 임시 비활성화용 coast navLog가 있으면 취소하고 즉시 정지 navLog로 교체
          if (this._deactivationLog) {
            void this.worldDataManager.updateNavLog(this._deactivationLog.id, { status: "cancelled", cancelled_at: Date.now() });
            this._deactivationLog = null;
          }
          this._commitDeactivationNavLog(null, 0);
          if (this.miningSession) void this.worldDataManager.settleNode({ nodeId: this.miningSession.nodeId });
        }
      },
      visibilitychange: () => {
        if (this.state.phase !== "running") return;
        if (this.isBetaSpaceActive()) return;
        if (document.visibilityState === "hidden") {
          this._commitPreflightSnapshot();
          this._commitDeactivationNavLog();
          this.setOnlinePresenceUnavailable();
        } else if (document.visibilityState === "visible") {
          this._resolvePreflightSnapshot();
          this._resolveDeactivationNavLog();
          this._resolveHyperdriveWarp();
          this._snapToActiveNavLog();
          this.updateOnlinePresence({ force: true });
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
    const shipTask = this.resourceManager.loadShipModel(this.getShipModelId(this.selectedShipId))
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
    await this.loadPlayerAssets();
    this.worldMapManager.renderWorld(snapshot);
    await this.loadSavedWorldViewSettings();
    await this.restorePlayerShipState();
    await this.resumeGatheringSessions();
    this.syncWorldRuntimeWithPlayer({ force: true });
    await this.refreshWorldSummary({ force: true });
    this.updateOnlinePresence({ force: true });
    return snapshot;
  }

  async restorePlayerShipState() {
    const authoritativeState = this.worldDataManager.getNavigationState();
    if (authoritativeState?.ship) {
      if (authoritativeState.ship.spatialMode === "BETA_SPACE") {
        this.activateAuthoritativeBetaSpace(authoritativeState);
      }
      this.applyAuthoritativeNavigationState(authoritativeState);
      this.resetInitialCamera();
      return;
    }

    const [playerShipState, navLogs] = await Promise.all([
      this.worldDataManager.loadOrCreatePlayerShipState(this.characterId),
      this.worldDataManager.getNavLogs(10)
    ]);

    // Deterministic reconnect: if the ship asset is docked (loaded into a station hangar),
    // loadPlayerAssets() already entered the docking scene — skip space-position restore.
    if (this.isDocked()) return;

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
          this._commitDeactivationNavLog(savedAt, 0);
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

  applyAuthoritativeNavigationState(navigationState, {
    expectedClientActionId = null
  } = {}) {
    const state = navigationState;
    const contract = state?.activeContract || null;
    if (state?.ship?.spatialMode === "DOCKED") {
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      this.state.autopilotPhase = null;
      this.navTarget = null;
      this.activeNavLog = null;
      this.activeNavLogId = null;
      this.hyperdriveLog = null;
      this.hyperdriveLogId = null;
      this.isHyperdrive = false;
      this.targetMarker.visible = false;
      this.syncDockingPresentation();
      return true;
    }
    if (state?.ship?.spatialMode === "BETA_SPACE" && !this.betaSpaceSession) {
      this.activateAuthoritativeBetaSpace(state);
    }
    if (
      expectedClientActionId
      && contract
      && contract?.clientActionId !== expectedClientActionId
    ) {
      return false;
    }
    const renderScale = Number(this.worldConfig.renderScale) || 0.01;
    const authorityNow = contract
      ? Math.max(
          Number(state.serverTime) || 0,
          this.worldDataManager.getEstimatedNavigationServerNow()
        )
      : Number(state.serverTime) || this.worldDataManager.getEstimatedNavigationServerNow();
    this.manualSettlementTracker.reset();
    const derived = contract
      ? deriveMovementState(contract, authorityNow)
      : {
          position: state.ship.position,
          speed: state.ship.speed,
          desiredSpeed: state.ship.desiredSpeed,
          phase: state.ship.phase
        };
    const position = this.worldMapManager.toRenderVector(derived.position);
    this.ship.position.copy(position);
    this.ship.quaternion.set(
      Number(state.ship.rotation?.x) || 0,
      Number(state.ship.rotation?.y) || 0,
      Number(state.ship.rotation?.z) || 0,
      Number.isFinite(Number(state.ship.rotation?.w)) ? Number(state.ship.rotation.w) : 1
    ).normalize();
    this.state.speed = (Number(derived.speed) || 0) * renderScale;
    this.state.desiredSpeed = (Number(derived.desiredSpeed) || 0) * renderScale;
    this.state.autopilotPhase = null;
    this.state.autopilotPeakSpeed = 0;
    this.navTarget = null;
    this.activeNavLogId = null;
    this.activeNavLog = null;
    this.hyperdriveLogId = null;
    this.hyperdriveLog = null;
    this.isHyperdrive = false;
    this.targetMarker.visible = false;

    if (!contract) return true;

    const localTimeOffset = Date.now() - authorityNow;
    const from = this.worldMapManager.toRenderVector(contract.fromPosition);
    const target = this.worldMapManager.toRenderVector(contract.target);
    const toLocalTime = (timestamp) => Number(timestamp || 0) + localTimeOffset;
    this.navTarget = target;
    this.targetMarker.visible = true;
    this.targetMarker.position.copy(target);

    if (contract.routeType === "standard") {
      this.activeNavLogId = contract.clientActionId || contract.contractId;
      this.activeNavLog = {
        type: "standard",
        from_position: { x: from.x, y: from.y, z: from.z },
        target: { x: target.x, y: target.y, z: target.z },
        flight_start_at: toLocalTime(contract.flightAt),
        peak_speed: contract.peakSpeed * renderScale,
        flight_duration: contract.flightDuration
      };
      this.state.autopilotPeakSpeed = contract.peakSpeed * renderScale;
      this.state.autopilotPhase = derived.phase;
      return true;
    }

    if (contract.routeType === "hyperdrive") {
      const heading = contract.heading || { x: 0, y: 0, z: 1 };
      this.hyperdriveLogId = contract.clientActionId || contract.contractId;
      this.hyperdriveLog = {
        type: "hyperdrive",
        issued_at: toLocalTime(contract.issuedAt),
        from_position: { x: from.x, y: from.y, z: from.z },
        target: { x: target.x, y: target.y, z: target.z },
        heading_at_jump: { ...heading },
        stop_start_at: toLocalTime(contract.stopStartAt),
        align_start_at: toLocalTime(contract.alignStartAt),
        cooldown_start_at: toLocalTime(contract.cooldownStartAt),
        jump_start_at: toLocalTime(contract.flightAt),
        stop_duration: contract.stopDuration,
        align_duration: contract.alignDuration,
        cooldown_duration: contract.cooldownDuration,
        warp_entry_duration: contract.warpEntryDuration,
        warp_cruise_duration: contract.warpCruiseDuration,
        warp_exit_duration: contract.warpExitDuration,
        flight_duration: contract.flightDuration,
        committed: authorityNow >= contract.flightAt,
        status: "active"
      };
      this.isHyperdrive = true;
      this.state.autopilotPhase = derived.phase;
      return true;
    }

    // v3.2 reconnect rule: resolve deterministic deactivation to the server time,
    // then resume manual control from that exact server-derived point.
    this.state.desiredSpeed = 0;
    void this.worldDataManager.manualOverrideNavigation()
      .catch((error) => this.handleNavigationRecordFailure(error));
    return true;
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
    const shipVisualDefinition = this.getShipDefinition(shipId)?.visual;
    this.shipAnimationClips = Array.isArray(model.animations) ? model.animations : [];
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
      object: model,
      shipDefinition: shipVisualDefinition
    }) || null;
    this.shipEngineOutputPercent = null;
    this.updateShipEngineOutput();
    this.applyMaterialMapPerformanceSettings();
    this.applyLightingPerformanceSettings();
    this.renderPipeline?.markTargetsDirty();
    // Re-queue the ship root so the freshly-added model gets outline shells (idempotent for the set).
    this.renderPipeline?.registerStylizedRenderTarget(this.ship);
    // Keep the ship's local lights from spilling onto nearby world objects.
    this.isolateShipLocalLights();
    // On restore-while-docked the ship model can finish loading after the dock scene was set up
    // (parallel load). Re-apply the dock presentation so the ship pose/offsets use the real model.
    if (this.isDocked() && this.dockInteriorObject) this.setupDockPresentation();
    this.setupShipAnimations();
  }

  // Persistent in-space ship animation mixer: anim_idle (continuous loop) and
  // anim_mining (transition-driven). anim_landing stays owned by the dock mixer.
  // Any of these clips may be absent on a given model — all paths no-op safely.
  setupShipAnimations() {
    this.disposeShipMixer();
    const clips = this.shipAnimationClips || [];
    if (!clips.length) return;

    this.shipMixer = new THREE.AnimationMixer(this.ship);

    const idleClip = this.findAnimationClip(clips, "anim_idle");
    if (idleClip) {
      this.shipIdleAction = this.shipMixer.clipAction(idleClip);
      this.shipIdleAction.setLoop(THREE.LoopRepeat, Infinity);
      this.shipIdleAction.play();
    }

    const miningClip = this.findAnimationClip(clips, "anim_mining");
    if (miningClip) {
      this.shipMiningAction = this.shipMixer.clipAction(miningClip);
      this.shipMiningAction.setLoop(THREE.LoopOnce, 1);
      this.shipMiningAction.clampWhenFinished = true;
      // Default = rest (start) pose; only state transitions drive it. If the
      // model (re)loaded while already mining, jump straight to the held end.
      if (this.miningSession) this._snapShipMiningToEnd();
    }
  }

  disposeShipMixer() {
    if (this.shipMixer) {
      this.shipMixer.stopAllAction();
      this.shipMixer.uncacheRoot(this.ship);
    }
    this.shipMixer = null;
    this.shipIdleAction = null;
    this.shipMiningAction = null;
  }

  updateShipAnimations(dt) {
    this.shipMixer?.update(dt);
  }

  // Mining transition: forward = deploy then hold the end frame (clampWhenFinished);
  // reverse = retract back to the rest pose. play() never resets time, so reverse
  // resumes from wherever the forward pass left off.
  driveShipMiningAnimation(forward) {
    const action = this.shipMiningAction;
    if (!action) return;
    action.enabled = true;
    action.paused = false;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = forward ? 1 : -1;
    action.play();
  }

  _snapShipMiningToEnd() {
    const action = this.shipMiningAction;
    if (!action) return;
    const clip = action.getClip();
    action.enabled = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.time = clip ? clip.duration : 0;
    action.timeScale = 1;
    this.shipMixer?.update(0); // apply the held end pose immediately
    action.paused = true;
  }

  applyShipReflection(model, shipVisualDefinition = this.getShipDefinition(this.defaultShipId)?.visual) {
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

  createStars(count, radius, size, opacity, { scene = this.scene, excludeRadius = 0 } = {}) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    const excludeSq = excludeRadius * excludeRadius;

    for (let i = 0; i < count; i += 1) {
      const index = i * 3;
      let x, y, z;
      // Reject any star inside the exclusion sphere (e.g. the station's radius in the dock scene).
      do {
        x = (Math.random() * 2 - 1) * radius;
        y = (Math.random() * 2 - 1) * radius;
        z = (Math.random() * 2 - 1) * radius;
      } while (excludeSq > 0 && x * x + y * y + z * z < excludeSq);
      positions[index] = x;
      positions[index + 1] = y;
      positions[index + 2] = z;

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
    scene.add(points);
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
    if (this.isDocked()) return false;
    if (this.isHyperdrive && this.state.autopilotPhase === "warping") return false;
    const cancelledPending = this.cancelPendingNavigationForManualInput();
    if (this.isHyperdrive) {
      this.clearTarget(null, false, { recordServer: !cancelledPending });
    } else {
      this.cancelAutopilot({ recordServer: !cancelledPending });
    }
    return this.setSpeed(value);
  }

  moveToward(value, target, maxDelta) {
    if (Math.abs(target - value) <= maxDelta) return target;
    return value + Math.sign(target - value) * maxDelta;
  }

  setTarget({ x, y, z }) {
    if (this.isDocked()) return;
    if (this.isMiningBusy()) return;
    if (this.isHyperdrive) return;
    this.beginDeterministicNavigation("standard", { x, y, z }, "nav");
  }

  clearTarget(message, completed = false, { recordServer = true } = {}) {
    const now = Date.now();
    const inBetaSpace = this.isBetaSpaceActive();
    const wasHyperdrive = this.isHyperdrive || !!this.hyperdriveLogId;
    const shouldOverrideServer = !completed
      && Boolean(this.hyperdriveLogId || this.activeNavLogId);
    if (this.hyperdriveLogId) {
      if (inBetaSpace) {
        this.betaSpaceManager.updateNavLog(this.betaSpaceSession, this.hyperdriveLogId, completed
          ? { status: "completed", committed: true, completed_at: now }
          : { status: "cancelled", cancel_reason: "user_manual", cancelled_at: now }
        );
      } else {
        void this.worldDataManager.updateNavLog(this.hyperdriveLogId, completed
          ? { status: "completed", committed: true, completed_at: now }
          : { status: "cancelled", cancel_reason: "user_manual", cancelled_at: now }
        );
      }
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
      const patch = completed
        ? { status: "completed", completed_at: now }
        : { status: "cancelled", cancelled_at: now };
      if (inBetaSpace) {
        this.betaSpaceManager.updateNavLog(this.betaSpaceSession, this.activeNavLogId, patch);
      } else {
        void this.worldDataManager.updateNavLog(this.activeNavLogId, patch);
      }
      this.activeNavLogId = null;
    }
    this.state.autopilotPhase = null;
    this.state.autopilotPeakSpeed = 0;
    this.navTarget = null;
    this.activeNavLog = null;
    this.targetMarker.visible = false;
    if (message && !(wasHyperdrive && message === "arrived")) this.ui.showToast(message);
    // Warp ended (arrival or cancel): revert from warp ambience to the destination's location BGM.
    if (wasHyperdrive) this.refreshBgm();
    if (shouldOverrideServer && recordServer) this.recordAuthoritativeManualOverride();
    if (completed) {
      this.state.speed = 0;
      this.state.desiredSpeed = 0;
      this.manualSettlementTracker.reset();
      void this.worldDataManager.reconcileNavigationArrival()
        .then((state) => {
          if (this.disposed) return;
          this.applyAuthoritativeNavigationState(state);
          this.navigationRecordFailed = false;
          this.updateOnlinePresence({ force: true });
        })
        .catch((error) => this.handleNavigationRecordFailure(error));
    }
    this.updateOnlinePresence({ force: true });
  }

  cancelAutopilot({ recordServer = true } = {}) {
    if (this.state.autopilotPhase === null) return;
    if (this.isHyperdrive) return;
    if (this.activeNavLogId) {
      const patch = { status: "cancelled", cancelled_at: Date.now() };
      if (this.isBetaSpaceActive()) {
        this.betaSpaceManager.updateNavLog(this.betaSpaceSession, this.activeNavLogId, patch);
      } else {
        this.worldDataManager.updateNavLog(this.activeNavLogId, patch);
      }
      this.activeNavLogId = null;
    }
    this.state.autopilotPhase = null;
    this.state.autopilotPeakSpeed = 0;
    this.navTarget = null;
    this.activeNavLog = null;
    this.targetMarker.visible = false;
    if (recordServer) this.recordAuthoritativeManualOverride();
    this.updateOnlinePresence({ force: true });
  }

  initiateHyperdrive({ x, y, z }) {
    if (this.isHyperdrive) return;
    if (this.isMiningBusy()) { this.ui.showToast("stop gathering first"); return; }
    if (this.isDocked()) {
      this.ui.showToast("undock to use hyperdrive");
      return;
    }
    if (this.isBetaSpaceActive()) {
      this.ui.showToast("hyperdrive unavailable in Beta Space");
      return;
    }
    const { hyperdriveSpecs } = this.shipStats;
    if (!hyperdriveSpecs) {
      this.ui.showToast("hyperdrive not available");
      return;
    }
    this.beginDeterministicNavigation("hyperdrive", { x, y, z }, "warp");
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
    this.refreshBgm(); // warp ambience overrides sector BGM for the duration of the jump
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
    if (this.isBetaSpaceActive()) return;
    if (this.pendingNavigationCommand) return;
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

    const id = this.worldDataManager.createNavigationActionId("deactivation");
    this._deactivationLog = { ...log, id };
    this.recordAuthoritativeNavigationStart(
      "deactivation",
      null,
      id,
      { desiredSpeed: vd }
    );
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
    this.recordAuthoritativeManualOverride();
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
    // While docked the ship sits at the docking-scene pivot, so report the station's
    // world position instead (minimap, scanner distances, location readout).
    if (this.isDocked()) {
      const stationPosition = this.getDockedStationDataPosition();
      if (stationPosition) return stationPosition;
    }
    const position = this.worldMapManager.toDataVector(this.ship.position);
    return { x: position.x, y: position.y, z: position.z };
  }

  getDockedStationDataPosition() {
    const stationId = this.getDockedStationId();
    if (!stationId) return null;
    const resolved = this.resolveDockableStation({ id: stationId });
    return resolved ? { ...resolved.dataPosition } : null;
  }

  syncWorldRuntimeWithPlayer({ force = false } = {}) {
    if (!this.worldMapManager?.snapshot) return null;
    const dataPosition = this.getPlayerDataPosition();
    this.worldMapManager.updateVisibleChunksFromPosition(dataPosition, { force });
    if (this.state.phase === "running") this.updateLocationBgm(dataPosition);
    return dataPosition;
  }

  getBgmIdForCurrentPlayerPosition() {
    return this.getActiveBgmId(this.getPlayerDataPosition());
  }

  getBgmIdForPosition(dataPosition) {
    if (this.isBetaSpaceActive()) return "bgm_danger_01";

    const sector = this.worldDataManager.getSectorAtPosition(
      dataPosition.x,
      dataPosition.y,
      dataPosition.z
    );
    if (sector) return sector.theme_music_id || "bgm_sector_01";

    const chunk = this.worldDataManager.getChunkRecordAtPosition(dataPosition);
    return chunk ? "bgm_main_01" : "bgm_danger_01";
  }

  // Per-station docking BGM, sourced from `building_defs` (`docking.theme_music_id`).
  getDockedStationBgmId() {
    const stationId = this.getDockedStationId();
    if (!stationId) return null;
    const resolved = this.resolveDockableStation({ id: stationId });
    if (!resolved) return null;
    return this.buildingDefinitions[resolved.building_id]?.docking?.theme_music_id || null;
  }

  // Single source of truth for the active BGM. State overrides position: while warping the warp
  // ambience plays regardless of sector; while docked the station's dock theme plays.
  getActiveBgmId(dataPosition = this.getPlayerDataPosition()) {
    if (this.isHyperdrive && this.state.autopilotPhase === "warping") return "bgm_warp_01";
    if (this.isDocked()) return this.getDockedStationBgmId() || "bgm_hanger_01";
    return this.getBgmIdForPosition(dataPosition);
  }

  // Re-evaluate the active BGM from full game state (call on warp/dock transitions).
  refreshBgm() {
    this.updateLocationBgm(this.getPlayerDataPosition());
  }

  updateLocationBgm(dataPosition) {
    const nextBgmId = this.getActiveBgmId(dataPosition);
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
    const pendingNavigation = this.getVisiblePendingNavigation();
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
      target: pendingNavigation?.target || this.navTarget,
      navigationPendingType: pendingNavigation?.routeType || null,
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
    if (!this.worldDataManager.db && !this.isBetaSpaceActive()) return;
    if (!force) {
      const now = performance.now();
      if (this.worldSummaryPending || now - this.worldSummaryLastUpdatedAt < 500) return;
      this.worldSummaryLastUpdatedAt = now;
    }

    this.worldSummaryPending = true;
    const dataPosition = this.syncWorldRuntimeWithPlayer({ force }) || this.getPlayerDataPosition();
    try {
      if (this.isBetaSpaceActive()) {
        const summary = this.betaSpaceManager.getSummary(this.betaSpaceSession, dataPosition);
        this.worldMapManager.setCurrentSectorId(summary.currentSector?.sector_id || null);
        this.ui.setWorldSummary(summary);
        return;
      }

      const summary = await this.worldDataManager.getSummary(dataPosition);
      this.worldMapManager.setCurrentSectorId(summary.currentSector?.sector_id || null);
      this.ui.setWorldSummary(summary);
    } finally {
      this.worldSummaryPending = false;
    }
  }

  update(dt) {
    if (this.isDocked()) return;
    if (this.isBetaSpaceActive() && this.updateBetaSpaceState()) return;
    if (!this.isBetaSpaceActive()) void this.updateBetaVoidLifecycle();
    if (this.miningAligning) {
      // Local pre-mining alignment delay: rotate to face the node, hold position.
      this.updateMiningAlignment(dt);
    } else if (this.miningSession) {
      // Gathering: the ship is locked in place; no autopilot or manual movement.
      this.setSpeed(0);
      this.state.desiredSpeed = 0;
    } else {
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
    }
    this.syncWorldRuntimeWithPlayer();
    const manualStoppedState = this.updateManualMovementSettlement();
    this.updateOnlinePresence({ manualStoppedState });
    if (this.isBetaSpaceActive() && this.updateBetaSpaceState()) return;
    this.updateCamera(dt);
    this.updateStars();
    this.worldMapManager.update(dt);
    this.updateShipAnimations(dt);
    if (this.miningSession) this.updateMiningHeartbeat(dt);
  }

  buildPlayerShipSavePayload() {
    const position = this.worldMapManager.toDataVector(this.ship.position);
    return {
      ship_id: "PLAYER-SHIP-001",
      player_id: this.characterId,
      position: { x: position.x, y: position.y, z: position.z },
      rotation: {
        x: this.ship.quaternion.x,
        y: this.ship.quaternion.y,
        z: this.ship.quaternion.z,
        w: this.ship.quaternion.w
      },
      speed: this.state.speed,
      desiredSpeed: this.state.desiredSpeed
    };
  }

  buildObservedNavigationShip() {
    const state = this.buildPlayerShipSavePayload();
    const renderScale = Number(this.worldConfig.renderScale) || 0.01;
    return {
      position: state.position,
      rotation: state.rotation,
      speed: state.speed / renderScale,
      desired_speed: state.desiredSpeed / renderScale
    };
  }

  updateManualMovementSettlement() {
    const pendingBlocksSettlement = Boolean(
      this.pendingNavigationCommand
      && !this.pendingNavigationCommand.cancelRequested
    );
    const eligible = !this.isDocked()
      && !this.worldDataResetting
      && !this._deactivationLog
      && !pendingBlocksSettlement
      && this.state.autopilotPhase === null;
    const controlActive = [...this.activeActions, ...this.cameraControl.touchDpadActions]
      .some((action) => (
        action === "throttleUp"
        || action === "throttleDown"
        || this.isManualControlAction(action)
      ));
    const moving = isManualMovementActive({
      autopilotPhase: this.state.autopilotPhase,
      speed: this.state.speed,
      desiredSpeed: this.state.desiredSpeed,
      controlActive
    });
    const stopped = this.manualSettlementTracker.observe({ eligible, moving });
    if (!stopped) return null;

    const shipState = this.buildPlayerShipSavePayload();
    shipState.speed = 0;
    shipState.desiredSpeed = 0;
    void this.savePlayerShipState({
      force: true,
      shipState,
      checkpointKind: "MANUAL_STOPPED"
    });
    return shipState;
  }

  beginDeterministicNavigation(routeType, target, actionPrefix) {
    if (this.pendingNavigationCommand) {
      this.ui.showToast("navigation command pending");
      return false;
    }

    const normalizedTarget = {
      x: Number(target?.x) || 0,
      y: Number(target?.y) || 0,
      z: Number(target?.z) || 0
    };
    const clientActionId = this.worldDataManager.createNavigationActionId(actionPrefix);
    this.pendingNavigationCommand = {
      clientActionId,
      routeType,
      target: normalizedTarget,
      cancelRequested: false
    };
    this.targetMarker.visible = true;
    this.targetMarker.position.set(
      normalizedTarget.x,
      normalizedTarget.y,
      normalizedTarget.z
    );
    this.ui.showToast(routeType === "hyperdrive"
      ? "hyperdrive command pending"
      : "navigation command pending");
    this.recordAuthoritativeNavigationStart(
      routeType,
      normalizedTarget,
      clientActionId,
      { deterministic: true }
    );
    return true;
  }

  getVisiblePendingNavigation() {
    const pending = this.pendingNavigationCommand;
    return pending && !pending.cancelRequested ? pending : null;
  }

  restoreNavigationTargetMarker() {
    if (!this.navTarget) {
      this.targetMarker.visible = false;
      return;
    }
    this.targetMarker.visible = true;
    this.targetMarker.position.copy(this.navTarget);
  }

  clearPendingNavigationCommand(clientActionId) {
    if (this.pendingNavigationCommand?.clientActionId !== clientActionId) return false;
    this.pendingNavigationCommand = null;
    this.restoreNavigationTargetMarker();
    return true;
  }

  cancelPendingNavigationForManualInput() {
    const pending = this.pendingNavigationCommand;
    if (!pending || pending.cancelRequested) return false;
    pending.cancelRequested = true;
    this.restoreNavigationTargetMarker();
    this.ui.showToast("pending navigation cancelled");
    return true;
  }

  recordAuthoritativeNavigationStart(
    routeType,
    target,
    clientActionId,
    { desiredSpeed = null, deterministic = false } = {}
  ) {
    const dataTarget = target
      ? this.worldMapManager.toDataVector(new THREE.Vector3(
          Number(target.x) || 0,
          Number(target.y) || 0,
          Number(target.z) || 0
        ))
      : null;
    const observedShip = this.buildObservedNavigationShip();
    if (desiredSpeed != null) {
      const renderScale = Number(this.worldConfig.renderScale) || 0.01;
      observedShip.desired_speed = Number(desiredSpeed) / renderScale;
    }
    void this.worldDataManager.startNavigation({
      clientActionId,
      routeType,
      target: dataTarget
        ? { x: dataTarget.x, y: dataTarget.y, z: dataTarget.z }
        : null,
      observedShip
    }).then((state) => {
      if (deterministic) {
        const pending = this.pendingNavigationCommand?.clientActionId === clientActionId
          ? this.pendingNavigationCommand
          : null;
        const cancelRequested = Boolean(pending?.cancelRequested);
        this.clearPendingNavigationCommand(clientActionId);
        if (cancelRequested) {
          this.recordAuthoritativeManualOverride();
          this.navigationRecordFailed = false;
          return;
        }
      }
      if (routeType !== "deactivation") {
        const applied = this.applyAuthoritativeNavigationState(state, {
          expectedClientActionId: clientActionId
        });
        if (deterministic && applied) {
          const contract = state.activeContract;
          const remainingSeconds = contract
            ? Math.max(0, contract.arriveAt - this.worldDataManager.getEstimatedNavigationServerNow()) / 1000
            : 0;
          this.ui.showToast(routeType === "hyperdrive"
            ? "hyperdrive engaged"
            : `navigation engaged (~${Math.round(remainingSeconds)}s)`);
          this.updateOnlinePresence({ force: true });
        }
      }
      this.navigationRecordFailed = false;
    }).catch((error) => {
      const cancelRequested = deterministic
        && this.pendingNavigationCommand?.clientActionId === clientActionId
        && this.pendingNavigationCommand.cancelRequested;
      if (deterministic) this.clearPendingNavigationCommand(clientActionId);
      this.handleNavigationRecordFailure(error);
      if (cancelRequested) this.recordAuthoritativeManualOverride();
    });
  }

  recordAuthoritativeManualOverride() {
    const renderScale = Number(this.worldConfig.renderScale) || 0.01;
    const desiredSpeed = this.state.desiredSpeed / renderScale;
    const shouldApplyAuthority = Boolean(
      this.worldDataManager.getNavigationState().activeContract
    );
    void this.worldDataManager.manualOverrideNavigation({ desiredSpeed })
      .then((state) => {
        if (shouldApplyAuthority) this.applyAuthoritativeNavigationState(state);
        this.navigationRecordFailed = false;
      })
      .catch((error) => this.handleNavigationRecordFailure(error));
  }

  handleNavigationRecordFailure(error) {
    console.error("[navigation] authoritative command failed.", error);
    if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
      this.applyAuthoritativeNavigationState(this.worldDataManager.getNavigationState());
      this.navigationRecordFailed = false;
      this.ui.showErrorToast(error?.message || "navigation command rejected");
      return;
    }
    this.applyAuthoritativeNavigationState(this.worldDataManager.getNavigationState());
    if (!this.navigationRecordFailed) {
      if (error?.code !== "MOVEMENT_COMMAND_NOT_CONFIRMED") {
        this.ui.showErrorToast("navigation server record failed; offline state");
      }
    }
    this.navigationRecordFailed = true;
    clearTimeout(this.navigationRebaseTimer);
    this.navigationRebaseTimer = setTimeout(async () => {
      if (this.disposed) return;
      try {
        const state = await this.worldDataManager.refreshNavigationState();
        this.applyAuthoritativeNavigationState(state);
        this.navigationRecordFailed = false;
        this.ui.showToast("navigation server reconnected");
        this.updateOnlinePresence({ force: true });
      } catch (reconnectError) {
        console.warn("[navigation] server rebase retry failed.", reconnectError);
      }
    }, 10000);
  }

  handleNavigationCommandStatus({ status, clientActionId }) {
    if (status === "DELIVERY_UNKNOWN") {
      this.unknownNavigationCommands.add(clientActionId);
      this.ui.showToast("server response pending");
      return;
    }
    const wasUnknown = this.unknownNavigationCommands.delete(clientActionId);
    if (status === "ACCEPTED" && wasUnknown) {
      this.ui.showToast("server command confirmed");
    } else if (status === "EXPIRED") {
      this.ui.showErrorToast("command expired without server confirmation");
    }
  }

  updateOnlinePresence({ force = false, manualStoppedState = null } = {}) {
    if (!this.presenceClient || !this.remotePlayerManager || !this.worldMapManager?.snapshot) return;
    if (document.visibilityState === "hidden") {
      this.setOnlinePresenceUnavailable();
      return;
    }
    if (this.isDocked() || this.worldDataResetting) {
      this.setOnlinePresenceUnavailable();
      return;
    }

    const dataPosition = manualStoppedState?.position || this.getPlayerDataPosition();
    const zoneId = this.isBetaSpaceActive() ? "BETA-SPACE" : this.getPresenceZoneId(dataPosition);
    if (!zoneId) {
      this.setOnlinePresenceUnavailable();
      return;
    }

    const zoneChanged = zoneId !== this.presenceZoneId;
    if (zoneChanged) {
      this.presenceZoneId = zoneId;
      this.presenceRouteSignature = null;
      this.remotePlayerManager.clear();
      this.presenceClient.ensureZone(zoneId, {
        worldId: this.worldBootstrap.worldId
      });
    }
    this.refreshAuthorityFieldShips(zoneId, { force: zoneChanged });

    const authorityRouteActive = this.state.autopilotPhase !== null;
    if (authorityRouteActive) {
      this.presenceRouteSignature = null;
      this.presenceClient.clearLatestState();
      return;
    }

    this.presenceRouteSignature = null;
    if (!force && !manualStoppedState) return;
    const rotation = manualStoppedState?.rotation || {
      x: this.ship.quaternion.x,
      y: this.ship.quaternion.y,
      z: this.ship.quaternion.z,
      w: this.ship.quaternion.w
    };
    this.presenceClient.publishPose({
      seq: ++this.presenceSequence,
      ship_id: this.selectedShipId,
      position: dataPosition,
      rotation,
      velocity: { x: 0, y: 0, z: 0 },
      speed: manualStoppedState ? 0 : this.state.speed
    });
  }

  getPresenceZoneId(dataPosition) {
    const sector = this.worldDataManager.getSectorAtPosition(
      dataPosition.x,
      dataPosition.y,
      dataPosition.z
    );
    if (sector?.sector_id) return sector.sector_id;
    return this.worldDataManager.getChunkDataAtPosition(dataPosition).chunk_id || null;
  }

  refreshAuthorityFieldShips(zoneId, { force = false } = {}) {
    const now = Date.now();
    if (
      this.fieldShipRefreshPending
      || (!force && now - this.fieldShipLastRefreshedAt < this.fieldShipRefreshInterval)
    ) {
      return;
    }
    this.fieldShipRefreshPending = true;
    this.fieldShipLastRefreshedAt = now;
    void this.onlineApi.listZoneShips(zoneId)
      .then((result) => {
        if (this.presenceZoneId !== zoneId) return;
        this.remotePlayerManager?.replaceFieldPeers(result.peers);
      })
      .catch((error) => {
        console.warn("[navigation] field ship snapshot unavailable.", error);
      })
      .finally(() => {
        this.fieldShipRefreshPending = false;
      });
  }

  setOnlinePresenceUnavailable() {
    if (!this.presenceZoneId && this.presenceClient?.state === "disconnected") return;
    this.presenceZoneId = null;
    this.presenceRouteSignature = null;
    this.fieldShipLastRefreshedAt = 0;
    this.presenceClient?.disconnect();
    this.remotePlayerManager?.clear();
  }

  savePlayerShipState({
    force = false,
    shipState = null,
    checkpointKind = "SNAPSHOT"
  } = {}) {
    if (this.isDocked()) return;
    if (this._deactivationLog) return;
    if (this.pendingNavigationCommand) return;
    if (!force && this.state.autopilotPhase !== null) return;
    if (!this.worldDataManager.db || this.worldDataResetting) return;

    const snapshot = shipState || this.buildPlayerShipSavePayload();
    this.playerShipSavePendingCount += 1;
    return this.worldDataManager.savePlayerShipState(snapshot, { checkpointKind })
      .then((savedState) => {
        this.navigationRecordFailed = false;
        return savedState;
      })
      .catch((error) => {
        this.handleNavigationRecordFailure(error);
        return null;
      })
      .finally(() => {
        this.playerShipSavePendingCount = Math.max(0, this.playerShipSavePendingCount - 1);
      });
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

    const prefix = "beta-void-";
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
    while (this.playerShipSavePendingCount > 0 && performance.now() - startedAt < 1500) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }

  clearStorageNamespace(storage) {
    const prefix = "beta-void-";
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
    if (this.isDocked()) this.applyDockingEnvironment(this.getEnvironmentPreset(nextMode));
    this.ui.setEnvironmentMode(nextMode);
    this.minimapManager?.setEnvironmentMode(nextMode);
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
    } else if (key === "stylizedRenderMode") {
      nextValue = normalizeStylizedRenderMode(value);
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
    } else if (key === "stylizedRenderMode") {
      this.renderPipeline?.setStylizedRenderMode(nextSettings.stylizedRenderMode);
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
        ? this.buildingDefinitions[object.building_id]
        : kind === "resource"
          ? this.resourceDefinitions[object.resource_id || object.type]
          : null;
      const producedItem = kind === "resource"
        ? this.itemDefinitions[definition?.produces_item_id]
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
        activeResetAt: object.active_reset_at ?? null,
        activeResetIntervalMinutes: object.active_reset_interval_minutes ?? null,
        variantId: object.variant_id ?? null,
        sectorId: object.sector_id ?? null,
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
    if (this.isMiningBusy()) { this.ui.showToast("stop gathering first"); return; }
    if (this.isDocked()) {
      this.ui.showToast("undock to navigate");
      return;
    }
    this.setTarget(object.target);
  }

  hyperdriveToWorldObject(object) {
    if (!object?.target) return;
    if (this.isMiningBusy()) { this.ui.showToast("stop gathering first"); return; }
    this.initiateHyperdrive(object.target);
  }

  // =====================================================================
  // Mining Action System bridge (Phase 2 lifecycle + Phase 3 UI controller)
  // Data authority lives in WorldDataManager.startGathering/stopGathering/
  // settleNode/deriveNodeState. Here we drive the session, the visual + safety
  // settle heartbeats, and reconnect/pagehide settlement.
  // =====================================================================

  // Mining proximity, expressed in data-space (node distances are data-space).
  getMiningRange() {
    const renderScale = Number(this.config.renderScale) || 0.01;
    const arrivalData = (Number(this.shipStats.arrivalRadius) || 0) / renderScale;
    return Math.max(arrivalData * 2, 8000);
  }

  findResourceListItem(objectId) {
    const list = this.getWorldObjectList();
    return (list.resources || []).find((item) => item.id === objectId) || null;
  }

  describeGatherReason(reason) {
    switch (reason) {
      case "already-gathering": return "already gathering this node";
      case "node-depleted": return "resource depleted";
      case "zero-yield": return "cannot gather here";
      case "missing-node": return "resource unavailable";
      default: return "gather failed";
    }
  }

  isMiningBusy() {
    return !!(this.miningSession || this.miningAligning);
  }

  // Synchronous snapshot for the UI (button label / range / live progress).
  // Progress comes from the cached read-only derive refreshed by the heartbeat.
  getGatherState(objectId) {
    const item = this.findResourceListItem(objectId);
    const gathering = this.miningSession?.nodeId === objectId || this.miningAligning?.nodeId === objectId;
    const inRange = item ? (Number(item.distance) || Infinity) <= this.getMiningRange() : false;
    const derive = gathering && this._lastGatherDerive?.nodeId === objectId ? this._lastGatherDerive : null;
    return {
      exists: !!item,
      gathering,
      inRange,
      blocked: this.isDocked() || this.isBetaSpaceActive(),
      gathered: derive ? derive.gathered : 0,
      planned: derive ? derive.planned : 0
    };
  }

  // Begins the LOCAL alignment delay (not a timestamped action). The gathering
  // log is created only after the ship finishes facing the node — see
  // updateMiningAlignment -> commitMiningStart.
  startGatheringAtObject(object) {
    const nodeId = object?.id;
    if (!nodeId) return;
    if (this.isMiningBusy()) { this.ui.showToast("already gathering"); return; }
    if (this.isDocked()) { this.ui.showToast("undock to gather"); return; }
    if (this.isBetaSpaceActive()) return;

    const cargo = this.getActiveShipCargoStorage();
    if (!cargo?.storage_id) { this.ui.showToast("no cargo hold"); return; }

    const item = this.findResourceListItem(nodeId);
    if (!item) { this.ui.showToast("resource unavailable"); return; }
    if ((Number(item.distance) || Infinity) > this.getMiningRange()) {
      this.ui.showToast("approach the resource node");
      return;
    }

    if (this.state.autopilotPhase !== null) this.cancelAutopilot();
    const t = item.target || {};
    this.miningAligning = {
      nodeId,
      storageId: cargo.storage_id,
      targetPos: new THREE.Vector3(Number(t.x) || 0, Number(t.y) || 0, Number(t.z) || 0),
      committing: false
    };
    this.ui.setGatheringState({ active: true });
    this.ui.showToast("aligning to resource node");
  }

  // Per-frame alignment: rotate the ship to face the node, holding position.
  // Once aligned, the gathering log is created (the "delay" the user requested).
  updateMiningAlignment(dt) {
    const pending = this.miningAligning;
    if (!pending || pending.committing) return;
    this.setSpeed(0);
    this.state.desiredSpeed = 0;

    const dir = pending.targetPos.clone().sub(this.ship.position).normalize();
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion);
    this.lookMatrix.lookAt(dir, new THREE.Vector3(0, 0, 0), this.vectors.up);
    this.quaternions.desired.setFromRotationMatrix(this.lookMatrix);
    const rate = Math.min(1, Math.min(this.shipStats.pitchRate, this.shipStats.yawRate) * dt);
    this.ship.quaternion.slerp(this.quaternions.desired, rate).normalize();
    this.ship.getWorldDirection(this.vectors.forward);
    if (this.vectors.forward.dot(dir) > 0.99999) {
      pending.committing = true;
      void this.commitMiningStart();
    }
  }

  // Alignment finished -> create the gathering log (authority side).
  async commitMiningStart() {
    const pending = this.miningAligning;
    if (!pending || this._miningBusy) return;
    this._miningBusy = true;
    try {
      const result = await this.worldDataManager.startGathering({
        nodeId: pending.nodeId,
        storageId: pending.storageId,
        actorId: this.characterId
      });
      this.miningAligning = null;
      if (!result?.ok) {
        this.ui.showToast(this.describeGatherReason(result?.reason));
        this.ui.setGatheringState({ active: false });
        return;
      }
      this.miningSession = { logId: result.logId, nodeId: pending.nodeId, storageId: pending.storageId };
      this._miningVisAccumMs = 0;
      this._lastGatherDerive = null;
      this.driveShipMiningAnimation(true); // deploy + hold end while mining
      this.ui.showToast("gathering started");
    } finally {
      this._miningBusy = false;
    }
  }

  // Bottom stop button + bubble stop: cancels alignment or settles a session.
  async stopGatheringControl() {
    if (this.miningAligning) {
      this.miningAligning = null;
      this.ui.setGatheringState({ active: false });
      this.ui.showToast("gathering cancelled");
      return;
    }
    if (this.miningSession) await this.finalizeGathering({ manual: true });
  }

  async stopGatheringAtObject(object) {
    if (object?.id && this.miningAligning && object.id !== this.miningAligning.nodeId) return;
    if (object?.id && this.miningSession && object.id !== this.miningSession.nodeId) return;
    await this.stopGatheringControl();
  }

  // Settle the active session and tear it down. manual=true credits up to "now"
  // and cancels the log; manual=false lets deterministic completion (cargo full
  // / exhaust) finalize it. Reloads assets so the cargo hold reflects new items.
  async finalizeGathering({ manual = false } = {}) {
    const session = this.miningSession;
    if (!session || this._miningBusy) return;
    this._miningBusy = true;
    try {
      const result = manual
        ? await this.worldDataManager.stopGathering({ nodeId: session.nodeId, logId: session.logId })
        : await this.worldDataManager.settleNode({ nodeId: session.nodeId });
      this.miningSession = null;
      this._lastGatherDerive = null;
      this._miningVisAccumMs = 0;
      this.driveShipMiningAnimation(false); // retract back to rest pose
      this.ui.setGatheringState({ active: false });
      if (result?.committed) {
        await this.syncPlayerAssetsToServer("mining");
      }
      await this.loadPlayerAssets();
      if (manual && Number.isFinite(Number(result?.gathered))) {
        this.ui.showToast(`gathered ${Math.floor(Number(result.gathered))}`);
      }
    } finally {
      this._miningBusy = false;
    }
  }

  updateMiningHeartbeat(dt) {
    const dtMs = (Number(dt) || 0) * 1000;
    this._miningVisAccumMs += dtMs;
    if (this._miningVisAccumMs >= 500) { this._miningVisAccumMs = 0; void this.tickMiningDerive(); }
  }

  // Read-only projection for HUD + completion detection (no DB writes).
  async tickMiningDerive() {
    const session = this.miningSession;
    if (!session || this._miningBusy) return;
    let state;
    try { state = await this.worldDataManager.deriveNodeState(session.nodeId); }
    catch { return; }
    if (this.miningSession?.logId !== session.logId) return;
    if (!state || state.depleted) { await this.finalizeGathering({ manual: false }); return; }
    const log = (state.logs || []).find((entry) => entry.id === session.logId);
    if (!log || log.status !== "active") { await this.finalizeGathering({ manual: false }); return; }
    this._lastGatherDerive = { nodeId: session.nodeId, gathered: log.gathered, planned: log.planned_yield };
  }

  // On (re)connect: fold offline progress and resume an in-flight session.
  async resumeGatheringSessions() {
    let active;
    try {
      const logs = await this.worldDataManager.getGatheringLogs({ actorId: this.characterId, activeOnly: true });
      active = logs[0];
    } catch { return; }
    if (!active) return;

    let settleResult = null;
    try { settleResult = await this.worldDataManager.settleNode({ nodeId: active.target_node_id }); }
    catch { /* node may be gone */ }
    if (settleResult?.committed) {
      await this.syncPlayerAssetsToServer("mining");
    }
    await this.loadPlayerAssets();

    const remaining = await this.worldDataManager.getGatheringLogs({ actorId: this.characterId, activeOnly: true });
    if (remaining.find((log) => log.id === active.id)) {
      this.miningSession = { logId: active.id, nodeId: active.target_node_id, storageId: active.target_storage_id };
      this._miningVisAccumMs = 0;
      this._lastGatherDerive = null;
      this.ui.setGatheringState({ active: true });
      this._snapShipMiningToEnd(); // already mining on resume -> hold the end pose
    }
  }

  isBetaSpaceActive() {
    return this.worldDataManager.getNavigationState()?.ship?.spatialMode === "BETA_SPACE"
      || !!this.betaSpaceSession;
  }

  isDocked() {
    return this.worldDataManager.getNavigationState()?.ship?.spatialMode === "DOCKED";
  }

  // The persisted dock truth is the active ship's location storage (station_hangar vs active_ship).
  getActiveShipLocationStorage() {
    const ship = this.getActiveShipItem();
    if (!ship?.storage_id) return null;
    return (this.playerAssets?.storageLocations || []).find((storage) => storage.storage_id === ship.storage_id) || null;
  }

  // No stored "docked" state — derive it from the active ship's LOCATION: if the
  // ship sits in a station_hangar storage, it's docked there (06 §11.9). While
  // docked the ship lives in the station's docked_ships zone (server) and
  // loadPlayerAssets reconstructs that station_hangar location in memory.
  deriveDockingState() {
    const authority = this.worldDataManager.getNavigationState();
    if (authority?.ship) {
      if (authority.ship.spatialMode !== "DOCKED" || authority.custody?.type !== "BUILDING") {
        return null;
      }
      return {
        station_id: authority.custody.id,
        slot: Number.isInteger(authority.custody.slot) ? authority.custody.slot : 0
      };
    }
    const storage = this.getActiveShipLocationStorage();
    if (storage?.storage_type !== "station_hangar") return null;
    const ship = this.getActiveShipItem();
    return { station_id: storage.world_object_id, slot: Number.isInteger(ship?.dock_slot) ? ship.dock_slot : 0 };
  }

  getStationCapacity(buildingId) {
    const capacity = Number(this.buildingDefinitions[buildingId]?.docking?.capacity);
    return Number.isFinite(capacity) && capacity > 0 ? capacity : 10;
  }

  // Trade (load/unload) between the docked ship's cargo and the station's public
  // stock. direction "out" = load onto ship, "in" = unload into station. Requires
  // being docked at the station (ship lives in its docked_ships zone).
  async tradeAtDockedStation(itemId, direction, amount = 1) {
    const stationId = this.getDockedStationId();
    if (!stationId) return { ok: false, reason: "not-docked" };
    const shipUid = this.getActiveShipItem()?.item_uid || this.activeShipUid;
    if (!shipUid) return { ok: false, reason: "no-ship" };
    const result = await this.worldDataManager.runStationTrade(stationId, shipUid, { itemId, direction, amount, nowMs: Date.now() });
    if (result?.committed) {
      const synced = await this.syncPlayerAssetsToServer("trade");
      if (!synced) return { ok: false, reason: "server-sync-failed" };
    }
    await this.loadPlayerAssets(); // refresh in-memory docked cargo view
    return result;
  }

  // Lowest free hangar slot (< capacity) at a station, or -1 if full.
  async pickDockSlot(stationId, capacity) {
    const snap = await this.worldDataManager.getStationInventorySnapshot(stationId);
    const occupied = new Set((snap?.docked_ships || []).map((s) => s.dock_slot).filter(Number.isInteger));
    for (let i = 0; i < capacity; i += 1) if (!occupied.has(i)) return i;
    return -1;
  }

  // Hangar label: "{n}번 격납고" (ko) / "Hanger {n}" (en); slot is 0-based, label is 1-based.
  getHangarLabel(slot) {
    const n = (Number.isInteger(slot) ? slot : 0) + 1;
    const fallback = this.i18n.locale === "ko" ? `${n}번 격납고` : `Hanger ${n}`;
    return this.i18n.t("ui.docking.hangar", { slot: n }, fallback);
  }

  // Names are matched loosely because GLTFLoader may sanitize dots/underscores in node/clip names.
  normalizeAssetName(name) {
    return String(name || "").toLowerCase().replace(/[\s._-]/g, "");
  }

  findObjectByNameLoose(root, name) {
    if (!root) return null;
    const target = this.normalizeAssetName(name);
    let found = null;
    root.traverse((object) => {
      if (!found && this.normalizeAssetName(object.name) === target) found = object;
    });
    return found;
  }

  // Static resting docking points only (excludes the animated "anim_dockingpoint" empties).
  getDockingPoints() {
    if (!this.dockInteriorObject) return [];
    const points = [];
    this.dockInteriorObject.traverse((object) => {
      if (/^dockingpoint\d*$/.test(this.normalizeAssetName(object.name))) points.push(object);
    });
    points.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return points;
  }

  getDockPointIndexForSlot(slot) {
    const points = this.getDockingPoints();
    if (points.length === 0) return 0;
    const capacity = this.getStationCapacity(
      (this.worldMapManager?.snapshot?.buildings || [])
        .find((entry) => entry.building_instance_id === this.dockingState?.station_id)?.building_id
    );
    const slotsPerPoint = Math.max(1, Math.ceil(capacity / points.length));
    return Math.min(points.length - 1, Math.floor((Number.isInteger(slot) ? slot : 0) / slotsPerPoint));
  }

  getDockingPointForSlot(slot) {
    const points = this.getDockingPoints();
    if (points.length === 0) return null;
    return points[this.getDockPointIndexForSlot(slot)];
  }

  findAnimationClip(clips, name) {
    const target = this.normalizeAssetName(name);
    return (clips || []).find((clip) => this.normalizeAssetName(clip?.name) === target) || null;
  }

  // Drives a mixer to the end of its clips via incremental steps (the same mechanism the cutscene
  // uses), which reliably reaches the clamped end pose — unlike a single setTime jump.
  advanceDockMixerToEnd(mixer, duration) {
    if (!mixer) return;
    const step = 1 / 60;
    let elapsed = 0;
    while (elapsed < duration) {
      mixer.update(step);
      elapsed += step;
    }
    mixer.update(step); // push just past the end so LoopOnce clamps
  }

  // Measures fixed docking offsets from the ship's LANDED pose (gear deployed) so every dock
  // placement (cutscene + rest) uses one identical basis. Cached on this.dockBottomOffset/Center.
  computeDockShipOffsets(landingClip) {
    this.ship.position.copy(this.dockingPivot);
    this.ship.quaternion.identity();
    if (this.dockShipMixer && this.dockLandingAction && landingClip) {
      this.dockLandingAction.reset();
      this.dockLandingAction.play();
      this.advanceDockMixerToEnd(this.dockShipMixer, landingClip.duration); // deploy landing gear
    }
    this.ship.updateMatrixWorld(true);
    // Measure the HULL only. setFromObject(this.ship) would also fold in the engine/aux
    // glow billboards — THREE.Sprites added to the ship root by ShipVisualManager — whose
    // oversized quads hang well below the hull. That phantom volume seated the ship on the
    // glow box and floated the real landing gear. Restrict to hull geometry: skip Sprites
    // and lights (non-mesh) and the outline-shell helpers, and use each mesh's own geometry
    // bounds (not setFromObject, which would also pull in any non-hull descendants).
    const box = new THREE.Box3().makeEmpty();
    const meshBox = new THREE.Box3();
    this.ship.traverse((object) => {
      if (!object.isMesh || object.userData?.__betaVoidToonHelper) return;
      const geometry = object.geometry;
      if (!geometry?.attributes?.position) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      meshBox.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
      box.union(meshBox);
    });
    if (box.isEmpty()) {
      this.dockBottomOffset = new THREE.Vector3();
      this.dockCenterOffset = new THREE.Vector3();
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    this.dockBottomOffset = new THREE.Vector3(center.x, box.min.y, center.z);
    this.dockCenterOffset = center.clone();
  }

  // Match the ship's BOTTOM-center (landed-pose basis) to a point's world position, floating the
  // ship up so its base sits on the point, then focus the camera on the ship's center.
  placeShipAtPoint(point) {
    if (!this.ship || !point) return;
    this.ship.quaternion.identity();
    const target = point.getWorldPosition(new THREE.Vector3());
    const bottom = this.dockBottomOffset || new THREE.Vector3();
    const center = this.dockCenterOffset || new THREE.Vector3();
    this.ship.position.copy(target).sub(bottom);
    this.ship.updateMatrixWorld(true);
    this.dockingCameraFocus.copy(this.ship.position).add(center);
  }

  placeShipAtDockSlot() {
    if (!this.ship) return;
    this.ship.position.copy(this.dockingPivot);
    this.ship.quaternion.identity();
    this.dockingCameraFocus.copy(this.dockingPivot);
    const point = this.getDockingPointForSlot(this.dockingState?.slot ?? 0);
    if (!point) {
      this.ship.updateMatrixWorld(true);
      return;
    }
    if (!this.dockBottomOffset) this.computeDockShipOffsets(null); // fallback (no landing clip)
    this.placeShipAtPoint(point);
  }

  // Builds hangar/ship animation mixers and either starts the arrival cutscene (space→station)
  // or applies the resting docked pose (restore/reconnect).
  setupDockPresentation() {
    if (!this.dockInteriorObject) return;
    this.disposeDockMixers();

    const index = this.getDockPointIndexForSlot(this.dockingState?.slot ?? 0);
    const suffix = String(index + 1).padStart(3, "0");
    const hangarClips = this.dockInteriorObject.animations || [];
    const doorClip = this.findAnimationClip(hangarClips, "anim_docking");
    const slotClip = this.findAnimationClip(hangarClips, `anim_docking.${suffix}`);
    const landingClip = this.findAnimationClip(this.shipAnimationClips, "anim_landing");
    const animPoint = this.findObjectByNameLoose(this.dockInteriorObject, `anim_dockingpoint.${suffix}`);

    this.dockHangarMixer = new THREE.AnimationMixer(this.dockInteriorObject);
    const hangarClipList = [doorClip, slotClip].filter(Boolean);
    let hangarDuration = 0;
    for (const clip of hangarClipList) {
      const action = this.dockHangarMixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      hangarDuration = Math.max(hangarDuration, clip.duration);
    }

    if (landingClip) {
      this.dockShipMixer = new THREE.AnimationMixer(this.ship);
      this.dockLandingAction = this.dockShipMixer.clipAction(landingClip);
      this.dockLandingAction.setLoop(THREE.LoopOnce, 1);
      this.dockLandingAction.clampWhenFinished = true;
    }

    // Fixed placement basis = the landed pose (gear deployed); measured once for both paths.
    this.computeDockShipOffsets(landingClip);

    if (this._enterWithCutscene && animPoint && hangarClipList.length > 0) {
      // Cutscene: rewind the hangar to the start and retract the gear; both animate to the end
      // during playback. Placement still uses the fixed landed basis.
      this.dockHangarMixer.update(0);
      if (this.dockShipMixer && this.dockLandingAction) {
        this.dockLandingAction.reset();
        this.dockShipMixer.update(0);
        this.dockLandingAction.stop();
      }
      this.dockCutscene = {
        elapsed: 0,
        duration: Math.max(hangarDuration, 3 + (landingClip?.duration || 0)),
        animPoint,
        landingStarted: false
      };
      this.followAnimDockingPoint();
    } else {
      // Restore (docked at game start): only the ship's landing gear must be deployed — station
      // animations are irrelevant here. computeDockShipOffsets already deployed the gear; the dock
      // point's bind pose is already the resting position, so just settle the ship onto it.
      this.placeShipAtDockSlot();
    }
  }

  // During the cutscene the ship's bottom-center (landed basis) tracks the animated empty.
  followAnimDockingPoint() {
    const cutscene = this.dockCutscene;
    if (!cutscene) return;
    this.placeShipAtPoint(cutscene.animPoint);
  }

  updateDockCutscene(dt) {
    const cutscene = this.dockCutscene;
    if (!cutscene) return;
    cutscene.elapsed += dt;
    this.dockHangarMixer?.update(dt);
    // Ship landing animation starts 3s after the hangar animation begins.
    if (!cutscene.landingStarted && cutscene.elapsed >= 3 && this.dockLandingAction) {
      this.dockLandingAction.reset().play();
      cutscene.landingStarted = true;
    }
    this.dockShipMixer?.update(dt);
    this.followAnimDockingPoint();
    if (cutscene.elapsed >= cutscene.duration) this.endDockCutscene();
  }

  endDockCutscene() {
    this.dockCutscene = null;
    // Settle onto the static resting dock point (clips stay clamped: door open, gear deployed).
    this.placeShipAtDockSlot();
  }

  // Tears down dock mixers and restores the ship's parts (e.g. landing gear) to their bind pose.
  disposeDockMixers() {
    if (this.dockShipMixer && this.dockLandingAction) {
      this.dockLandingAction.reset();
      this.dockShipMixer.update(0);
      this.dockLandingAction.stop();
    }
    this.dockShipMixer = null;
    this.dockLandingAction = null;
    this.dockHangarMixer = null;
    this.dockCutscene = null;
    this.dockBottomOffset = null;
    this.dockCenterOffset = null;
  }

  getDockedStationId() {
    return this.worldDataManager.getNavigationState()?.custody?.id
      || this.deriveDockingState()?.station_id
      || null;
  }

  getStationName(stationId) {
    if (!stationId) return "";
    const building = (this.worldMapManager?.snapshot?.buildings || [])
      .find((entry) => entry.building_instance_id === stationId);
    if (!building) return "";
    return this.i18n.resolveDefinitionText(this.buildingDefinitions[building.building_id], "name", building.building_id);
  }

  computeUndockAnchor(stationId) {
    const resolved = this.resolveDockableStation({ id: stationId });
    if (!resolved) return null;
    const facing = resolved.facing;
    return {
      position: {
        x: resolved.dataPosition.x + facing[0] * 10,
        y: resolved.dataPosition.y + facing[1] * 10,
        z: resolved.dataPosition.z + facing[2] * 10
      },
      rotation: this.computeFacingQuaternion(facing)
    };
  }

  // Reconcile the docking presentation (scene/UI) with the persisted asset truth after an asset load.
  syncDockingPresentation() {
    const derived = this.deriveDockingState();
    const showing = !!this.dockingState;
    if (derived && !showing) {
      this.dockingState = derived;
      this.enterDockingScene();
    } else if (!derived && showing) {
      this.dockingState = null;
      this.exitDockingScene();
    } else {
      this.dockingState = derived;
    }
  }

  isDockableDefinition(definition) {
    const capacity = definition?.docking?.capacity;
    return capacity === null || (Number(capacity) || 0) > 0;
  }

  // Resolve a dock target (from a proximity prompt) to its deterministic position + facing.
  resolveDockableStation(station) {
    const id = station?.building_instance_id || station?.id;
    if (!id) return null;
    const building = (this.worldMapManager?.snapshot?.buildings || [])
      .find((entry) => entry.building_instance_id === id);
    if (!building) return null;
    const definition = this.buildingDefinitions[building.building_id];
    if (!this.isDockableDefinition(definition)) return null;
    let cache;
    try {
      cache = this.worldMapManager.getFixedObjectPosition(id);
    } catch {
      return null;
    }
    const facing = Array.isArray(definition.docking?.facing) && definition.docking.facing.length >= 3
      ? definition.docking.facing
      : [0, 0, 1];
    return {
      id,
      building_id: building.building_id,
      name: this.i18n.resolveDefinitionText(definition, "name", building.building_id),
      renderPosition: cache.renderPosition,
      dataPosition: cache.absolutePosition,
      facing
    };
  }

  isWithinDockRange(renderPosition) {
    if (!renderPosition) return false;
    const dx = this.ship.position.x - renderPosition.x;
    const dy = this.ship.position.y - renderPosition.y;
    const dz = this.ship.position.z - renderPosition.z;
    return dx * dx + dy * dy + dz * dz <= this.dockProximityRange * this.dockProximityRange;
  }

  // Live dock affordance state for a station's detail bubble (sync; uses current ship position).
  getDockState(stationId) {
    const resolved = this.resolveDockableStation({ id: stationId });
    if (!resolved) return { dockable: false, inRange: false };
    return { dockable: true, inRange: this.isWithinDockRange(resolved.renderPosition) };
  }

  // Building detail-popup storage view. PUBLIC = the building's station_inventory
  // (owner=null, tradable; F1). PRIVATE = docked ships anchored to this building
  // (owner=character) with their cargo + fitting — not tradable by others. Both
  // are anchored to the building (world_object_id); ownership is the discriminator.
  async getBuildingStorageView(buildingInstanceId) {
    // Materialize timestamp-derived production up to now before reading the snapshot.
    await this.worldDataManager.settleBuildingProduction(buildingInstanceId, Date.now());
    const snapshot = await this.worldDataManager.getStationInventorySnapshot(buildingInstanceId);
    if (!snapshot) return null;

    const itemRow = (entry) => {
      const kind = entry.kind || this.itemDefinitions[entry.item_id]?.kind || "item";
      const quantity = numberOrZero(entry.quantity);
      const unitMass = numberOrZero(this.itemDefinitions[entry.item_id]?.mass);
      return {
        item_id: entry.item_id,
        label: this.getInventoryItemDisplayName(kind, entry.item_id),
        kind,
        quantity,
        unit_mass: unitMass,
        total_mass: unitMass * quantity
      };
    };

    const publicRows = (snapshot.items || []).map(itemRow).sort((a, b) => b.total_mass - a.total_mass);

    // PRIVATE zone: docked ships live server-side in the station's docked_ships zone.
    const ships = (snapshot.docked_ships || []).map((entry) => ({
      item_uid: entry.ship_uid,
      ship_id: entry.ship_id,
      owner_character_id: entry.owner_character_id,
      label: this.getInventoryItemDisplayName("ship", entry.ship_id),
      dock_slot: Number.isInteger(entry.dock_slot) ? entry.dock_slot : null,
      cargo_rows: Object.entries(entry.cargo || {})
        .filter(([, quantity]) => numberOrZero(quantity) > 0)
        .map(([item_id, quantity]) => itemRow({ item_id, quantity }))
        .sort((a, b) => b.total_mass - a.total_mass),
      cargo_unique: (entry.cargo_unique || [])
        .map((u) => ({ item_uid: u.item_uid, item_id: u.item_id, kind: u.kind, label: this.getInventoryItemDisplayName(u.kind, u.item_id) })),
      fitting: (entry.fittings || [])
        .map((f) => ({ slot_type: f.slot_type, slot_id: f.slot_id, item_id: f.item_id, item_uid: f.item_uid, label: this.getInventoryItemDisplayName(f.slot_type, f.item_id) }))
    }));

    return {
      building_id: snapshot.building_id,
      public: {
        tradable: true,
        capacity: snapshot.capacity,
        used_mass: snapshot.used_mass,
        free_mass: snapshot.free_mass,
        rows: publicRows
      },
      private: { tradable: false, ships }
    };
  }

  // Deterministic orientation facing the station's front direction (mirrors nav heading convention).
  computeFacingQuaternion(facing) {
    const direction = new THREE.Vector3(facing[0], facing[1], facing[2]);
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
    direction.normalize();
    this.lookMatrix.lookAt(direction, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(this.lookMatrix).normalize();
    return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
  }

  // Space scene background color (themed dark/light) — used as the dock/undock fade color.
  getSpaceBackgroundColor() {
    const background = this.scene?.background;
    return background && typeof background.getHexString === "function"
      ? `#${background.getHexString()}`
      : "#000000";
  }

  async dock(station) {
    if (this.isDocked() || this.isBetaSpaceActive() || this.state.phase !== "running") return;
    if (this.isMiningBusy()) { this.ui.showToast("stop gathering first"); return; }
    const resolved = this.resolveDockableStation(station);
    if (!resolved) {
      this.ui.showErrorToast("cannot dock here");
      return;
    }
    if (!this.isWithinDockRange(resolved.renderPosition)) {
      this.ui.showToast("too far to dock");
      return;
    }

    let authorityState;
    try {
      authorityState = await this.worldDataManager.dockShip({
        buildingId: resolved.id,
        observedShip: this.buildObservedNavigationShip()
      });
    } catch (error) {
      this.ui.showErrorToast(error?.message || "docking command failed");
      return;
    }
    if (
      authorityState.ship.spatialMode !== "DOCKED"
      || authorityState.custody?.id !== resolved.id
    ) {
      this.ui.showErrorToast("docking command was not confirmed");
      return;
    }

    // DOCK acceptance atomically cancels the server movement contract.
    this.exitTargetCameraMode();
    this.clearWorldSelection();
    this.activeActions.clear();
    this.state.speed = 0;
    this.state.desiredSpeed = 0;
    this.state.autopilotPhase = null;
    this.navTarget = null;
    this.activeNavLog = null;
    this.activeNavLogId = null;
    this.hyperdriveLog = null;
    this.hyperdriveLogId = null;
    this.isHyperdrive = false;
    this.targetMarker.visible = false;

    await this.ui.fadeOut(this.getSpaceBackgroundColor(), 2000); // 2s fade to space bg, then transition

    // Custody migration (one transaction): move the active ship subtree out of the
    // player namespace into the station's docked_ships zone (server custody), so a
    // station blowing up resolves it field-locally. "Docked" is derived from the
    // ship's location (its docked_ships membership) — no stored docked state.
    const stationId = resolved.id;
    const now = Date.now();
    const dockSlot = authorityState.custody.slot;
    const result = await this.worldDataManager.dockActiveShipToStation(this.characterId, stationId, { dockSlot, nowMs: now });
    if (!result?.committed) {
      this.dockingState = { station_id: stationId, slot: dockSlot };
      this.enterDockingScene();
      this.ui.showErrorToast("docked on server; local asset cache unavailable");
      await this.ui.fadeIn(2000);
      return;
    }
    const synced = await this.syncPlayerAssetsToServer("dock");
    if (!synced) {
      await this.ui.fadeIn(2000);
      return;
    }
    this._dockCutscenePending = true; // play the arrival cutscene (only on space→station dock)
    await this.loadPlayerAssets(); // syncDockingPresentation enters the docking scene
    this.setOnlinePresenceUnavailable();
    await this.ui.fadeIn(2000); // 2s fade from space bg into the docking scene
    this.ui.showToast("docked");
  }

  async undock() {
    if (!this.isDocked()) return;
    const stationId = this.getDockedStationId();
    let authorityState;
    try {
      authorityState = await this.worldDataManager.undockShip({ buildingId: stationId });
    } catch (error) {
      this.ui.showErrorToast(error?.message || "undock command failed");
      return;
    }
    await this.ui.fadeOut(this.getSpaceBackgroundColor(), 2000); // 2s fade to space bg, then transition
    const now = Date.now();
    // Custody migration (one transaction): bring the ship subtree back from the
    // station's docked_ships zone into the player namespace; clear dock truth.
    const result = await this.worldDataManager.undockShipFromStation(this.characterId, stationId, { nowMs: now });
    if (!result?.committed) {
      this.ui.showErrorToast("undock failed");
      await this.ui.fadeIn(2000);
      return;
    }
    const synced = await this.syncPlayerAssetsToServer("undock");
    if (!synced) {
      await this.ui.fadeIn(2000);
      return;
    }
    await this.loadPlayerAssets(); // syncDockingPresentation exits the docking scene

    // The server resolves the current building coordinate before releasing custody.
    if (authorityState.ship.position) {
      this.ship.position.copy(this.worldMapManager.toRenderVector(authorityState.ship.position));
      const r = authorityState.ship.rotation;
      this.ship.quaternion.set(r.x || 0, r.y || 0, r.z || 0, Number.isFinite(Number(r.w)) ? Number(r.w) : 1).normalize();
    }
    this.state.speed = 0;
    this.state.desiredSpeed = 0;
    this.state.autopilotPhase = null;

    this.syncWorldRuntimeWithPlayer({ force: true });
    await this.refreshWorldSummary({ force: true });
    this.updateOnlinePresence({ force: true });
    await this.ui.fadeIn(2000); // 2s fade from space bg into the space scene
    this.ui.showToast("undocked");
  }

  // Mirrors the active light/dark space background + fog into the isolated docking scene,
  // so the station scene shares the same cosmic backdrop as open space.
  applyDockingEnvironment(preset = this.getEnvironmentPreset()) {
    if (!this.dockingScene) return;
    this.dockingScene.background = new THREE.Color(preset.scene.background);
    this.dockingScene.fog = new THREE.FogExp2(preset.scene.fog.color, preset.scene.fog.density);
  }

  enterDockingScene() {
    if (!this.dockingScene) {
      this.dockingScene = new THREE.Scene();
      this.dockingScene.add(new THREE.HemisphereLight(0xddeeff, 0x172033, 1.6));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
      keyLight.position.set(5, 8, 6);
      this.dockingScene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x7bdcff, 1.0);
      rimLight.position.set(-6, 3, -5);
      this.dockingScene.add(rimLight);
      // Distant star backdrop matching the space environment, centered on the station pivot (origin)
      // and cleared within the station's radius (DOCK_INTERIOR_SIZE) so no stars sit on/inside it.
      this.dockStarLayers = this.getEnvironmentPreset().starField.layers.map((layer) =>
        this.createStars(layer.count, layer.radius, layer.size, layer.opacity, {
          scene: this.dockingScene,
          excludeRadius: DOCK_INTERIOR_SIZE
        })
      );
    }
    // Match the docking backdrop (background + fog) to the active light/dark space environment.
    this.applyDockingEnvironment();
    // Re-parent the ship (with its model + local lights) into the isolated docking scene, fixed at the pivot.
    this._shipReturnParent = this.ship.parent || this.scene;
    this.dockingScene.add(this.ship);
    this.dockingOrbitTarget.identity();
    this.dockingControl.orbitDistance = Math.max(20, this.config.cameraDistance);
    this.dockingControl.dragging = false;
    this.dockingControl.pointerId = null;

    // Cutscene plays only when docking from space (consumed here), not on restore/reconnect.
    this._enterWithCutscene = this._dockCutscenePending;
    this._dockCutscenePending = false;
    this.disposeDockMixers();

    const stationName = this.getStationName(this.dockingState?.station_id);
    const hangar = this.getHangarLabel(this.dockingState?.slot ?? 0);
    this.ui.setDockingState({ active: true, stationName: stationName ? `${stationName} · ${hangar}` : hangar });
    // Docked scenes skip the running loop's location-BGM update, so switch to the dock theme here.
    // Only while the game is actually running — at initial load (reconnect-while-docked) the dock
    // scene is set up pre-start-gate, and startGame()'s enterGame() plays the dock BGM after the gate.
    if (this.state.phase === "running") this.refreshBgm();

    if (!this._enterWithCutscene) this.placeShipAtDockSlot(); // static placement (no-op until model loads)
    // Re-arm station bloom occlusion (no-op on first dock until the interior finishes loading).
    this.registerStationBloomTargets();
    if (this.dockInteriorObject) this.setupDockPresentation();
    else void this.ensureDockInterior();
  }

  // Loads the station interior model once and places it at the docking pivot (camera focus), 2x scale.
  async ensureDockInterior() {
    if (this.dockInteriorObject || this._dockInteriorPending) return;
    this._dockInteriorPending = true;
    try {
      const url = new URL("../rss/scene/dockScene_01.glb", import.meta.url).href;
      const object = await this.resourceManager.loadGlbObject(url);
      if (this.disposed || !this.dockingScene) return;
      // Designated absolute size: normalize the hangar's longest axis to DOCK_INTERIOR_SIZE
      // (= 32× ship_01), regardless of the model's authored scale.
      const interiorSize = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
      const longest = Math.max(interiorSize.x, interiorSize.y, interiorSize.z) || 1;
      object.scale.setScalar(DOCK_INTERIOR_SIZE / longest);
      object.position.copy(this.dockingPivot);
      this.dockInteriorObject = object;
      this.dockingScene.add(object);
      object.updateMatrixWorld(true);
      this.applyStationGlow(object);
      // The interior (docking points + animations) now exists — set up the dock presentation.
      if (this.isDocked()) this.setupDockPresentation();
    } catch (error) {
      console.warn("[dock-interior] load failed:", error?.message ?? error);
    } finally {
      this._dockInteriorPending = false;
    }
  }

  // Station light bloom: meshes using the "EmissiveMTL_light" material emit layer-based bloom.
  // Bloom otherwise bleeds through any geometry in front of it, so — exactly like the ship, which
  // masks its entire body — every solid (non-light) station mesh is registered as a bloom occluder.
  // Rendered black with depth into the bloom pass, the whole station (landing pads included) blocks
  // both its own light glow and the ship's bloom from drawing over geometry that occludes it.
  applyStationGlow(root) {
    if (!root) return;
    this.unregisterStationBloomTargets();
    this._stationBloomTargets = [];
    const isLightMaterial = (material) => /^EmissiveMTL_light(\.\d+)?$/.test(material?.name || "");
    const maskMaterial = this.renderPipeline?.bloomOcclusionMaterial;

    root.traverse((child) => {
      if (!child.isMesh || !child.material) return;

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const lightIndices = materials.reduce((indices, material, index) => {
        if (isLightMaterial(material)) indices.push(index);
        return indices;
      }, []);
      if (lightIndices.length === 0) {
        // Every solid station mesh occludes the bloom (mirrors the ship's whole-body masking).
        this._stationBloomTargets.push({ object: child, occlusion: true });
        return;
      }

      // Brighten the light material so it crosses the bloom threshold (depth-correct emissive).
      lightIndices.forEach((index) => {
        const material = materials[index];
        if ("emissive" in material) {
          const lit = material.emissive && material.emissive.r + material.emissive.g + material.emissive.b > 0;
          if (!lit) material.emissive.copy(material.color || new THREE.Color(0xffffff));
        }
        if ("emissiveIntensity" in material) material.emissiveIntensity = Math.max(material.emissiveIntensity || 0, 1.5);
        if ("toneMapped" in material) material.toneMapped = false;
        material.needsUpdate = true;
      });

      // Enable the bloom layer and register a bloom-only override: non-light sub-materials are
      // masked black so only the light surface contributes to (and occludes within) the bloom pass.
      child.layers.enable(this.renderPipeline.objectBloomLayerId);
      const bloomMaterials = materials.map((material, index) =>
        lightIndices.includes(index) ? material : maskMaterial);
      const bloomMaterial = bloomMaterials.length === 1 ? bloomMaterials[0] : bloomMaterials;
      this._stationBloomTargets.push({ object: child, material: bloomMaterial });
    });

    this.registerStationBloomTargets();
  }

  registerStationBloomTargets() {
    this._stationBloomTargets?.forEach(({ object, material, occlusion }) => {
      if (occlusion) this.renderPipeline?.registerOcclusionTarget(object);
      else this.renderPipeline?.registerMaterialOverrideTarget(object, material);
    });
  }

  unregisterStationBloomTargets() {
    this._stationBloomTargets?.forEach(({ object }) => {
      this.renderPipeline?.unregisterMaterialOverrideTarget(object);
    });
  }

  exitDockingScene() {
    this.disposeDockMixers(); // reset ship parts (landing gear) before returning to space
    if (this.ship) {
      (this._shipReturnParent || this.scene).add(this.ship);
    }
    this._shipReturnParent = null;
    this.dockingControl.dragging = false;
    this.dockingControl.pointerId = null;
    // Release the station bloom targets so the space scene's bloom pass ignores station meshes.
    this.unregisterStationBloomTargets();
    // Restore the bloom pipeline to the main space scene.
    this.renderPipeline?.setRenderTarget(this.scene, this.camera);
    this.ui.setDockingState({ active: false });
  }

  updateDockingScene() {
    const offset = new THREE.Vector3(0, this.config.cameraOrbitHeight, this.dockingControl.orbitDistance)
      .applyQuaternion(this.dockingOrbitTarget);
    this.camera.position.copy(this.dockingCameraFocus).add(offset);
    this.camera.quaternion.copy(this.dockingOrbitTarget);
    this.camera.up.set(0, 1, 0).applyQuaternion(this.dockingOrbitTarget).normalize();
  }

  applyDockingOrbitDrag(dx, dy) {
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * this.config.cameraOrbitSensitivity);
    this.dockingOrbitTarget.premultiply(yaw).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.dockingOrbitTarget).normalize();
    const pitch = new THREE.Quaternion().setFromAxisAngle(right, -dy * this.config.cameraOrbitSensitivity);
    this.dockingOrbitTarget.premultiply(pitch).normalize();
  }


  findBetaVoidRecord(id) {
    if (!id) return null;
    const snapshots = [
      this.worldDataManager?.snapshot,
      this.worldMapManager?.snapshot
    ];
    for (const snapshot of snapshots) {
      const betaVoid = (snapshot?.betaVoids || []).find((item) => item.id === id);
      if (betaVoid) return betaVoid;
    }
    return null;
  }

  activateAuthoritativeBetaSpace(authorityState) {
    const serverSession = authorityState?.betaSpaceSession;
    if (!serverSession || !authorityState.ship.position) return false;
    const source = this.findBetaVoidRecord(serverSession.sourceBetaVoidId) || {};
    const session = this.betaSpaceManager.enter({
      sourceBetaVoid: {
        ...source,
        id: serverSession.sourceBetaVoidId,
        active_reset_at: serverSession.expiresAt
      },
      returnState: null,
      now: serverSession.enteredAt
    });
    session.id = serverSession.sessionId;
    session.expiresAt = serverSession.expiresAt;
    session.sourceActiveResetAt = serverSession.expiresAt;
    session.spawnPosition = { ...authorityState.ship.position };
    this.betaSpaceSession = session;
    this.betaSpaceExitPending = false;
    this.worldMapManager.renderWorld(session.snapshot, authorityState.ship.position);
    this.worldMapManager.setCurrentSectorId("BETA-SPACE");
    this.ui.setBetaSpaceState({
      active: true,
      remainingMs: Math.max(0, serverSession.expiresAt - authorityState.serverTime)
    });
    this.setOnlinePresenceUnavailable();
    return true;
  }

  createBetaSpaceReturnState() {
    return {
      position: {
        x: this.ship.position.x,
        y: this.ship.position.y,
        z: this.ship.position.z
      },
      rotation: {
        x: this.ship.quaternion.x,
        y: this.ship.quaternion.y,
        z: this.ship.quaternion.z,
        w: this.ship.quaternion.w
      },
      speed: this.state.speed,
      desiredSpeed: this.state.desiredSpeed
    };
  }

  restoreBetaSpaceReturnState(returnState) {
    if (!returnState) return;
    this.ship.position.set(
      returnState.position?.x ?? 0,
      returnState.position?.y ?? 0,
      returnState.position?.z ?? 0
    );
    this.ship.quaternion.set(
      returnState.rotation?.x ?? 0,
      returnState.rotation?.y ?? 0,
      returnState.rotation?.z ?? 0,
      returnState.rotation?.w ?? 1
    ).normalize();
    this.state.speed = returnState.speed ?? 0;
    this.state.desiredSpeed = returnState.desiredSpeed ?? this.state.speed;
  }

  async enterBetaSpaceFromUi(object) {
    if (!object?.id || object.kind !== "betaVoid" || this.isBetaSpaceActive()) return;
    if (this.isMiningBusy()) { this.ui.showToast("stop gathering first"); return; }
    if (this.isDocked()) {
      this.ui.showToast("undock to enter Beta Space");
      return;
    }
    if (!this.worldDataManager.db) {
      this.ui.showErrorToast("world database unavailable");
      return;
    }

    const sourceBetaVoid = this.findBetaVoidRecord(object.id) || {
      ...object,
      active_reset_at: object.activeResetAt,
      sector_id: object.sectorId
    };
    if (sourceBetaVoid.status && sourceBetaVoid.status !== "active") {
      this.ui.showToast("Beta Void unavailable");
      return;
    }

    let authorityState;
    try {
      authorityState = await this.worldDataManager.enterBetaSpace({
        betaVoidId: sourceBetaVoid.id,
        expectedGeneration: Number(sourceBetaVoid.variant_generation) || 1,
        observedShip: this.buildObservedNavigationShip()
      });
    } catch (error) {
      if (
        error?.code === "BETA_VOID_EXPIRED"
        || error?.code === "BETA_VOID_GENERATION_CHANGED"
        || error?.code === "BETA_VOID_UNAVAILABLE"
      ) {
        try {
          const snapshot = await this.worldDataManager.refreshWorldBootstrap();
          this.worldMapManager.renderWorld(snapshot, this.getPlayerDataPosition());
          this.syncWorldRuntimeWithPlayer({ force: true });
          await this.refreshWorldSummary({ force: true });
        } catch {
          // The command rejection remains the primary feedback.
        }
      }
      this.ui.showErrorToast(error?.message || "Beta Space entry command failed");
      return;
    }

    this.exitTargetCameraMode();
    this.clearWorldSelection();
    this.activeActions.clear();
    this.activateAuthoritativeBetaSpace(authorityState);
    this.applyAuthoritativeNavigationState(authorityState);
    this.syncWorldRuntimeWithPlayer({ force: true });
    await this.refreshWorldSummary({ force: true });
    this.updateBetaSpaceState({ showToasts: false });
    this.ui.showToast("entered Beta Space");
  }

  async exitBetaSpace({ reason = "manual" } = {}) {
    const session = this.betaSpaceSession;
    if (!session || this.betaSpaceExitPending) return;
    this.betaSpaceExitPending = true;

    try {
      let authorityState;
      try {
        authorityState = await this.worldDataManager.exitBetaSpace();
      } catch (error) {
        if (error?.code !== "BETA_SESSION_NOT_ACTIVE") throw error;
        authorityState = await this.worldDataManager.refreshNavigationState();
        if (authorityState.ship.spatialMode === "BETA_SPACE") throw error;
      }

      this.activeActions.clear();
      this.exitTargetCameraMode();
      this.clearWorldSelection();
      this.betaSpaceSession = null;
      this.ui.setBetaSpaceState({ active: false });
      const snapshot = await this.worldDataManager.refreshWorldBootstrap();
      this.worldMapManager.renderWorld(snapshot, authorityState.ship.position);
      this.applyAuthoritativeNavigationState(authorityState);
      this.syncWorldRuntimeWithPlayer({ force: true });
      await this.refreshWorldSummary({ force: true });
      this.updateOnlinePresence({ force: true });
      this.ui.showToast(reason === "expired" ? "Beta Space expired" : "exited Beta Space");
    } catch (error) {
      this.ui.showErrorToast(error instanceof Error ? error.message : "Beta Space exit failed");
    } finally {
      this.betaSpaceExitPending = false;
    }
  }

  updateBetaSpaceState({ showToasts = true } = {}) {
    const session = this.betaSpaceSession;
    if (!session) return false;

    const state = this.betaSpaceManager.update(session, {
      position: this.getPlayerDataPosition(),
      now: Date.now()
    });
    if (!state) return false;

    this.ui.setBetaSpaceState({
      active: true,
      remainingMs: state.remainingMs,
      outOfBoundsRemainingMs: state.outOfBoundsRemainingMs,
      gameOverAssumed: state.gameOverAssumed
    });

    if (state.expired) {
      void this.exitBetaSpace({ reason: "expired" });
      return true;
    }

    if (showToasts) {
      if (state.boundaryEvent === "left") {
        this.ui.showToast("return to Beta Space within 10s");
      } else if (state.boundaryEvent === "returned") {
        this.ui.showToast("Beta Space boundary restored");
      } else if (state.boundaryEvent === "gameOverAssumed" && !session.gameOverToastShown) {
        session.gameOverToastShown = true;
        this.ui.showToast("game over assumed");
      }
    }

    return false;
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
    if (this.isBetaSpaceActive()) return;
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

    // Mobile frame cap: keep the rAF loop alive but skip work until the interval elapses.
    if (this._frameIntervalMs > 0) {
      const nowPerf = performance.now();
      if (this._lastRenderAt && nowPerf - this._lastRenderAt < this._frameIntervalMs) {
        this.animationFrameId = requestAnimationFrame(() => this.animate());
        return;
      }
      this._lastRenderAt = nowPerf;
    }

    // Docked: render the isolated docking scene only — the entire space simulation is skipped.
    if (this.isDocked()) {
      this._lastFrameTimestamp = Date.now();
      const dockDt = Math.min(this.clock.getDelta(), 0.05);
      if (this.dockCutscene) this.updateDockCutscene(dockDt);
      this.updateDockingScene();
      if (this.dockingScene) {
        if (this.renderPipeline) {
          this.renderPipeline.setRenderTarget(this.dockingScene, this.camera);
          this.renderPipeline.render();
        } else {
          this.renderer.render(this.dockingScene, this.camera);
        }
      }
      this.animationFrameId = requestAnimationFrame(() => this.animate());
      return;
    }

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
      !this.pendingNavigationCommand &&
      gapStartAt > this._lastDeactivationResolvedAt
    ) {
      this.activeActions.clear();
      this._commitDeactivationNavLog(nowMs - frameGapMs);
      this._resolveDeactivationNavLog();
    }

    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state.phase === "running") {
      this.update(dt);
    } else {
      this.worldMapManager?.update(dt);
    }

    this.remotePlayerManager?.update(dt);
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

    if (this.isDocked()) {
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.dockingControl.dragging = true;
      this.dockingControl.pointerId = event.pointerId;
      this.dockingControl.lastX = event.clientX;
      this.dockingControl.lastY = event.clientY;
      return;
    }

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
    if (this.isDocked()) {
      if (!this.dockingControl.dragging || this.dockingControl.pointerId !== event.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - this.dockingControl.lastX;
      const dy = event.clientY - this.dockingControl.lastY;
      this.dockingControl.lastX = event.clientX;
      this.dockingControl.lastY = event.clientY;
      if (dx !== 0 || dy !== 0) this.applyDockingOrbitDrag(dx, dy);
      return;
    }

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
    if (this.isDocked()) {
      if (this.dockingControl.pointerId === event.pointerId) {
        this.dockingControl.dragging = false;
        this.dockingControl.pointerId = null;
      }
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
        this.renderer.domElement.releasePointerCapture(event.pointerId);
      }
      return;
    }

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

  // 미니맵 토스트의 상세 버튼 — 스캐너 항목과 동일한 정보로 최상위 standalone 상세 팝업을 띄운다.
  showObjectDetailFromMinimap(ref) {
    if (!ref?.id || !this.isSelectableWorldKind(ref.kind)) return;
    const object = this.ui.findObjectInPayload(this.getWorldObjectList(), ref);
    if (!object) {
      this.ui.showErrorToast("object detail unavailable");
      return;
    }
    this.ui.openStandaloneObjectDetailPopup(object);
  }

  // 미니맵 섹터 맵에서의 선택 — 데이터 좌표를 렌더 좌표로 변환해 스캐너 선택과 동일하게 처리한다.
  selectWorldObjectFromMinimap(object) {
    if (!object?.id || !this.isSelectableWorldKind(object.kind)) return;
    const target = object.position ? this.worldMapManager.toRenderVector(object.position) : null;
    this.selectWorldObjectFromListItem({
      ...object,
      target: target ? { x: target.x, y: target.y, z: target.z } : null
    });
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
      const definition = this.buildingDefinitions[type];
      return this.i18n.resolveDefinitionText(definition, "name", this.formatObjectName(type));
    }

    const definition = this.resourceDefinitions[type];
    const producedItem = this.itemDefinitions[definition?.produces_item_id];
    return this.i18n.resolveDefinitionText(producedItem || definition, "name", this.formatObjectName(type));
  }

  getWorldSelectionIconUrl(kind, type) {
    if (kind === "betaVoid") return new URL("../rss/svg/ind_void.svg", import.meta.url).href;
    if (kind !== "building") return new URL("../rss/svg/ind_loot.svg", import.meta.url).href;

    const size = this.buildingDefinitions[type]?.size;
    if (size === "EX") return new URL("../rss/svg/ind_ex.svg", import.meta.url).href;
    if (size === "L") return new URL("../rss/svg/ind_large.svg", import.meta.url).href;
    if (size === "S") return new URL("../rss/svg/ind_small.svg", import.meta.url).href;
    return new URL("../rss/svg/ind_medium.svg", import.meta.url).href;
  }

  getWorldSelectionFallbackRadius(kind, type) {
    if (kind === "betaVoid") return 30;

    const definition = kind === "building"
      ? this.buildingDefinitions[type]
      : this.resourceDefinitions[type];
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
      const cancelledPending = isNewAction
        ? this.cancelPendingNavigationForManualInput()
        : false;
      if (isNewAction && this.state.autopilotPhase !== null && this.shouldAutopilotCancelOnKey(action)) {
        this.clearTarget(
          this.isHyperdrive ? "hyperdrive cancelled" : "autopilot cancelled",
          false,
          { recordServer: !cancelledPending }
        );
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
    if (this.isDocked()) {
      this.dockingControl.orbitDistance = THREE.MathUtils.clamp(
        this.dockingControl.orbitDistance + event.deltaY * this.config.cameraZoomSensitivity,
        8,
        200
      );
      return;
    }
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

    const isFlightAction = action === "throttleUp" || action === "throttleDown"
      || action === "maxSpeed" || action === "stopSpeed"
      || this.isManualControlAction(action);
    const cancelledPending = isFlightAction
      ? this.cancelPendingNavigationForManualInput()
      : false;

    if (this.state.autopilotPhase !== null && this.shouldAutopilotCancelOnKey(action)) {
      this.clearTarget(
        this.isHyperdrive ? "hyperdrive cancelled" : "autopilot cancelled",
        false,
        { recordServer: !cancelledPending }
      );
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
    clearTimeout(this.navigationRebaseTimer);

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
    this.dialogue?.dispose();
    this.closeFittingPreview();
    this.targetingOverlay.dispose();
    this.minimapManager?.dispose();
    this.presenceClient?.dispose();
    this.remotePlayerManager?.dispose();
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
