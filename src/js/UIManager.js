const WARP_HUD_SVG_NS = "http://www.w3.org/2000/svg";
const WARP_HUD_BLOCK_COUNT = 24;
const WARP_HUD_BASE_GAP_ANGLE = 6;
const WARP_HUD_MERGED_GAP_ANGLE = 0;
const WARP_HUD_MORPH_DURATION = 1000;
const WARP_HUD_BASE_OUTER_R = 32;
const WARP_HUD_RING_THICKNESS = 12;
const WARP_HUD_MORPH_INSET = -8;
const WARP_HUD_CURRENT_BASE_R = 34;
const WARP_HUD_CURRENT_MORPH_R = 34;
const WARP_HUD_CURRENT_DOT_R = 0.725;
const WARP_HUD_COMPLETE_DURATION = 1000;
const WARP_HUD_DAY_SECONDS = 86400;

export class UIManager {
  constructor({
    config,
    shipStats,
    shipDefinitions = {},
    shipCombatSummaries = {},
    weaponDefinitions = {},
    shieldDefinitions = {},
    equipmentDefinitions = {},
    combatCompatibilityDefinitions = {},
    defaultShipId = "ship_01",
    i18n,
    keyBindings,
    keyBindingGroups,
    defaultKeyBindings
  }) {
    this.config = config;
    this.shipStats = shipStats;
    this.shipDefinitions = shipDefinitions || {};
    this.shipCombatSummaries = shipCombatSummaries || {};
    this.weaponDefinitions = weaponDefinitions || {};
    this.shieldDefinitions = shieldDefinitions || {};
    this.equipmentDefinitions = equipmentDefinitions || {};
    this.combatCompatibilityDefinitions = combatCompatibilityDefinitions || {};
    this.defaultShipId = defaultShipId;
    this.i18n = i18n || {
      t: (key, params = {}, fallback = key) => fallback,
      resolveDefinitionText: (definition, field = "name", fallback = "") => definition?.[field] || fallback,
      formatNumber: (value, options = {}) => new Intl.NumberFormat("en", options).format(value)
    };
    this.keyBindings = { ...keyBindings };
    this.keyBindingGroups = keyBindingGroups;
    this.defaultKeyBindings = { ...defaultKeyBindings };
    this.toastTimer = 0;
    this.errorToastQueue = [];
    this.errorToastActive = false;
    this.startStage = "standby";
    this.loadingProgressValue = 0;
    this.loadingProgressTarget = 0;
    this.loadingProgressFrameId = 0;
    this.loadingProgressStartedAt = 0;
    this.loadingReadyTimer = 0;
    this.pendingBindingAction = null;
    this.settingsReturnFocus = null;
    this.targetPopupReturnFocus = null;
    this.objectListReturnFocus = null;
    this.playerPopupReturnFocus = null;
    this.cameraIconSwapTimer = 0;
    this.cameraIconSwapToken = 0;
    this.bottomNavIconSourceCache = new Map();
    this.bottomNavIconDataCache = new Map();
    this.objectRowIconFetchCache = new Map();
    this.objectRowIconTintedCache = new Map();
    this.selectedWorldObjectSummary = null;
    this.selectedObjectListTargetId = null;
    this.renderedObjectList = [];
    this.objectListPayload = { buildings: [], resources: [], betaVoids: [] };
    this.fittingState = null;
    this.objectListCategory = "resources";
    this.objectListSort = {
      buildings: "sector",
      resources: "sector",
      betaVoids: "sector"
    };
    this.cargoDisplayKind = "all";
    this.playerProfile = null;
    this.onKeyBindingsChange = null;
    this.onRequestObjectList = null;
    this.onSelectWorldObject = null;
    this.onNavigateToWorldObject = null;
    this.onClearWorldSelection = null;
    this.onEnterTargetCam = null;
    this.onEnterBetaSpace = null;
    this.onExitBetaSpace = null;
    this.onDock = null;
    this.onUndock = null;
    this.onGetDockState = null;
    this.onGetBuildingStorage = null;
    this.onTradeAtStation = null;
    this.dockingUi = null;
    this._dockingActive = false;
    this._dockingStationName = "";
    this._started = false;
    this._dockBubbleRefreshTimer = 0;
    this._fadeOverlay = null;
    this.onOpenFittingSimulator = null;
    this.onCloseFittingSimulator = null;
    this.onBuildFittingSummary = null;
    this.onGetFittingCandidates = null;
    this.onCheckEquipmentOwned = null;
    this.onApplyShipLoadoutChange = null;
    this.onRefreshPlayerAssets = null;
    this.onGetActiveShipCargo = null;
    this.onGatherWorldObject = null;
    this.onStopGatherWorldObject = null;
    this.onStopGathering = null;
    this.onGetGatherState = null;
    this.onPlayerProfileNameChange = null;
    this.onRequestInbox = null;
    this.onOpenMessage = null;
    this.inboxView = [];
    this.messagePopupReturnFocus = null;
    this.boundBindingKeyDown = (event) => this.onBindingKeyDown(event);
    this.boundSelectionSummaryGlobalPointerDown = (event) => this.onSelectionSummaryGlobalPointerDown(event);
    this.elements = {
      startScene: this.getElement("#startScene"),
      startGateScene: this.getElement("#startGateScene"),
      startReadyScene: this.getElement("#startReadyScene"),
      startButton: this.getElement("#startButton"),
      settingsButton: this.getElement("#settingsButton"),
      settingsPopup: this.getElement("#settingsPopup"),
      settingsDetailLayer: this.getElement("#settingsDetailLayer"),
      settingsTitle: this.getElement("#settingsTitle"),
      settingsResetButton: this.getElement("#settingsResetButton"),
      settingsKeysTab: this.getElement("#settingsKeysTab"),
      settingsDataTab: this.getElement("#settingsDataTab"),
      settingsPerformanceTab: this.getElement("#settingsPerformanceTab"),
      settingsKeysPanel: this.getElement("#settingsKeysPanel"),
      settingsDataPanel: this.getElement("#settingsDataPanel"),
      settingsPerformancePanel: this.getElement("#settingsPerformancePanel"),
      settingsLanguageLabel: this.getElement("#settingsLanguageLabel"),
      settingsLanguageHint: this.getElement("#settingsLanguageHint"),
      settingsLanguageSelect: this.getElement("#settingsLanguageSelect"),
      keyBindingList: this.getElement("#keyBindingList"),
      worldSeedValue: this.getElement("#worldSeedValue"),
      worldGeneratedValue: this.getElement("#worldGeneratedValue"),
      worldSectorCountValue: this.getElement("#worldSectorCountValue"),
      worldChunkCountValue: this.getElement("#worldChunkCountValue"),
      worldResourceCountValue: this.getElement("#worldResourceCountValue"),
      worldBuildingCountValue: this.getElement("#worldBuildingCountValue"),
      worldCurrentSectorValue: this.getElement("#worldCurrentSectorValue"),
      worldCurrentChunkValue: this.getElement("#worldCurrentChunkValue"),
      worldRegenerateButton: this.getElement("#worldRegenerateButton"),
      worldReloadButton: this.getElement("#worldReloadButton"),
      dataClearButton: this.getElement("#dataClearButton"),
      environmentLightButton: this.getElement("#environmentLightButton"),
      environmentDarkButton: this.getElement("#environmentDarkButton"),
      performanceMaterialMapsOffButton: this.getElement("#performanceMaterialMapsOffButton"),
      performanceMaterialMapsOnButton: this.getElement("#performanceMaterialMapsOnButton"),
      performanceStylizedOffButton: this.getElement("#performanceStylizedOffButton"),
      performanceStylizedOutlineButton: this.getElement("#performanceStylizedOutlineButton"),
      performanceStylizedFullButton: this.getElement("#performanceStylizedFullButton"),
      performanceRenderScale50Button: this.getElement("#performanceRenderScale50Button"),
      performanceRenderScale75Button: this.getElement("#performanceRenderScale75Button"),
      performanceRenderScale100Button: this.getElement("#performanceRenderScale100Button"),
      performanceAntialiasOffButton: this.getElement("#performanceAntialiasOffButton"),
      performanceAntialiasOnButton: this.getElement("#performanceAntialiasOnButton"),
      performanceBloomNoneButton: this.getElement("#performanceBloomNoneButton"),
      performanceBloomLowButton: this.getElement("#performanceBloomLowButton"),
      performanceBloomMediumButton: this.getElement("#performanceBloomMediumButton"),
      performanceBloomHighButton: this.getElement("#performanceBloomHighButton"),
      performanceLightingOffButton: this.getElement("#performanceLightingOffButton"),
      performanceLightingOnButton: this.getElement("#performanceLightingOnButton"),
      chunkBoundsAllButton: this.getElement("#chunkBoundsAllButton"),
      chunkBoundsSectorButton: this.getElement("#chunkBoundsSectorButton"),
      chunkBoundsOffButton: this.getElement("#chunkBoundsOffButton"),
      bottomNavPlayerButton: this.getElement("#bottomNavPlayerButton"),
      bottomNavShipButton: this.getElement("#bottomNavShipButton"),
      bottomNavMessageButton: this.getElement("#bottomNavMessageButton"),
      bottomNavMessageBadge: this.getElement("#bottomNavMessageBadge"),
      messagePopup: this.getElement("#messagePopup"),
      messagePopupCloseButton: this.getElement("#messagePopupCloseButton"),
      messageList: this.getElement("#messageList"),
      playerPopup: this.getElement("#playerPopup"),
      playerPopupCloseButton: this.getElement("#playerPopupCloseButton"),
      playerProfilePortrait: this.getElement("#playerProfilePortrait"),
      playerNameInput: this.getElement("#playerNameInput"),
      playerUidValue: this.getElement("#playerUidValue"),
      playerSicValue: this.getElement("#playerSicValue"),
      loadingText: this.getElement("#loadingText"),
      loadingBar: this.getElement("#loadingBar"),
      loadingDetail: this.getElement("#loadingDetail"),
      speedControl: this.getElement("#speedControl"),
      speedGauge: this.getElement("#speedGauge"),
      speedValue: this.getElement("#speedValue"),
      speedGaugeFill: this.getElement("#speedGaugeFill"),
      speedZeroMark: this.getElement("#speedZeroMark"),
      speedTargetMark: this.getElement("#speedTargetMark"),
      locationValue: this.getElement("#locationValue"),
      touchDpad: this.getElement("#touchDpad"),
      touchDpadKnob: this.getElement("#touchDpadKnob"),
      targetingCanvas: this.getElement("#targetingCanvas"),
      selectionSummary: this.getElement("#selectionSummary"),
      selectionName: this.getElement("#selectionName"),
      selectionFocusButton: this.getElement("#selectionFocusButton"),
      selectionClearButton: this.getElement("#selectionClearButton"),
      readout: this.getElement(".readout"),
      targetPopupBackdrop: this.getElement("#targetPopupBackdrop"),
      targetForm: this.getElement("#targetForm"),
      targetX: this.getElement("#targetX"),
      targetY: this.getElement("#targetY"),
      targetZ: this.getElement("#targetZ"),
      navToggle: this.getElement("#navToggle"),
      warpToggle: this.getElement("#warpToggle"),
      warpHud: this.getElement("#warpHud"),
      warpHudGauge: this.getElement("#warpHudGauge"),
      warpHudTrackSegments: this.getElement("#warpHudTrackSegments"),
      warpHudFillSegments: this.getElement("#warpHudFillSegments"),
      warpHudCurrentArc: this.getElement("#warpHudCurrentArc"),
      warpHudCurrentDot: this.getElement("#warpHudCurrentDot"),
      warpHudValue: this.getElement("#warpHudValue"),
      betaSpaceHud: this.getElement("#betaSpaceHud"),
      betaSpaceTimeValue: this.getElement("#betaSpaceTimeValue"),
      betaSpaceBoundaryValue: this.getElement("#betaSpaceBoundaryValue"),
      betaSpaceExitButton: this.getElement("#betaSpaceExitButton"),
      bottomNavMenuButton: this.getElement("#bottomNavMenuButton"),
      bottomNavMenuStack: this.getElement("#bottomNavMenuStack"),
      bottomNavScanButton: this.getElement("#bottomNavScanButton"),
      bottomNavMainToggleButton: this.getElement("#bottomNavMainToggleButton"),
      bottomNavMainToggleIcon: this.getElement("#bottomNavMainToggleButton .bottom-nav-icon"),
      objectListPopup: this.getElement("#objectListPopup"),
      objectListPanel: this.getElement(".object-list-panel"),
      objectListCloseButton: this.getElement("#objectListCloseButton"),
      objectListCategoryTabs: this.getElement("#objectListCategoryTabs"),
      objectListCategoryCurrent: this.getElement("#objectListCategoryCurrent"),
      objectListSortControls: this.getElement("#objectListSortControls"),
      objectListContent: this.getElement("#objectListContent"),
      toast: this.getElement("#toast"),
      errorToast: this.getElement("#errorToast")
    };
    this.navActive = false;
    this.warpPending = false;
    this.warpActive = false;
    this._warpHudMode = null;
    this._warpHudCompleteTimer = null;
    this._warpHudMorph = 0;
    this._warpHudMorphTarget = 0;
    this._warpHudMorphFrameId = 0;
    this._warpHudMorphLastTs = null;
    this._warpHudOuterValue = 0;
    this._warpHudCurrentValue = 0;
    this._warpHudRenderSignature = "";
    this._warpHudCompleteToken = 0;
    this._warpHudCompleteCleanup = null;
    this.settingsTab = "data";
    this.environmentMode = "light";
    this.performanceSettings = {
      materialMaps: true,
      stylizedRenderMode: "off",
      renderResolutionScale: 1,
      bloomQuality: "medium",
      lightingEffects: true,
      antialias: false
    };
    this.chunkBoundsMode = "all";
    this.selectedShipId = this.defaultShipId;
    this.speedPointerId = null;
    this.onSetSpeed = null;
    document.documentElement.lang = this.i18n.locale || document.documentElement.lang;
    this.elements.speedGauge.setAttribute("aria-valuemin", String(this.shipStats.minSpeed));
    this.elements.speedGauge.setAttribute("aria-valuemax", String(this.shipStats.maxSpeed));
    this.initWarpHud();
    this.renderStaticText();
    this.renderLanguageSettings();
    this.renderPlayerProfile();
    this.setStartButtonText("Start");
    this.renderKeyBindings();
  }

  getElement(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }

  t(key, fallback, params = {}) {
    return this.i18n.t(key, params, fallback);
  }

  renderStaticText(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.dataset.i18n;
      if (!key) return;
      const fallback = element.dataset.i18nFallback || element.textContent.trim() || key;
      element.textContent = this.t(key, fallback);
    });

    root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      const key = element.dataset.i18nAriaLabel;
      if (!key) return;
      const fallback = element.getAttribute("aria-label") || key;
      element.setAttribute("aria-label", this.t(key, fallback));
    });

    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      const key = element.dataset.i18nTitle;
      if (!key) return;
      const fallback = element.getAttribute("title") || key;
      element.setAttribute("title", this.t(key, fallback));
    });
  }

  renderLanguageSettings() {
    const select = this.elements.settingsLanguageSelect;
    const supportedLocales = Object.keys(this.i18n.messages || {});

    select.replaceChildren();
    supportedLocales.forEach((locale) => {
      const option = document.createElement("option");
      option.value = locale;
      option.textContent = this.t(`ui.settings.languages.${locale}`, locale.toUpperCase());
      select.append(option);
    });

    select.value = this.i18n.locale;
    this.elements.settingsLanguageLabel.textContent = this.t("ui.settings.language", "Language");
    this.elements.settingsLanguageHint.textContent = this.t("ui.settings.languageHint", "Applies after reload");
  }

  bindControls({
    onPrepare,
    onStart,
    onNavigate,
    onCancelNavigate,
    onHyperdriveNavigate,
    onCancelHyperdrive,
    onHyperdriveToWorldObject,
    onSetSpeed,
    onKeyBindingsChange,
    onRegenerateWorld,
    onClearAllData,
    onReloadWorldData,
    onEnvironmentModeChange,
    onPerformanceSettingChange,
    onChunkBoundsModeChange,
    onShipSelect,
    onRequestObjectList,
    onSelectWorldObject,
    onNavigateToWorldObject,
    onClearWorldSelection,
    onEnterTargetCam,
    onEnterBetaSpace,
    onExitBetaSpace,
    onDock,
    onUndock,
    onGetDockState,
    onGetBuildingStorage,
    onTradeAtStation,
    onToggleCameraMode,
    onOpenMinimap,
    onOpenFittingSimulator,
    onCloseFittingSimulator,
    onBuildFittingSummary,
    onGetFittingCandidates,
    onCheckEquipmentOwned,
    onApplyShipLoadoutChange,
    onRefreshPlayerAssets,
    onGetActiveShipCargo,
    onGatherWorldObject,
    onStopGatherWorldObject,
    onStopGathering,
    onGetGatherState,
    onPlayerProfileNameChange,
    onRequestInbox,
    onOpenMessage
  }) {
    this.onSetSpeed = onSetSpeed;
    this.onKeyBindingsChange = onKeyBindingsChange;
    this.onRequestObjectList = typeof onRequestObjectList === "function" ? onRequestObjectList : null;
    this.onSelectWorldObject = typeof onSelectWorldObject === "function" ? onSelectWorldObject : null;
    this.onNavigateToWorldObject = typeof onNavigateToWorldObject === "function" ? onNavigateToWorldObject : null;
    this.onHyperdriveToWorldObject = typeof onHyperdriveToWorldObject === "function" ? onHyperdriveToWorldObject : null;
    this.onClearWorldSelection = typeof onClearWorldSelection === "function" ? onClearWorldSelection : null;
    this.onEnterTargetCam = typeof onEnterTargetCam === "function" ? onEnterTargetCam : null;
    this.onEnterBetaSpace = typeof onEnterBetaSpace === "function" ? onEnterBetaSpace : null;
    this.onExitBetaSpace = typeof onExitBetaSpace === "function" ? onExitBetaSpace : null;
    this.onDock = typeof onDock === "function" ? onDock : null;
    this.onUndock = typeof onUndock === "function" ? onUndock : null;
    this.onGetDockState = typeof onGetDockState === "function" ? onGetDockState : null;
    this.onGetBuildingStorage = typeof onGetBuildingStorage === "function" ? onGetBuildingStorage : null;
    this.onTradeAtStation = typeof onTradeAtStation === "function" ? onTradeAtStation : null;
    this.onOpenFittingSimulator = typeof onOpenFittingSimulator === "function" ? onOpenFittingSimulator : null;
    this.onCloseFittingSimulator = typeof onCloseFittingSimulator === "function" ? onCloseFittingSimulator : null;
    this.onBuildFittingSummary = typeof onBuildFittingSummary === "function" ? onBuildFittingSummary : null;
    this.onGetFittingCandidates = typeof onGetFittingCandidates === "function" ? onGetFittingCandidates : null;
    this.onCheckEquipmentOwned = typeof onCheckEquipmentOwned === "function" ? onCheckEquipmentOwned : null;
    this.onApplyShipLoadoutChange = typeof onApplyShipLoadoutChange === "function" ? onApplyShipLoadoutChange : null;
    this.onRefreshPlayerAssets = typeof onRefreshPlayerAssets === "function" ? onRefreshPlayerAssets : null;
    this.onGetActiveShipCargo = typeof onGetActiveShipCargo === "function" ? onGetActiveShipCargo : null;
    this.onGatherWorldObject = typeof onGatherWorldObject === "function" ? onGatherWorldObject : null;
    this.onStopGatherWorldObject = typeof onStopGatherWorldObject === "function" ? onStopGatherWorldObject : null;
    this.onStopGathering = typeof onStopGathering === "function" ? onStopGathering : null;
    this.onGetGatherState = typeof onGetGatherState === "function" ? onGetGatherState : null;
    this.onPlayerProfileNameChange = typeof onPlayerProfileNameChange === "function" ? onPlayerProfileNameChange : null;
    this.onRequestInbox = typeof onRequestInbox === "function" ? onRequestInbox : null;
    this.onOpenMessage = typeof onOpenMessage === "function" ? onOpenMessage : null;

    this.elements.startGateScene.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("#settingsButton, #settingsPopup")) return;
      if (this.startStage === "standby") onPrepare();
    });
    this.elements.startButton.addEventListener("click", (event) => {
      event.stopPropagation();
      onStart();
    });
    this.elements.settingsButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openSettings();
    });
    this.elements.settingsPopup.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === this.elements.settingsPopup) this.closeSettings();
    });
    this.elements.settingsDetailLayer.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === this.elements.settingsDetailLayer) this.closeSettingsDetail();
    });
    this.elements.settingsKeysTab.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setSettingsTab("keys");
    });
    this.elements.settingsDataTab.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setSettingsTab("data");
    });
    this.elements.settingsPerformanceTab.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setSettingsTab("performance");
    });
    this.elements.settingsResetButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.pendingBindingAction = null;
      this.setKeyBindings(this.defaultKeyBindings);
    });
    this.elements.settingsLanguageSelect.addEventListener("change", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target instanceof HTMLSelectElement ? event.target : null;
      if (!target || target.value === this.i18n.locale) return;
      if (!this.i18n.setLocale(target.value)) {
        target.value = this.i18n.locale;
        return;
      }
      window.location.reload();
    });
    this.elements.worldRegenerateButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (confirm(this.t("ui.settings.world.confirmRegenerate", "Regenerate world data?"))) onRegenerateWorld();
    });
    this.elements.dataClearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (confirm(this.t("ui.settings.world.confirmClear", "Clear all stored data? (world, player, navigation)"))) {
        onClearAllData();
      }
    });
    this.elements.worldReloadButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onReloadWorldData();
    });
    [
      this.elements.environmentLightButton,
      this.elements.environmentDarkButton
    ].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onEnvironmentModeChange === "function") {
          onEnvironmentModeChange(button.dataset.environmentMode);
        }
      });
    });
    [
      this.elements.performanceMaterialMapsOffButton,
      this.elements.performanceMaterialMapsOnButton,
      this.elements.performanceAntialiasOffButton,
      this.elements.performanceAntialiasOnButton,
      this.elements.performanceLightingOffButton,
      this.elements.performanceLightingOnButton
    ].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onPerformanceSettingChange === "function") {
          onPerformanceSettingChange(
            button.dataset.performanceToggle,
            button.dataset.performanceToggleValue === "true"
          );
        }
      });
    });
    [
      this.elements.performanceRenderScale50Button,
      this.elements.performanceRenderScale75Button,
      this.elements.performanceRenderScale100Button
    ].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onPerformanceSettingChange === "function") {
          onPerformanceSettingChange("renderResolutionScale", Number(button.dataset.renderResolutionScale));
        }
      });
    });
    [
      this.elements.performanceStylizedOffButton,
      this.elements.performanceStylizedOutlineButton,
      this.elements.performanceStylizedFullButton
    ].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onPerformanceSettingChange === "function") {
          onPerformanceSettingChange(
            button.dataset.performanceMode,
            button.dataset.performanceModeValue
          );
        }
      });
    });
    [
      this.elements.performanceBloomNoneButton,
      this.elements.performanceBloomLowButton,
      this.elements.performanceBloomMediumButton,
      this.elements.performanceBloomHighButton
    ].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onPerformanceSettingChange === "function") {
          onPerformanceSettingChange("bloomQuality", button.dataset.bloomQuality);
        }
      });
    });
    [
      this.elements.chunkBoundsAllButton,
      this.elements.chunkBoundsSectorButton,
      this.elements.chunkBoundsOffButton
    ].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onChunkBoundsModeChange(button.dataset.chunkBoundsMode);
      });
    });
    this.elements.bottomNavPlayerButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeBottomNavMenu();
      this.openPlayerPopup();
    });
    this.elements.bottomNavShipButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeBottomNavMenu();
      this.openShipInfoPopup();
    });
    this.elements.bottomNavMessageButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeBottomNavMenu();
      this.openMessageInbox();
    });
    this.elements.messagePopupCloseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeMessageInbox();
    });
    this.elements.messagePopup.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === this.elements.messagePopup) {
        this.closeMessageInbox();
      }
    });
    this.elements.messagePopup.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closeMessageInbox();
    });
    this.elements.messageList.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest("[data-message-id]");
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      this.onOpenMessage?.(row.dataset.messageId);
    });
    this.elements.playerPopupCloseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closePlayerPopup();
    });
    this.elements.playerNameInput.addEventListener("change", (event) => {
      event.preventDefault();
      void this.commitPlayerNameInput();
    });
    this.elements.playerNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.elements.playerNameInput.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.renderPlayerProfile();
        this.elements.playerNameInput.blur();
      }
    });
    this.elements.playerPopup.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === this.elements.playerPopup) {
        this.closePlayerPopup();
      }
    });
    this.elements.playerPopup.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closePlayerPopup();
    });
    this.elements.keyBindingList.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("[data-bind-action]");
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();
      this.startBindingCapture(button.dataset.bindAction);
    });
    window.addEventListener("keydown", this.boundBindingKeyDown, true);
    this.elements.readout.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onOpenMinimap === "function") onOpenMinimap();
    });
    this.elements.readout.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof onOpenMinimap === "function") onOpenMinimap();
    });
    this.elements.targetPopupBackdrop.addEventListener("click", () => this.closeTargetPopup());
    this.elements.targetForm.addEventListener("click", (event) => event.stopPropagation());
    this.elements.targetForm.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      event.stopPropagation();
      this.closeTargetPopup();
    });
    this.elements.targetForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.navActive) {
        onCancelNavigate();
        this.closeTargetPopup({ restoreFocus: false });
        return;
      }

      onNavigate({
        x: Number(this.elements.targetX.value) || 0,
        y: Number(this.elements.targetY.value) || 0,
        z: Number(this.elements.targetZ.value) || 0
      });
      this.closeTargetPopup({ restoreFocus: false });
    });
    this.elements.warpToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.warpActive) return;
      if (this.warpPending) {
        if (typeof onCancelHyperdrive === "function") onCancelHyperdrive();
        this.closeTargetPopup({ restoreFocus: false });
        return;
      }
      if (typeof onHyperdriveNavigate === "function") {
        onHyperdriveNavigate({
          x: Number(this.elements.targetX.value) || 0,
          y: Number(this.elements.targetY.value) || 0,
          z: Number(this.elements.targetZ.value) || 0
        });
      }
      this.closeTargetPopup({ restoreFocus: false });
    });
    this.elements.bottomNavScanButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeBottomNavMenu();
      await this.openObjectList();
    });
    this.elements.bottomNavMainToggleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onToggleCameraMode === "function") onToggleCameraMode();
    });
    this.elements.selectionFocusButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.onEnterTargetCam) this.onEnterTargetCam();
    });
    this.elements.selectionSummary.addEventListener("click", async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("#selectionClearButton")) return;
      if (target?.closest("#selectionFocusButton")) return;

      event.preventDefault();
      event.stopPropagation();
      await this.openSelectionSummaryBubble();
    });
    this.elements.selectionSummary.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target === this.elements.selectionClearButton) return;

      event.preventDefault();
      event.stopPropagation();
      await this.openSelectionSummaryBubble();
    });
    this.elements.selectionClearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.onClearWorldSelection) this.onClearWorldSelection();
    });
    this.elements.objectListCloseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeObjectList();
    });
    this.elements.objectListPopup.addEventListener("click", (event) => {
      this.onObjectListGlobalClick(event);
    }, true);
    this.elements.objectListPopup.addEventListener("click", (event) => {
      event.stopPropagation();
      const target = event.target instanceof Element ? event.target : null;
      const selectButton = target?.closest("[data-object-select-id]");
      if (selectButton) {
        event.preventDefault();
        const object = this.findRenderedObject(selectButton.dataset.objectSelectId);
        if (!object || !this.onSelectWorldObject) return;

        this.onSelectWorldObject(object);
        this.closeObjectList({ restoreFocus: false });
        return;
      }

      const detailButton = target?.closest("[data-object-detail-id]");
      if (detailButton) {
        event.preventDefault();
        const object = this.findRenderedObject(detailButton.dataset.objectDetailId);
        if (object) this.openObjectDetailPopup(object);
        return;
      }

      const navButton = target?.closest("[data-object-nav-id]");
      if (navButton) {
        event.preventDefault();
        const object = this.findRenderedObject(navButton.dataset.objectNavId);
        if (!object || !this.onNavigateToWorldObject) return;

        this.onNavigateToWorldObject(object);
        this.closeObjectList({ restoreFocus: false });
        return;
      }

      const hyperdriveButton = target?.closest("[data-object-hyperdrive-id]");
      if (hyperdriveButton) {
        event.preventDefault();
        const object = this.findRenderedObject(hyperdriveButton.dataset.objectHyperdriveId);
        if (!object || !this.onHyperdriveToWorldObject) return;

        this.onHyperdriveToWorldObject(object);
        this.closeObjectList({ restoreFocus: false });
        return;
      }

      const betaSpaceButton = target?.closest("[data-beta-space-enter-id]");
      if (betaSpaceButton) {
        event.preventDefault();
        const object = this.findRenderedObject(betaSpaceButton.dataset.betaSpaceEnterId);
        if (!object || !this.onEnterBetaSpace) return;

        this.onEnterBetaSpace(object);
        this.closeObjectList({ restoreFocus: false });
        return;
      }

      const gatherButton = target?.closest("[data-object-gather-id]");
      if (gatherButton instanceof HTMLButtonElement) {
        event.preventDefault();
        if (gatherButton.disabled) return;
        const object = this.findRenderedObject(gatherButton.dataset.objectGatherId);
        if (!object) return;
        if (gatherButton.dataset.gatherMode === "stop") this.onStopGatherWorldObject?.(object);
        else this.onGatherWorldObject?.(object);
        return;
      }

      const dockButton = target?.closest("[data-dock-id]");
      if (dockButton instanceof HTMLButtonElement) {
        event.preventDefault();
        if (dockButton.disabled) return;
        const object = this.findRenderedObject(dockButton.dataset.dockId);
        if (!object || !this.onDock) return;

        this.onDock(object);
        this.closeObjectList({ restoreFocus: false });
        return;
      }

      if (event.target === this.elements.objectListPopup) {
        this.closeObjectList();
        return;
      }
    });
    this.elements.objectListPopup.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      event.stopPropagation();
      this.closeObjectList();
    });
    this.elements.objectListContent.addEventListener("click", (event) => this.onObjectListClick(event));
    this.elements.objectListCategoryTabs.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-object-category-step]") : null;
      if (!(target instanceof HTMLElement)) return;

      event.preventDefault();
      event.stopPropagation();
      this.stepObjectListCategory(Number(target.dataset.objectCategoryStep));
    });
    this.elements.objectListSortControls.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-object-sort]") : null;
      const toggle = event.target instanceof Element ? event.target.closest("[data-object-sort-toggle]") : null;

      if (toggle instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        const dropdown = toggle.closest(".object-list-sort-dropdown");
        const shouldOpen = !dropdown?.classList.contains("open");
        this.closeObjectListSortDropdowns();
        if (shouldOpen) dropdown?.classList.add("open");
        return;
      }

      if (!(target instanceof HTMLElement)) return;

      event.preventDefault();
      event.stopPropagation();
      this.setObjectListSort(target.dataset.objectSort);
    });

    this.elements.speedControl.addEventListener("pointerdown", (event) => this.onSpeedPointerDown(event));
    this.elements.speedControl.addEventListener("pointermove", (event) => this.onSpeedPointerMove(event));
    this.elements.speedControl.addEventListener("pointerup", (event) => this.onSpeedPointerEnd(event));
    this.elements.speedControl.addEventListener("pointercancel", (event) => this.onSpeedPointerEnd(event));
    this.elements.speedGauge.addEventListener("keydown", (event) => this.onSpeedKeyDown(event));
    this.elements.betaSpaceExitButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onExitBetaSpace?.();
    });
    this.elements.errorToast.addEventListener("click", () => this.dismissErrorToast());
    document.addEventListener("pointerdown", this.boundSelectionSummaryGlobalPointerDown, true);
  }

  openTargetPopup() {
    if (!this.elements.targetForm.hidden) return;

    this.targetPopupReturnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : this.elements.readout;
    this.elements.targetPopupBackdrop.hidden = false;
    this.elements.targetForm.hidden = false;
    this.elements.targetForm.classList.add("open");
    this.elements.readout.setAttribute("aria-expanded", "true");

    try {
      this.elements.targetX.focus({ preventScroll: true });
    } catch {
      this.elements.targetX.focus();
    }
  }

  closeTargetPopup({ restoreFocus = true } = {}) {
    if (this.elements.targetForm.hidden) return;

    const activeElement = document.activeElement;
    this.elements.targetForm.classList.remove("open");
    this.elements.targetForm.hidden = true;
    this.elements.targetPopupBackdrop.hidden = true;
    this.elements.readout.setAttribute("aria-expanded", "false");

    if (activeElement instanceof HTMLElement && this.elements.targetForm.contains(activeElement)) {
      activeElement.blur();
    }

    if (restoreFocus) {
      const focusTarget = this.targetPopupReturnFocus instanceof HTMLElement && document.contains(this.targetPopupReturnFocus)
        ? this.targetPopupReturnFocus
        : this.elements.readout;
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
    }

    this.targetPopupReturnFocus = null;
  }

  closeBottomNavMenu() {
    this.elements.bottomNavMenuStack.classList.remove("open");
    this.elements.bottomNavMenuButton.setAttribute("aria-expanded", "false");
    this.elements.bottomNavMenuButton.setAttribute("aria-label", "Open menu");
  }

  async openObjectList({ revealObject = null, returnFocus = null } = {}) {
    const revealCategory = this.getObjectListCategoryForKind(revealObject?.kind);
    if (revealCategory) this.objectListCategory = revealCategory;

    this.objectListReturnFocus = returnFocus instanceof HTMLElement
      ? returnFocus
      : document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : this.elements.bottomNavScanButton;
    this.selectedObjectListTargetId = null;
    this.elements.objectListContent.replaceChildren();
    this.renderObjectListSortControls();
    this.elements.objectListPopup.hidden = false;
    this.elements.objectListPopup.removeAttribute("inert");
    this.elements.objectListPopup.classList.add("open");
    this.elements.objectListPopup.setAttribute("aria-hidden", "false");

    try {
      const payload = this.onRequestObjectList ? await this.onRequestObjectList() : { buildings: [], resources: [], betaVoids: [] };
      this.renderObjectList(payload || { buildings: [], resources: [], betaVoids: [] });
    } catch {
      this.renderObjectList({ buildings: [], resources: [], betaVoids: [] });
      this.showErrorToast("scanner unavailable");
    }

    const revealed = revealObject?.id
      ? this.revealObjectListBubble(revealObject)
      : null;
    if (revealObject?.id && !revealed) {
      this.showErrorToast("selected object unavailable");
    }

    const focusTarget = revealed?.querySelector("button") || this.elements.objectListCloseButton;
    try {
      focusTarget.focus({ preventScroll: true });
    } catch {
      focusTarget.focus();
    }
  }

  closeObjectList({ restoreFocus = true } = {}) {
    if (this.elements.objectListPopup.hidden) return;

    const activeElement = document.activeElement;
    this.elements.objectListPopup.classList.remove("open");
    this.elements.objectListPopup.hidden = true;
    this.elements.objectListPopup.setAttribute("aria-hidden", "true");
    this.elements.objectListPopup.setAttribute("inert", "");
    this.selectedObjectListTargetId = null;
    this.closeObjectListTransient();
    this.closeObjectDetailPopup();

    if (activeElement instanceof HTMLElement && this.elements.objectListPopup.contains(activeElement)) {
      activeElement.blur();
    }

    if (restoreFocus) {
      const focusTarget = this.objectListReturnFocus instanceof HTMLElement && document.contains(this.objectListReturnFocus)
        ? this.objectListReturnFocus
        : this.elements.bottomNavScanButton;
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
    }

    this.objectListReturnFocus = null;
  }

  openPlayerPopup() {
    this.playerPopupReturnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : this.elements.bottomNavPlayerButton;
    this.renderPlayerProfile();
    if (this.elements.playerPopup.parentElement !== document.body) {
      document.body.append(this.elements.playerPopup);
    }
    this.elements.playerPopup.hidden = false;
    this.elements.playerPopup.removeAttribute("inert");
    this.elements.playerPopup.classList.add("open");
    this.elements.playerPopup.setAttribute("aria-hidden", "false");
    try {
      this.elements.playerPopupCloseButton.focus({ preventScroll: true });
    } catch {
      this.elements.playerPopupCloseButton.focus();
    }
  }

  closePlayerPopup({ restoreFocus = true } = {}) {
    if (this.elements.playerPopup.hidden) return;

    const activeElement = document.activeElement;
    this.elements.playerPopup.classList.remove("open");
    this.elements.playerPopup.hidden = true;
    this.elements.playerPopup.setAttribute("aria-hidden", "true");
    this.elements.playerPopup.setAttribute("inert", "");

    if (activeElement instanceof HTMLElement && this.elements.playerPopup.contains(activeElement)) {
      activeElement.blur();
    }

    if (restoreFocus) {
      const focusTarget = this.playerPopupReturnFocus instanceof HTMLElement && document.contains(this.playerPopupReturnFocus)
        ? this.playerPopupReturnFocus
        : this.elements.bottomNavPlayerButton;
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
    }

    this.playerPopupReturnFocus = null;
  }

  setInboxState(view) {
    this.inboxView = Array.isArray(view) ? view : [];
    const unreadCount = this.inboxView.filter((message) => !message.read).length;
    const badge = this.elements.bottomNavMessageBadge;
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badge.hidden = unreadCount === 0;
    if (!this.elements.messagePopup.hidden) this.renderMessageList();
  }

  renderMessageList() {
    const list = this.elements.messageList;
    if (this.inboxView.length === 0) {
      list.innerHTML = `<p class="message-empty">${this.escapeHtml(this.t("ui.messages.empty", "No messages"))}</p>`;
      return;
    }
    list.innerHTML = this.inboxView.map((message) => {
      const portrait = message.sender?.image || "";
      const sender = message.sender?.name || "";
      const portraitMarkup = portrait
        ? `<img class="message-portrait" src="${this.escapeHtml(portrait)}" alt="" loading="lazy">`
        : `<span class="message-portrait" aria-hidden="true"></span>`;
      return `
        <button class="message-row ${message.read ? "" : "is-unread"}" type="button" data-message-id="${this.escapeHtml(message.messageId)}">
          ${portraitMarkup}
          <span class="message-body">
            <span class="message-sender">${this.escapeHtml(sender)}</span>
            <span class="message-title">${this.escapeHtml(message.title || "")}</span>
          </span>
          <span class="message-unread-dot" aria-hidden="true"></span>
        </button>`;
    }).join("");
  }

  openMessageInbox() {
    this.messagePopupReturnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : this.elements.bottomNavMessageButton;

    if (typeof this.onRequestInbox === "function") {
      this.setInboxState(this.onRequestInbox());
    }
    this.renderMessageList();

    if (this.elements.messagePopup.parentElement !== document.body) {
      document.body.append(this.elements.messagePopup);
    }
    this.elements.messagePopup.hidden = false;
    this.elements.messagePopup.removeAttribute("inert");
    this.elements.messagePopup.classList.add("open");
    this.elements.messagePopup.setAttribute("aria-hidden", "false");
    try {
      this.elements.messagePopupCloseButton.focus({ preventScroll: true });
    } catch {
      this.elements.messagePopupCloseButton.focus();
    }
  }

  closeMessageInbox({ restoreFocus = true } = {}) {
    if (this.elements.messagePopup.hidden) return;

    const activeElement = document.activeElement;
    this.elements.messagePopup.classList.remove("open");
    this.elements.messagePopup.hidden = true;
    this.elements.messagePopup.setAttribute("aria-hidden", "true");
    this.elements.messagePopup.setAttribute("inert", "");

    if (activeElement instanceof HTMLElement && this.elements.messagePopup.contains(activeElement)) {
      activeElement.blur();
    }

    if (restoreFocus) {
      const focusTarget = this.messagePopupReturnFocus instanceof HTMLElement && document.contains(this.messagePopupReturnFocus)
        ? this.messagePopupReturnFocus
        : this.elements.bottomNavMessageButton;
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
    }

    this.messagePopupReturnFocus = null;
  }

  getSelectedShipDefinition() {
    return this.shipDefinitions[this.selectedShipId]
      || this.shipDefinitions[this.defaultShipId]
      || Object.values(this.shipDefinitions || {})[0]
      || null;
  }

  getSelectedShipSummary() {
    const ship = this.getSelectedShipDefinition();
    return ship ? this.shipCombatSummaries?.[ship.id] || null : null;
  }

  getShipDisplayName(ship) {
    if (!ship) return "Ship";
    return this.i18n.resolveDefinitionText(ship, "name", ship.fallbackLabel || ship.id || "Ship");
  }

  renderPlayerProfile() {
    const profile = this.playerProfile || {};
    const displayName = this.normalizePlayerDisplayName(profile.display_name || "Pilot");
    const portraitId = String(profile.portrait_id || "portrait_01").replace(/[^\w-]/g, "") || "portrait_01";
    this.elements.playerProfilePortrait.src = `./rss/profile/${portraitId}.png`;
    if (document.activeElement !== this.elements.playerNameInput) {
      this.elements.playerNameInput.value = displayName;
    }
    this.elements.playerUidValue.textContent = profile.character_id || "--";
    this.elements.playerSicValue.textContent = this.formatCurrencyAmount(profile.sic ?? 0);
  }

  async commitPlayerNameInput() {
    const previousName = this.normalizePlayerDisplayName(this.playerProfile?.display_name || "Pilot");
    const nextName = this.normalizePlayerDisplayName(this.elements.playerNameInput.value);
    this.elements.playerNameInput.value = nextName;
    if (nextName === previousName) return;

    if (!this.onPlayerProfileNameChange) {
      this.playerProfile = { ...(this.playerProfile || {}), display_name: nextName };
      this.renderPlayerProfile();
      return;
    }

    this.elements.playerNameInput.disabled = true;
    try {
      const updatedProfile = await this.onPlayerProfileNameChange(nextName);
      if (updatedProfile) this.playerProfile = updatedProfile;
      this.renderPlayerProfile();
    } catch {
      this.elements.playerNameInput.value = previousName;
      this.showErrorToast("profile unavailable");
    } finally {
      this.elements.playerNameInput.disabled = false;
    }
  }

  normalizePlayerDisplayName(value) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    return text.slice(0, 32) || "Pilot";
  }

  formatCurrencyAmount(value) {
    const number = Number(value);
    return this.i18n.formatNumber(Number.isFinite(number) ? number : 0, {
      maximumFractionDigits: 0
    });
  }

  renderObjectList({ buildings = [], resources = [], betaVoids = [] }) {
    this.objectListPayload = { buildings, resources, betaVoids };
    this.renderObjectListCategory();
  }

  renderObjectListCategory() {
    const category = this.getNormalizedObjectListCategory(this.objectListCategory);
    const items = this.getSortedObjectListItems(category);
    this.renderedObjectList = items;
    this.selectedObjectListTargetId = null;
    this.elements.objectListContent.replaceChildren();
    this.closeObjectListTransient();

    this.elements.objectListCategoryCurrent.textContent = this.getObjectListCategoryLabel(category);
    this.renderObjectListSortControls(items.length);

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "object-list-empty";
      empty.textContent = this.t("ui.scanner.empty", "No objects detected");
      this.elements.objectListContent.append(empty);
      return;
    }

    this.appendObjectGroup(category, items);
  }

  appendObjectGroup(category, items) {
    if (!items.length) return;

    const group = document.createElement("section");
    group.className = "object-sector-group";

    const tableHead = document.createElement("div");
    tableHead.className = "object-list-table-head";
    const columns = category === "buildings"
      ? ["Sector", "Name", "Position"]
      : category === "betaVoids"
        ? ["Sector", "Name", "Position"]
        : ["Sector", "Type", "Position"];
    columns.forEach((text) => {
      const cell = document.createElement("span");
      cell.textContent = text;
      tableHead.append(cell);
    });
    group.append(tableHead);

    items.forEach((item) => group.append(this.createObjectListItem(item, category)));
    this.elements.objectListContent.append(group);
  }

  createObjectListItem(item, category) {
    const wrapper = document.createElement("div");
    wrapper.className = "object-list-item-wrapper";

    const row = document.createElement("button");
    row.className = "object-row";
    row.type = "button";
    row.dataset.objectId = item.id;

    const sector = document.createElement("div");
    sector.className = "object-row-sector";
    sector.textContent = item.sectorName;
    sector.title = item.sectorName;

    const main = document.createElement("div");
    main.className = "object-row-main";

    const icon = document.createElement("img");
    icon.className = "object-row-icon";
    const iconUrl = item.iconUrl || (category === "buildings" ? "./rss/svg/ind_medium.svg" : "./rss/svg/ind_loot.svg");
    icon.dataset.iconSrc = iconUrl;
    icon.src = iconUrl;
    void this.applyObjectRowIconTint(icon, iconUrl);
    icon.alt = "";
    icon.decoding = "async";
    icon.setAttribute("aria-hidden", "true");

    const name = document.createElement("div");
    name.className = "object-row-name";
    name.textContent = category === "buildings" || category === "betaVoids" ? item.name : item.typeLabel;
    name.title = name.textContent;

    main.append(icon, name);

    const coordinates = document.createElement("div");
    coordinates.className = "object-row-coordinates";
    coordinates.textContent = this.formatListPosition(item.position);
    coordinates.title = this.formatPosition(item.position);

    row.append(sector, main, coordinates);
    wrapper.append(row);
    return wrapper;
  }

  onObjectListClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const selectButton = target?.closest("[data-object-select-id]");
    if (selectButton) {
      event.preventDefault();
      event.stopPropagation();
      const object = this.findRenderedObject(selectButton.dataset.objectSelectId);
      if (!object || !this.onSelectWorldObject) return;

      this.onSelectWorldObject(object);
      this.closeObjectList({ restoreFocus: false });
      return;
    }

    const detailButton = target?.closest("[data-object-detail-id]");
    if (detailButton) {
      event.preventDefault();
      event.stopPropagation();
      const object = this.findRenderedObject(detailButton.dataset.objectDetailId);
      if (object) this.openObjectDetailPopup(object);
      return;
    }

    const navButton = target?.closest("[data-object-nav-id]");
    if (navButton) {
      event.preventDefault();
      event.stopPropagation();
      const object = this.findRenderedObject(navButton.dataset.objectNavId);
      if (!object || !this.onNavigateToWorldObject) return;

      this.onNavigateToWorldObject(object);
      this.closeObjectList({ restoreFocus: false });
      return;
    }

    const hyperdriveButton = target?.closest("[data-object-hyperdrive-id]");
    if (hyperdriveButton) {
      event.preventDefault();
      event.stopPropagation();
      const object = this.findRenderedObject(hyperdriveButton.dataset.objectHyperdriveId);
      if (!object || !this.onHyperdriveToWorldObject) return;

      this.onHyperdriveToWorldObject(object);
      this.closeObjectList({ restoreFocus: false });
      return;
    }

    const betaSpaceButton = target?.closest("[data-beta-space-enter-id]");
    if (betaSpaceButton) {
      event.preventDefault();
      event.stopPropagation();
      const object = this.findRenderedObject(betaSpaceButton.dataset.betaSpaceEnterId);
      if (!object || !this.onEnterBetaSpace) return;

      this.onEnterBetaSpace(object);
      this.closeObjectList({ restoreFocus: false });
      return;
    }

    const dockButton = target?.closest("[data-dock-id]");
    if (dockButton instanceof HTMLButtonElement) {
      event.preventDefault();
      event.stopPropagation();
      if (dockButton.disabled) return;
      const object = this.findRenderedObject(dockButton.dataset.dockId);
      if (!object || !this.onDock) return;

      this.onDock(object);
      this.closeObjectList({ restoreFocus: false });
      return;
    }

    const row = target?.closest("[data-object-id]");
    if (!row) return;

    event.preventDefault();
    event.stopPropagation();
    this.selectObjectListItem(row.dataset.objectId);
  }

  selectObjectListItem(objectId, { scroll = false } = {}) {
    const object = this.findRenderedObject(objectId);
    if (!object) return null;

    this.selectedObjectListTargetId = objectId;
    this.elements.objectListContent.querySelectorAll(".object-row").forEach((row) => {
      const active = row.dataset.objectId === objectId;
      row.classList.toggle("active", active);
      row.setAttribute("aria-expanded", active ? "true" : "false");
    });
    this.elements.objectListPanel.querySelectorAll(".object-detail-bubble").forEach((bubble) => bubble.remove());

    const row = Array.from(this.elements.objectListContent.querySelectorAll("[data-object-id]"))
      .find((element) => element.dataset.objectId === objectId);
    const wrapper = row?.parentElement;
    if (!wrapper) return null;

    if (scroll) {
      row.scrollIntoView({ block: "center", inline: "nearest" });
    }

    const bubble = this.createObjectBubble(object);
    this.elements.objectListPanel.append(bubble);
    this.positionObjectBubble(bubble, row);
    return bubble;
  }

  createObjectBubble(object, { includeSelect = true } = {}) {
    const bubble = document.createElement("div");
    bubble.className = "object-detail-bubble";
    bubble.dataset.objectBubbleId = object.id;

    const select = document.createElement("button");
    select.className = "object-bubble-button object-select-button";
    select.type = "button";
    select.dataset.objectSelectId = object.id;
    select.textContent = this.t("ui.scanner.select", "Select");

    const detail = document.createElement("button");
    detail.className = "object-bubble-button";
    detail.type = "button";
    detail.dataset.objectDetailId = object.id;
    detail.textContent = this.t("ui.scanner.detail", "Detail");

    const nav = document.createElement("button");
    nav.className = "object-bubble-button object-navigate-button";
    nav.type = "button";
    nav.dataset.objectNavId = object.id;
    nav.textContent = this.t("ui.scanner.autoNavigate", "Auto Navigate");

    const hyperNav = document.createElement("button");
    hyperNav.className = "object-bubble-button object-hyperdrive-button";
    hyperNav.type = "button";
    hyperNav.dataset.objectHyperdriveId = object.id;
    hyperNav.textContent = this.t("ui.scanner.hyperdrive", "Hyperdrive");

    if (includeSelect) bubble.append(select);
    bubble.append(detail, nav, hyperNav);
    if (object.kind === "betaVoid" && object.status === "active") {
      const enter = document.createElement("button");
      enter.className = "object-bubble-button";
      enter.type = "button";
      enter.dataset.betaSpaceEnterId = object.id;
      enter.textContent = this.t("ui.scanner.enterBetaSpace", "Enter Beta Space");
      bubble.append(enter);
    }
    this.appendDockButton(bubble, object);
    this.appendGatherButton(bubble, object);
    return bubble;
  }

  // Adds a gather/stop toggle to a resource node's detail bubble. Mirrors the
  // dock button: visible but disabled (with a hint) when out of mining range.
  appendGatherButton(bubble, object) {
    if (object.kind !== "resource") return;
    if (!this.onGatherWorldObject && !this.onStopGatherWorldObject) return;
    const button = document.createElement("button");
    button.className = "object-bubble-button object-gather-button";
    button.type = "button";
    button.dataset.objectGatherId = object.id;
    bubble.append(button);
    this.applyGatherButtonState(button, object.id);
  }

  applyGatherButtonState(button, objectId) {
    const state = this.onGetGatherState?.(objectId) || null;
    const gathering = !!state?.gathering;
    button.dataset.gatherMode = gathering ? "stop" : "start";
    if (gathering) {
      const planned = Number(state.planned) || 0;
      const gathered = Number(state.gathered) || 0;
      const pct = planned > 0 ? Math.min(100, Math.floor((gathered / planned) * 100)) : 0;
      button.disabled = false;
      button.textContent = `${this.t("ui.scanner.stopGather", "채광 중지")} (${Math.floor(gathered)} · ${pct}%)`;
      button.title = button.textContent;
    } else {
      const inRange = !state || state.inRange;
      button.disabled = !inRange || !!state?.blocked;
      button.textContent = inRange
        ? this.t("ui.scanner.gather", "채광")
        : this.t("ui.scanner.gatherOutOfRange", "채광 (거리 초과)");
      button.title = button.textContent;
    }
  }

  refreshGatherButton(bubble) {
    const button = bubble.querySelector("[data-object-gather-id]");
    if (!button) return;
    this.applyGatherButtonState(button, button.dataset.objectGatherId);
  }

  // Adds a dock button to a station's detail bubble; disabled (but visible) when out of range.
  appendDockButton(bubble, object) {
    if (object.kind !== "building") return;
    const dockState = this.onGetDockState?.(object.id);
    if (!dockState?.dockable) return;
    const dock = document.createElement("button");
    dock.className = "object-bubble-button object-dock-button";
    dock.type = "button";
    dock.dataset.dockId = object.id;
    const icon = document.createElement("img");
    icon.className = "object-dock-icon";
    icon.src = "rss/svg/ui_dock.svg";
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    dock.append(icon);
    this.applyDockButtonState(dock, dockState);
    bubble.append(dock);
  }

  applyDockButtonState(dock, dockState) {
    dock.disabled = !dockState.inRange;
    const label = dockState.inRange
      ? this.t("ui.scanner.dock", "정박하기")
      : this.t("ui.scanner.dockOutOfRange", "정박하기 (거리 초과)");
    dock.setAttribute("aria-label", label);
    dock.title = label;
  }

  refreshDockButton(bubble) {
    const dock = bubble.querySelector("[data-dock-id]");
    if (!dock) return;
    const dockState = this.onGetDockState?.(dock.dataset.dockId);
    if (!dockState?.dockable) {
      dock.remove();
      return;
    }
    this.applyDockButtonState(dock, dockState);
  }

  // Periodically re-evaluates the dock button's range while the selection bubble is open.
  startDockBubbleRefresh(bubble) {
    this.stopDockBubbleRefresh();
    const hasDock = !!bubble.querySelector("[data-dock-id]");
    const hasGather = !!bubble.querySelector("[data-object-gather-id]");
    if (!hasDock && !hasGather) return;
    this._dockBubbleRefreshTimer = setInterval(() => {
      if (!bubble.isConnected) {
        this.stopDockBubbleRefresh();
        return;
      }
      this.refreshDockButton(bubble);
      this.refreshGatherButton(bubble);
    }, 600);
  }

  stopDockBubbleRefresh() {
    if (this._dockBubbleRefreshTimer) {
      clearInterval(this._dockBubbleRefreshTimer);
      this._dockBubbleRefreshTimer = 0;
    }
  }

  openObjectDetailPopup(object) {
    this.closeObjectDetailPopup();
    this.elements.objectListPanel.querySelectorAll(".object-detail-bubble").forEach((bubble) => bubble.remove());

    const popup = this.createObjectDetailPopupElement(object, () => this.closeObjectDetailPopup());
    this.elements.objectListPanel.append(popup);
    void this.injectBuildingStorageSection(popup, object);
    this.focusObjectDetailPopup(popup);
  }

  createObjectDetailPopupElement(object, onClose) {
    const popup = document.createElement("section");
    popup.className = "object-detail-popup";
    popup.dataset.objectDetailPopupId = object.id;
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", this.t("ui.scanner.objectDetail", "Object detail"));

    const header = document.createElement("header");
    header.className = "object-detail-popup-header";

    const title = document.createElement("h3");
    title.className = "object-detail-popup-title";
    title.textContent = object.kind === "building" || object.kind === "betaVoid" ? object.name : object.typeLabel;

    const close = document.createElement("button");
    close.className = "object-detail-popup-close";
    close.type = "button";
    close.setAttribute("aria-label", this.t("ui.scanner.closeDetail", "Close detail"));
    close.innerHTML = '<span class="svg-icon svg-icon-close" aria-hidden="true"></span>';
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    });

    header.append(title, close);

    const lines = [
      this.createObjectBubbleLine(this.t("ui.scanner.fields.category", "Category"), object.kind),
      this.createObjectBubbleLine(this.t("ui.scanner.fields.sector", "Sector"), object.sectorName),
      this.createObjectBubbleLine(this.t("ui.scanner.fields.chunk", "Chunk"), object.chunkId || "UNKNOWN"),
      this.createObjectBubbleLine(this.t("ui.scanner.fields.position", "Position"), this.formatPosition(object.position)),
      this.createObjectBubbleLine(
        this.t("ui.scanner.fields.chunkRelative", "Chunk Relative"),
        object.relativePosition ? this.formatPosition(object.relativePosition) : "unavailable"
      ),
      this.createObjectBubbleLine(this.t("ui.scanner.fields.distance", "Distance"), object.distanceText || "unknown")
    ];

    if (object.kind === "resource") {
      lines.splice(1, 0, this.createObjectBubbleLine(this.t("ui.scanner.fields.type", "Type"), object.typeLabel));
      lines.splice(2, 0, this.createObjectBubbleLine(this.t("ui.scanner.fields.amount", "Amount"), object.amountLabel));
    } else if (object.kind === "building") {
      lines.splice(1, 0, this.createObjectBubbleLine(this.t("ui.scanner.fields.name", "Name"), object.name));
      lines.splice(2, 0, this.createObjectBubbleLine(this.t("ui.scanner.fields.status", "Status"), object.statusLabel));
      lines.splice(3, 0, this.createObjectBubbleLine(this.t("ui.scanner.fields.hp", "HP"), object.hpLabel));
    } else if (object.kind === "betaVoid") {
      lines.splice(1, 0, this.createObjectBubbleLine(this.t("ui.scanner.fields.name", "Name"), object.name));
    }

    const nav = document.createElement("button");
    nav.className = "object-navigate-button";
    nav.type = "button";
    nav.dataset.objectNavId = object.id;
    nav.textContent = this.t("ui.scanner.autoNavigate", "Auto Navigate");

    const hyperNav = document.createElement("button");
    hyperNav.className = "object-navigate-button";
    hyperNav.type = "button";
    hyperNav.dataset.objectHyperdriveId = object.id;
    hyperNav.textContent = this.t("ui.scanner.hyperdrive", "Hyperdrive");

    const actions = [nav, hyperNav];
    if (object.kind === "betaVoid" && object.status === "active") {
      const enter = document.createElement("button");
      enter.className = "object-navigate-button";
      enter.type = "button";
      enter.dataset.betaSpaceEnterId = object.id;
      enter.textContent = this.t("ui.scanner.enterBetaSpace", "Enter Beta Space");
      actions.push(enter);
    }

    popup.append(header, ...lines, ...actions);
    return popup;
  }

  // Building detail popup: append a storage section that visibly separates the
  // station's PUBLIC stock (station_inventory, tradable) from PRIVATE docked-ship
  // assets (cargo + fitting, not for sale). Async (public stock is read from DB).
  async injectBuildingStorageSection(popup, object) {
    if (!popup || object.kind !== "building" || !this.onGetBuildingStorage) return;
    let view = null;
    try { view = await this.onGetBuildingStorage(object.id); } catch { view = null; }
    if (!view || !popup.isConnected) return;
    popup.append(this.renderBuildingStorageSection(view, object.id, object.name));
  }

  renderBuildingStorageSection(view, buildingInstanceId = null, buildingName = "") {
    const wrap = document.createElement("div");
    wrap.className = "building-storage-section";

    const pub = document.createElement("div");
    pub.className = "building-storage-group building-storage-public";
    const pubTitle = document.createElement("h4");
    pubTitle.className = "building-storage-title";
    pubTitle.textContent = this.t("ui.scanner.publicStock", "공공 재고 (거래 가능)");
    pub.append(pubTitle);
    // Trade (load/unload) is available when a ship is docked here.
    if (this.onTradeAtStation && buildingInstanceId && view.private?.ships?.length) {
      const tradeBtn = document.createElement("button");
      tradeBtn.className = "object-bubble-button building-trade-open";
      tradeBtn.type = "button";
      tradeBtn.textContent = this.t("ui.scanner.openTrade", "무역 (적재/적하)");
      tradeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.openStationTradeWindow(buildingInstanceId, buildingName);
      });
      pub.append(tradeBtn);
    }
    pub.append(this.createObjectBubbleLine(
      this.t("ui.scanner.capacity", "용량"),
      `${this.formatStorageNumber(view.public.used_mass)} / ${this.formatStorageNumber(view.public.capacity)}`
    ));
    pub.append(view.public.rows.length
      ? this.renderStorageItemList(view.public.rows)
      : this.createStorageEmptyLine());
    wrap.append(pub);

    const priv = document.createElement("div");
    priv.className = "building-storage-group building-storage-private";
    const privTitle = document.createElement("h4");
    privTitle.className = "building-storage-title";
    privTitle.textContent = this.t("ui.scanner.privateAssets", "정박 함선 · 사적 자산 (비매물)");
    priv.append(privTitle);
    if (view.private.ships.length) {
      view.private.ships.forEach((ship) => priv.append(this.renderDockedShipAssets(ship)));
    } else {
      priv.append(this.createStorageEmptyLine());
    }
    wrap.append(priv);

    return wrap;
  }

  renderStorageItemList(rows) {
    const list = document.createElement("ul");
    list.className = "building-storage-list";
    rows.forEach((row) => {
      const li = document.createElement("li");
      li.className = "building-storage-item";
      const name = document.createElement("span");
      name.className = "building-storage-item-name";
      name.textContent = row.label || row.item_id;
      const qty = document.createElement("span");
      qty.className = "building-storage-item-qty";
      qty.textContent = `×${this.formatStorageNumber(row.quantity)}`;
      li.append(name, qty);
      list.append(li);
    });
    return list;
  }

  renderDockedShipAssets(ship) {
    const block = document.createElement("div");
    block.className = "building-storage-ship";
    const head = document.createElement("div");
    head.className = "building-storage-ship-head";
    const slot = Number.isInteger(ship.dock_slot)
      ? ` · ${this.t("ui.scanner.hangar", "격납고")} ${ship.dock_slot + 1}`
      : "";
    head.textContent = `${ship.label || ship.ship_id}${slot}`;
    block.append(head);

    const cargo = [
      ...(ship.cargo_rows || []),
      ...(ship.cargo_unique || []).map((u) => ({ label: u.label, item_id: u.item_id, quantity: 1 }))
    ];
    if (cargo.length) {
      const cargoTitle = document.createElement("div");
      cargoTitle.className = "building-storage-subtitle";
      cargoTitle.textContent = this.t("ui.scanner.cargo", "카고");
      block.append(cargoTitle, this.renderStorageItemList(cargo));
    }
    if ((ship.fitting || []).length) {
      const fitTitle = document.createElement("div");
      fitTitle.className = "building-storage-subtitle";
      fitTitle.textContent = this.t("ui.scanner.fitting", "장착");
      block.append(fitTitle);
      const list = document.createElement("ul");
      list.className = "building-storage-list";
      ship.fitting.forEach((f) => {
        const li = document.createElement("li");
        li.className = "building-storage-item";
        const name = document.createElement("span");
        name.className = "building-storage-item-name";
        name.textContent = f.label || f.item_id;
        const tag = document.createElement("span");
        tag.className = "building-storage-item-qty";
        tag.textContent = f.slot_type;
        li.append(name, tag);
        list.append(li);
      });
      block.append(list);
    }
    return block;
  }

  createStorageEmptyLine() {
    const line = document.createElement("div");
    line.className = "building-storage-empty";
    line.textContent = this.t("ui.scanner.storageEmpty", "비어 있음");
    return line;
  }

  formatStorageNumber(value) {
    return Math.round(Number(value) || 0).toLocaleString();
  }

  // ── Station trade (load/unload) window ──────────────────────────────────────
  closeStationTradeWindow() {
    document.querySelectorAll(".station-trade-window").forEach((w) => w.remove());
  }

  async openStationTradeWindow(buildingId, buildingName = "") {
    this.closeStationTradeWindow();
    const win = document.createElement("section");
    win.className = "station-trade-window";
    win.dataset.stationTradeId = buildingId;
    win.setAttribute("role", "dialog");
    win.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;max-height:80vh;overflow:auto;background:rgba(8,14,26,0.97);color:#cfe4ff;border:1px solid #2a6;border-radius:6px;padding:1em 1.2em;min-width:20em;font-size:0.9em;box-shadow:0 8px 40px rgba(0,0,0,0.6);";
    document.body.append(win);
    await this.refreshStationTradeWindow(buildingId, buildingName);
  }

  async refreshStationTradeWindow(buildingId, buildingName = "") {
    const win = document.querySelector(".station-trade-window");
    if (!win || !this.onGetBuildingStorage) return;
    let view = null;
    try { view = await this.onGetBuildingStorage(buildingId); } catch { view = null; }
    if (!win.isConnected) return;
    win.innerHTML = "";
    win.append(this.renderStationTradeWindow(view, buildingId, buildingName));
  }

  renderStationTradeWindow(view, buildingId, buildingName) {
    const frag = document.createDocumentFragment();
    const header = document.createElement("header");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:1em;margin-bottom:0.6em;";
    const title = document.createElement("h3");
    title.style.cssText = "margin:0;font-size:1em;";
    title.textContent = `${this.t("ui.scanner.tradeTitle", "무역")} — ${buildingName || ""}`;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "✕";
    close.style.cssText = "background:none;border:none;color:inherit;font-size:1.1em;cursor:pointer;";
    close.addEventListener("click", (e) => { e.preventDefault(); this.closeStationTradeWindow(); });
    header.append(title, close);
    frag.append(header);

    const ship = (view?.private?.ships || [])[0] || null;
    if (!view || !ship) {
      const note = document.createElement("div");
      note.textContent = this.t("ui.scanner.tradeDockFirst", "정박 후 이용 가능");
      frag.append(note);
      return frag;
    }

    const amountRow = document.createElement("div");
    amountRow.style.cssText = "margin:0.4em 0 0.8em;";
    const amountLabel = document.createElement("label");
    amountLabel.textContent = `${this.t("ui.scanner.tradeAmount", "수량")}: `;
    const amountInput = document.createElement("input");
    amountInput.type = "number"; amountInput.min = "1"; amountInput.value = "1";
    amountInput.style.cssText = "width:6em;background:rgba(255,255,255,0.08);color:inherit;border:1px solid #356;border-radius:3px;padding:0.1em 0.3em;";
    amountLabel.append(amountInput);
    amountRow.append(amountLabel);
    frag.append(amountRow);
    const getAmount = () => Math.max(1, Math.floor(Number(amountInput.value) || 1));

    const group = (titleText) => {
      const g = document.createElement("div");
      g.style.cssText = "margin-bottom:0.8em;";
      const h = document.createElement("h4");
      h.style.cssText = "margin:0 0 0.3em;font-size:0.85em;opacity:0.85;";
      h.textContent = titleText;
      g.append(h);
      return g;
    };

    // Station public stock → load onto ship (out)
    const stationGroup = group(this.t("ui.scanner.publicStock", "공공 재고 (거래 가능)"));
    const pubRows = view.public?.rows || [];
    if (!pubRows.length) stationGroup.append(this.createStorageEmptyLine());
    pubRows.forEach((row) => stationGroup.append(
      this.renderTradeRow(row, this.t("ui.scanner.loadToShip", "적재 →"), () => this.execTrade(buildingId, row.item_id, "out", getAmount(), buildingName))
    ));
    frag.append(stationGroup);

    // Ship cargo → unload into station (in)
    const cargoGroup = group(this.t("ui.scanner.cargo", "카고"));
    const cargoRows = ship.cargo_rows || [];
    if (!cargoRows.length) cargoGroup.append(this.createStorageEmptyLine());
    cargoRows.forEach((row) => cargoGroup.append(
      this.renderTradeRow(row, this.t("ui.scanner.unloadToStation", "← 적하"), () => this.execTrade(buildingId, row.item_id, "in", getAmount(), buildingName))
    ));
    frag.append(cargoGroup);

    return frag;
  }

  renderTradeRow(row, btnLabel, onClick) {
    const li = document.createElement("div");
    li.style.cssText = "display:flex;align-items:center;gap:0.6em;padding:0.15em 0;";
    const name = document.createElement("span");
    name.style.cssText = "flex:1;";
    name.textContent = row.label || row.item_id;
    const qty = document.createElement("span");
    qty.style.cssText = "opacity:0.8;min-width:4em;text-align:right;";
    qty.textContent = `×${this.formatStorageNumber(row.quantity)}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = btnLabel;
    btn.style.cssText = "background:rgba(40,120,80,0.4);color:inherit;border:1px solid #2a6;border-radius:3px;padding:0.1em 0.5em;cursor:pointer;";
    btn.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
    li.append(name, qty, btn);
    return li;
  }

  async execTrade(buildingId, itemId, direction, amount, buildingName) {
    if (!this.onTradeAtStation) return;
    let res = null;
    try { res = await this.onTradeAtStation(buildingId, itemId, direction, amount); } catch { res = null; }
    if (res && res.ok === false && res.reason) this.showToast?.(this.tradeReasonText(res.reason));
    await this.refreshStationTradeWindow(buildingId, buildingName);
  }

  tradeReasonText(reason) {
    const map = {
      "not-docked": this.t("ui.scanner.tradeDockFirst", "정박 후 이용 가능"),
      "no-ship": this.t("ui.scanner.tradeNoShip", "함선 없음"),
      "insufficient-stock": this.t("ui.scanner.tradeNoStock", "재고 부족"),
      "cargo-full": this.t("ui.scanner.tradeCargoFull", "카고 가득 참"),
      "insufficient-cargo": this.t("ui.scanner.tradeNoCargo", "카고에 없음"),
      "station-full": this.t("ui.scanner.tradeStationFull", "스테이션 재고 가득 참")
    };
    return map[reason] || String(reason);
  }

  focusObjectDetailPopup(popup) {
    const close = popup.querySelector(".object-detail-popup-close");
    if (!(close instanceof HTMLElement)) return;
    try {
      close.focus({ preventScroll: true });
    } catch {
      close.focus();
    }
  }

  closeObjectDetailPopup() {
    this.elements.objectListPanel.querySelectorAll(".object-detail-popup").forEach((popup) => popup.remove());
  }

  async openSelectionSummaryBubble() {
    if (!this.selectedWorldObjectSummary?.id) return;

    const object = await this.getSelectedWorldObjectSummaryDetail();
    if (!object) {
      this.showErrorToast("selected object unavailable");
      return;
    }

    this.closeSelectionSummaryBubble();
    const bubble = this.createObjectBubble(object, { includeSelect: false });
    bubble.classList.add("selection-detail-bubble");
    bubble.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const detailButton = target?.closest("[data-object-detail-id]");
      if (detailButton) {
        event.preventDefault();
        event.stopPropagation();
        this.openStandaloneObjectDetailPopup(object);
        return;
      }

      const navButton = target?.closest("[data-object-nav-id]");
      if (navButton) {
        event.preventDefault();
        event.stopPropagation();
        if (this.onNavigateToWorldObject) this.onNavigateToWorldObject(object);
        this.closeSelectionSummaryBubble();
        return;
      }

      const hyperdriveButton = target?.closest("[data-object-hyperdrive-id]");
      if (hyperdriveButton) {
        event.preventDefault();
        event.stopPropagation();
        if (this.onHyperdriveToWorldObject) this.onHyperdriveToWorldObject(object);
        this.closeSelectionSummaryBubble();
        return;
      }

      const betaSpaceButton = target?.closest("[data-beta-space-enter-id]");
      if (betaSpaceButton) {
        event.preventDefault();
        event.stopPropagation();
        if (this.onEnterBetaSpace) this.onEnterBetaSpace(object);
        this.closeSelectionSummaryBubble();
        return;
      }

      const gatherButton = target?.closest("[data-object-gather-id]");
      if (gatherButton instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        if (!gatherButton.disabled) {
          if (gatherButton.dataset.gatherMode === "stop") this.onStopGatherWorldObject?.(object);
          else this.onGatherWorldObject?.(object);
        }
        // Keep the bubble open so the live progress / stop toggle stays visible.
        return;
      }

      const dockButton = target?.closest("[data-dock-id]");
      if (dockButton instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        if (!dockButton.disabled && this.onDock) this.onDock(object);
        this.closeSelectionSummaryBubble();
      }
    });

    document.body.append(bubble);
    this.positionSelectionSummaryBubble(bubble);
    this.startDockBubbleRefresh(bubble);
    const focusTarget = bubble.querySelector("button");
    if (focusTarget instanceof HTMLElement) {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
    }
  }

  async getSelectedWorldObjectSummaryDetail() {
    const selected = this.selectedWorldObjectSummary;
    if (!selected?.id) return null;

    try {
      const payload = this.onRequestObjectList ? await this.onRequestObjectList() : null;
      return this.findObjectInPayload(payload, selected);
    } catch {
      return null;
    }
  }

  findObjectInPayload(payload, objectRef) {
    const category = this.getObjectListCategoryForKind(objectRef?.kind);
    if (!category) return null;
    return (payload?.[category] || []).find((item) => item.id === objectRef.id) || null;
  }

  positionSelectionSummaryBubble(bubble) {
    requestAnimationFrame(() => {
      if (!bubble.isConnected) return;

      bubble.style.left = "0";
      bubble.style.top = "0";
      const summaryRect = this.elements.selectionSummary.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const margin = 10;
      const gap = 8;
      const belowTop = summaryRect.bottom + gap;
      const aboveTop = summaryRect.top - bubbleRect.height - gap;
      const fitsBelow = belowTop + bubbleRect.height <= window.innerHeight - margin;
      const top = Math.max(
        margin,
        Math.min(fitsBelow ? belowTop : aboveTop, window.innerHeight - bubbleRect.height - margin)
      );
      const left = Math.max(
        margin,
        Math.min(summaryRect.right - bubbleRect.width, window.innerWidth - bubbleRect.width - margin)
      );

      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
    });
  }

  openStandaloneObjectDetailPopup(object) {
    this.closeSelectionSummaryBubble();
    this.closeStandaloneObjectDetailPopup();

    const popup = this.createObjectDetailPopupElement(object, () => this.closeStandaloneObjectDetailPopup());
    popup.classList.add("standalone");
    popup.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const navButton = target?.closest("[data-object-nav-id]");
      const betaSpaceButton = target?.closest("[data-beta-space-enter-id]");
      if (!navButton && !betaSpaceButton) return;

      event.preventDefault();
      event.stopPropagation();
      if (navButton && this.onNavigateToWorldObject) this.onNavigateToWorldObject(object);
      if (betaSpaceButton && this.onEnterBetaSpace) this.onEnterBetaSpace(object);
      this.closeStandaloneObjectDetailPopup();
    });

    document.body.append(popup);
    void this.injectBuildingStorageSection(popup, object);
    this.focusObjectDetailPopup(popup);
  }

  closeSelectionSummaryBubble() {
    this.stopDockBubbleRefresh();
    document.querySelectorAll(".object-detail-bubble.selection-detail-bubble").forEach((bubble) => bubble.remove());
  }

  closeStandaloneObjectDetailPopup() {
    document.querySelectorAll(".object-detail-popup.standalone").forEach((popup) => popup.remove());
  }

  onSelectionSummaryGlobalPointerDown(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(".selection-summary, .selection-detail-bubble, .object-detail-popup.standalone")) return;
    this.closeSelectionSummaryBubble();
  }

  onObjectListGlobalClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (!target.closest(".object-list-sort-dropdown")) {
      this.closeObjectListSortDropdowns();
    }

    if (!target.closest(".object-detail-bubble, .object-detail-popup")) {
      this.closeObjectListTransient();
    }
  }

  closeObjectListTransient() {
    this.selectedObjectListTargetId = null;
    this.elements.objectListContent.querySelectorAll(".object-row.active").forEach((row) => {
      row.classList.remove("active");
      row.setAttribute("aria-expanded", "false");
    });
    this.elements.objectListPanel.querySelectorAll(".object-detail-bubble").forEach((bubble) => bubble.remove());
    this.closeObjectDetailPopup();
  }

  closeObjectListSortDropdowns() {
    this.elements.objectListSortControls.querySelectorAll(".object-list-sort-dropdown.open")
      .forEach((dropdown) => dropdown.classList.remove("open"));
  }

  positionObjectBubble(bubble, row) {
    requestAnimationFrame(() => {
      if (!bubble.isConnected || !row?.isConnected) return;

      bubble.style.left = "0";
      bubble.style.top = "0";
      bubble.style.right = "auto";
      bubble.style.bottom = "auto";
      const bubbleRect = bubble.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const panelRect = this.elements.objectListPanel.getBoundingClientRect();
      const margin = 10;
      const overlap = 6;
      const belowTop = rowRect.bottom - panelRect.top - overlap;
      const aboveTop = rowRect.top - panelRect.top - bubbleRect.height + overlap;
      const fitsBelow = belowTop + bubbleRect.height <= panelRect.height - margin;
      const top = Math.max(margin, Math.min(fitsBelow ? belowTop : aboveTop, panelRect.height - bubbleRect.height - margin));
      const left = Math.max(
        margin,
        Math.min(rowRect.right - panelRect.left - bubbleRect.width - margin, panelRect.width - bubbleRect.width - margin)
      );

      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
    });
  }

  createObjectBubbleLine(label, value) {
    const line = document.createElement("div");
    line.className = "object-bubble-line";
    const labelElement = document.createElement("span");
    labelElement.textContent = label;
    const valueElement = document.createElement("strong");
    valueElement.textContent = value;
    line.append(labelElement, valueElement);
    return line;
  }

  findRenderedObject(objectId) {
    return this.renderedObjectList?.find((item) => item.id === objectId) || null;
  }

  getObjectListCategoryForKind(kind) {
    if (kind === "building") return "buildings";
    if (kind === "resource") return "resources";
    if (kind === "betaVoid") return "betaVoids";
    return null;
  }

  getNormalizedObjectListCategory(category) {
    return ["resources", "buildings", "betaVoids"].includes(category) ? category : "resources";
  }

  getObjectListCategoryLabel(category) {
    if (category === "buildings") return this.t("ui.scanner.categories.buildings", "Buildings");
    if (category === "betaVoids") return this.t("ui.scanner.categories.betaVoids", "Beta Void");
    return this.t("ui.scanner.categories.resources", "Resources");
  }

  revealObjectListBubble(objectRef) {
    const category = this.getObjectListCategoryForKind(objectRef?.kind);
    if (category && this.objectListCategory !== category) {
      this.objectListCategory = category;
      this.renderObjectListCategory();
    }

    return this.selectObjectListItem(objectRef?.id, { scroll: true });
  }

  setObjectListCategory(category) {
    this.objectListCategory = this.getNormalizedObjectListCategory(category);
    this.closeObjectDetailPopup();
    this.renderObjectListCategory();
  }

  stepObjectListCategory(step) {
    const categories = ["resources", "buildings", "betaVoids"];
    const currentIndex = categories.indexOf(this.objectListCategory);
    const nextIndex = (currentIndex + (Number.isFinite(step) ? step : 1) + categories.length) % categories.length;
    this.setObjectListCategory(categories[nextIndex]);
  }

  setObjectListSort(sort) {
    const options = this.getObjectListSortOptions(this.objectListCategory);
    const valid = options.some((option) => option.id === sort);
    if (!valid) return;

    this.objectListSort[this.objectListCategory] = sort;
    this.closeObjectDetailPopup();
    this.renderObjectListCategory();
  }

  renderObjectListSortControls(count = this.renderedObjectList?.length || 0) {
    this.elements.objectListSortControls.replaceChildren();
    const activeSort = this.objectListSort[this.objectListCategory];
    const options = this.getObjectListSortOptions(this.objectListCategory);
    const activeOption = options.find((option) => option.id === activeSort) || options[0];
    const countElement = document.createElement("span");
    countElement.className = "object-list-count";
    countElement.textContent = String(count);
    const dropdown = document.createElement("div");
    dropdown.className = "object-list-sort-dropdown";

    const toggle = document.createElement("button");
    toggle.className = "object-list-sort-button active";
    toggle.type = "button";
    toggle.dataset.objectSortToggle = "true";
    const toggleLabel = document.createElement("span");
    toggleLabel.textContent = activeOption.label;
    const toggleIcon = document.createElement("span");
    toggleIcon.className = "svg-icon svg-icon-drop-arrow";
    toggleIcon.setAttribute("aria-hidden", "true");
    toggle.append(toggleLabel, toggleIcon);
    dropdown.append(toggle);

    const menu = document.createElement("div");
    menu.className = "object-list-sort-menu";

    options.forEach((option) => {
      const button = document.createElement("button");
      button.className = "object-list-sort-option";
      button.type = "button";
      button.dataset.objectSort = option.id;
      button.textContent = option.label;
      const active = option.id === activeSort;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      menu.append(button);
    });

    dropdown.append(menu);
    this.elements.objectListSortControls.append(countElement, dropdown);
  }

  getObjectListSortOptions(category) {
    if (category === "resources") {
      return [
        { id: "sector", label: "Sector" },
        { id: "type", label: "Type" },
        { id: "amount", label: "Amount" },
        { id: "x", label: "X" },
        { id: "y", label: "Y" },
        { id: "z", label: "Z" }
      ];
    }

    return [
      { id: "sector", label: "Sector" },
      { id: "name", label: "Name" },
      { id: "status", label: "Status" },
      { id: "x", label: "X" },
      { id: "y", label: "Y" },
      { id: "z", label: "Z" }
    ];
  }

  getSortedObjectListItems(category) {
    const items = [...(this.objectListPayload[category] || [])];
    const sort = this.objectListSort[category] || "sector";
    const byText = (getter) => (a, b) => String(getter(a) || "").localeCompare(String(getter(b) || ""));
    const byNumber = (getter) => (a, b) => (Number(getter(a)) || 0) - (Number(getter(b)) || 0);
    const comparators = {
      sector: byText((item) => item.sectorName),
      name: byText((item) => item.name),
      status: byText((item) => item.statusLabel),
      type: byText((item) => item.typeLabel),
      amount: byNumber((item) => item.currentAmount),
      x: byNumber((item) => item.position.x),
      y: byNumber((item) => item.position.y),
      z: byNumber((item) => item.position.z)
    };

    return items.sort(comparators[sort] || comparators.sector);
  }

  openSettings() {
    this.settingsReturnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : this.elements.settingsButton;
    this.renderStaticText(this.elements.settingsPopup);
    this.renderLanguageSettings();
    this.elements.settingsPopup.removeAttribute("inert");
    this.elements.settingsPopup.classList.add("open");
    this.elements.settingsPopup.setAttribute("aria-hidden", "false");
    this.cancelBindingCapture();
    this.closeSettingsDetail({ focusCategory: false });
    this.syncSettingsTabState();
    try {
      this.getSettingsTabButton(this.settingsTab).focus({ preventScroll: true });
    } catch {
      this.getSettingsTabButton(this.settingsTab).focus();
    }
  }

  closeSettings() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && this.elements.settingsPopup.contains(activeElement)) {
      const focusTarget = this.settingsReturnFocus instanceof HTMLElement && document.contains(this.settingsReturnFocus)
        ? this.settingsReturnFocus
        : this.elements.settingsButton;
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
      if (this.elements.settingsPopup.contains(document.activeElement)) activeElement.blur();
    }

    this.elements.settingsPopup.classList.remove("open");
    this.elements.settingsPopup.setAttribute("aria-hidden", "true");
    this.elements.settingsPopup.setAttribute("inert", "");
    this.settingsReturnFocus = null;
    this.closeSettingsDetail({ focusCategory: false });
    this.cancelBindingCapture();
  }

  closeSettingsDetail({ focusCategory = true } = {}) {
    this.elements.settingsDetailLayer.hidden = true;
    this.elements.settingsDetailLayer.classList.remove("open");
    if (focusCategory && this.elements.settingsPopup.classList.contains("open")) {
      try {
        this.getSettingsTabButton(this.settingsTab).focus({ preventScroll: true });
      } catch {
        this.getSettingsTabButton(this.settingsTab).focus();
      }
    }
    this.cancelBindingCapture();
  }

  setSettingsTab(tab) {
    this.settingsTab = ["keys", "data", "performance"].includes(tab) ? tab : "data";
    this.syncSettingsTabState();
    this.elements.settingsDetailLayer.hidden = false;
    this.elements.settingsDetailLayer.classList.add("open");
  }

  syncSettingsTabState() {
    const dataActive = this.settingsTab === "data";
    const performanceActive = this.settingsTab === "performance";
    const keysActive = this.settingsTab === "keys";
    this.elements.settingsKeysTab.classList.toggle("active", keysActive);
    this.elements.settingsDataTab.classList.toggle("active", dataActive);
    this.elements.settingsPerformanceTab.classList.toggle("active", performanceActive);
    this.elements.settingsKeysTab.setAttribute("aria-selected", keysActive ? "true" : "false");
    this.elements.settingsDataTab.setAttribute("aria-selected", dataActive ? "true" : "false");
    this.elements.settingsPerformanceTab.setAttribute("aria-selected", performanceActive ? "true" : "false");
    this.elements.settingsKeysPanel.classList.toggle("active", keysActive);
    this.elements.settingsDataPanel.classList.toggle("active", dataActive);
    this.elements.settingsPerformancePanel.classList.toggle("active", performanceActive);
    this.elements.settingsResetButton.hidden = !keysActive;
    this.elements.settingsTitle.textContent = this.getSettingsTabTitle(this.settingsTab);
    if (!keysActive) this.cancelBindingCapture();
  }

  getSettingsTabTitle(tab) {
    const titles = {
      data: ["ui.settings.categories.gameplay", "Gameplay"],
      keys: ["ui.settings.categories.controls", "Controls"],
      performance: ["ui.settings.categories.graphics", "Graphics"]
    };
    const [key, fallback] = titles[tab] || titles.data;
    return this.t(key, fallback);
  }

  getSettingsTabButton(tab) {
    if (tab === "keys") return this.elements.settingsKeysTab;
    if (tab === "performance") return this.elements.settingsPerformanceTab;
    return this.elements.settingsDataTab;
  }

  setKeyBindings(bindings) {
    this.keyBindings = { ...bindings };
    this.renderKeyBindings();
    if (this.onKeyBindingsChange) this.onKeyBindingsChange({ ...this.keyBindings });
  }

  startBindingCapture(actionId) {
    this.pendingBindingAction = actionId;
    this.renderKeyBindings();
  }

  cancelBindingCapture() {
    if (!this.pendingBindingAction) return;

    this.pendingBindingAction = null;
    this.renderKeyBindings();
  }

  onBindingKeyDown(event) {
    if (!this.pendingBindingAction) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.code === "Escape") {
      this.cancelBindingCapture();
      return;
    }

    if (!event.code) return;

    this.assignKeyBinding(this.pendingBindingAction, event.code);
  }

  assignKeyBinding(actionId, nextCode) {
    const previousCode = this.keyBindings[actionId];
    const conflictingAction = Object.entries(this.keyBindings)
      .find(([otherAction, code]) => otherAction !== actionId && code === nextCode)?.[0];
    const nextBindings = { ...this.keyBindings, [actionId]: nextCode };

    if (conflictingAction) {
      nextBindings[conflictingAction] = previousCode;
    }

    this.pendingBindingAction = null;
    this.setKeyBindings(nextBindings);
  }

  renderKeyBindings() {
    this.elements.keyBindingList.replaceChildren();

    for (const group of this.keyBindingGroups) {
      const groupElement = document.createElement("section");
      groupElement.className = "key-binding-group";

      const title = document.createElement("div");
      title.className = "key-binding-group-title";
      title.textContent = group.title;
      groupElement.append(title);

      group.actions.forEach((action, index) => {
        if (index > 0) {
          const divider = document.createElement("div");
          divider.className = "key-binding-divider";
          divider.setAttribute("aria-hidden", "true");
          groupElement.append(divider);
        }

        const row = document.createElement("div");
        row.className = "key-binding-row";

        const label = document.createElement("div");
        label.className = "key-binding-label";
        label.textContent = action.label;

        const button = document.createElement("button");
        button.className = "key-binding-button";
        button.type = "button";
        button.dataset.bindAction = action.id;
        button.textContent = this.pendingBindingAction === action.id
          ? "Press a key"
          : this.formatKeyCode(this.keyBindings[action.id]);
        button.classList.toggle("capturing", this.pendingBindingAction === action.id);

        row.append(label, button);
        groupElement.append(row);
      });

      this.elements.keyBindingList.append(groupElement);
    }
  }

  showStartGateScene({ loading = false } = {}) {
    this.elements.startGateScene.classList.add("active");
    this.elements.startGateScene.classList.toggle("is-loading", loading);
    this.elements.startGateScene.classList.toggle("is-standby", !loading);
    this.elements.startGateScene.setAttribute("aria-hidden", "false");
    this.elements.startReadyScene.classList.remove("active");
    this.elements.startReadyScene.setAttribute("aria-hidden", "true");

    if (this.elements.settingsPopup.classList.contains("open")) {
      this.closeSettings();
    }
  }

  showStartReadyScene() {
    this.elements.startGateScene.classList.remove("active", "is-loading", "is-standby");
    this.elements.startGateScene.setAttribute("aria-hidden", "true");
    this.elements.startReadyScene.classList.add("active");
    this.elements.startReadyScene.setAttribute("aria-hidden", "false");
  }

  setInteractionGate() {
    this.startStage = "standby";
    this.cancelLoadingProgressAnimation();
    this.showStartGateScene();
    this.loadingProgressValue = 0;
    this.loadingProgressTarget = 0;
    this.setLoadingProgressText(0);
    this.elements.loadingDetail.textContent = "standby";
    this.elements.loadingBar.style.width = "0%";
    this.elements.startButton.disabled = true;
    this.setStartButtonText("Start");
  }

  setLoadingState({ message, detail = "", progress = 0, canStart = false }) {
    this.startStage = "loading";
    this.showStartGateScene({ loading: true });
    this.elements.loadingDetail.textContent = detail;
    const nextProgress = Math.max(0, Math.min(1, Number(progress) || 0));
    this.animateLoadingProgress(nextProgress > 0 ? nextProgress : 0.95);
    this.elements.startButton.disabled = !canStart;
    this.setStartButtonText(canStart ? "Start" : "Loading");
  }

  setStartButtonText(text) {
    const icon = document.createElement("span");
    icon.className = "svg-icon svg-icon-power ready-button-icon";
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "ready-button-label";
    label.textContent = text;

    const spacer = document.createElement("span");
    spacer.setAttribute("aria-hidden", "true");

    this.elements.startButton.replaceChildren(icon, label, spacer);
  }

  setResourceProgress(snapshot) {
    const active = snapshot.entries.find((entry) => entry.status === "loading");
    const failed = snapshot.errors.length;
    const detail = active
      ? `${active.label} validating`
      : failed > 0
        ? `${failed} resource warning`
        : "resources ready";

    this.setLoadingState({
      message: "Loading resources",
      detail,
      progress: snapshot.progress,
      canStart: false
    });
  }

  setReady({ warnings = [] } = {}) {
    const detail = warnings.length > 0
      ? warnings.join(" / ")
      : "ship and audio resources verified";

    this.setLoadingState({
      message: "Ready",
      detail,
      progress: 1,
      canStart: true
    });
    this.startStage = "ready";
    clearTimeout(this.loadingReadyTimer);
    const delay = this.getLoadingProgressRemainingDuration();
    this.loadingReadyTimer = setTimeout(() => {
      if (this.startStage !== "ready") return;
      this.showStartReadyScene();
    }, this.loadingProgressValue < 1 ? Math.max(80, delay) : delay);
  }

  animateLoadingProgress(progress) {
    const nextTarget = Math.max(0, Math.min(1, Number(progress) || 0));
    this.loadingProgressTarget = Math.max(this.loadingProgressTarget, nextTarget);

    if (this.loadingProgressStartedAt === 0 || this.loadingProgressTarget <= this.loadingProgressValue) {
      this.loadingProgressStartedAt = performance.now() - this.loadingProgressValue * 1000;
    }

    if (this.loadingProgressFrameId) return;
    const tick = () => {
      const elapsed = performance.now() - this.loadingProgressStartedAt;
      const timelineProgress = Math.min(1, elapsed / 1000);
      this.loadingProgressValue = Math.min(this.loadingProgressTarget, timelineProgress);
      this.setLoadingProgressText(this.loadingProgressValue);

      if (this.loadingProgressValue < this.loadingProgressTarget) {
        this.loadingProgressFrameId = requestAnimationFrame(tick);
      } else {
        this.loadingProgressFrameId = 0;
      }
    };

    this.loadingProgressFrameId = requestAnimationFrame(tick);
  }

  getLoadingProgressRemainingDuration() {
    if (this.loadingProgressValue >= 1) return 0;

    const startedAt = this.loadingProgressStartedAt || performance.now();
    const elapsed = performance.now() - startedAt;
    return Math.max(0, 1000 - elapsed);
  }

  setLoadingProgressText(progress) {
    const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    this.elements.loadingText.textContent = `${percent}%`;
    this.elements.loadingBar.style.width = `${percent}%`;
  }

  cancelLoadingProgressAnimation() {
    if (this.loadingProgressFrameId) {
      cancelAnimationFrame(this.loadingProgressFrameId);
      this.loadingProgressFrameId = 0;
    }
    clearTimeout(this.loadingReadyTimer);
    this.loadingReadyTimer = 0;
    this.loadingProgressStartedAt = 0;
  }

  setWorldSummary(summary) {
    if (!summary) return;
    this.elements.worldSeedValue.textContent = String(summary.seed ?? "none");
    this.elements.worldGeneratedValue.textContent = summary.generatedAt
      ? new Date(summary.generatedAt).toLocaleString()
      : "none";
    this.elements.worldSectorCountValue.textContent = String(summary.sectorCount ?? 0);
    this.elements.worldChunkCountValue.textContent = String(summary.chunkCount ?? 0);
    this.elements.worldResourceCountValue.textContent = String(summary.resourceCount ?? 0);
    this.elements.worldBuildingCountValue.textContent = String(summary.buildingCount ?? 0);
    this.elements.worldCurrentSectorValue.textContent = summary.currentSector
      ? this.i18n.resolveDefinitionText(summary.currentSector, "name", summary.currentSector.name || "UNKNOWN")
      : "UNKNOWN";
    this.elements.worldCurrentChunkValue.textContent = summary.currentChunk || "UNKNOWN";
    this.updateLocationReadout(summary);
  }

  // readout 위치 라벨 — 섹터명 / Unnamed Space(유효 청크, 이름 없음) / Void Space(유효하지 않은 빈 공간)
  updateLocationReadout(summary) {
    const location = summary.currentSector
      ? this.i18n.resolveDefinitionText(summary.currentSector, "name", summary.currentSector.name || summary.currentSector.sector_id)
      : summary.currentChunk
        ? this.t("ui.map.unnamedSpace", "Unnamed Space")
        : this.t("ui.map.voidSpace", "Void Space");
    if (this.elements.locationValue.textContent !== location) {
      this.elements.locationValue.textContent = location;
      this.elements.locationValue.title = location;
    }
  }

  setMinimapExpanded(visible) {
    this.elements.readout.setAttribute("aria-expanded", visible ? "true" : "false");
  }

  setChunkBoundsMode(mode) {
    this.chunkBoundsMode = ["all", "sector", "off"].includes(mode) ? mode : "all";
    const buttons = [
      this.elements.chunkBoundsAllButton,
      this.elements.chunkBoundsSectorButton,
      this.elements.chunkBoundsOffButton
    ];

    buttons.forEach((button) => {
      const active = button.dataset.chunkBoundsMode === this.chunkBoundsMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    this.elements.chunkBoundsOffButton
      .closest(".rail-choice-control")
      ?.classList.toggle("is-off", this.chunkBoundsMode === "off");
  }

  setEnvironmentMode(mode) {
    this.environmentMode = mode === "dark" ? "dark" : "light";
    document.documentElement.dataset.environmentMode = this.environmentMode;
    this.updateBottomNavIconColors();
    this.refreshObjectRowIcons();
    [this.elements.environmentLightButton, this.elements.environmentDarkButton].forEach((button) => {
      const active = button.dataset.environmentMode === this.environmentMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  updateBottomNavIconColors(icons = document.querySelectorAll(".bottom-nav .bottom-nav-icon")) {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--bottom-nav-icon-color").trim() || "#333333";
    Array.from(icons).forEach((icon) => {
      if (icon instanceof HTMLElement) {
        void this.applyBottomNavIconColor(icon, color);
      }
    });
  }

  async applyBottomNavIconColor(icon, color) {
    const sourceUrl = this.getSvgIconSourceUrl(icon);
    if (!sourceUrl) return;

    // Icons inside the burger stack (.bottom-nav-stack.open) get an inverted two-tone
    // recolor in dark mode so two-tone icons stay legible. The replacement colors are
    // declared globally as CSS variables for easy editing.
    const stackDark = this.environmentMode === "dark" && !!icon.closest(".bottom-nav-stack");
    const tintKey = stackDark ? "stack-dark" : color;
    icon.dataset.svgTintSource = sourceUrl;
    icon.dataset.svgTintColor = tintKey;

    let stackPrimary = "";
    let stackSecondary = "";
    if (stackDark) {
      const rootStyle = getComputedStyle(document.documentElement);
      stackPrimary = rootStyle.getPropertyValue("--bottom-nav-stack-icon-color").trim() || "#ffffff";
      stackSecondary = rootStyle.getPropertyValue("--bottom-nav-stack-icon-bg").trim() || "#000000";
    }

    const cacheKey = stackDark ? `${sourceUrl}|stack|${stackPrimary}|${stackSecondary}` : `${sourceUrl}|${color}`;
    let imageValue = this.bottomNavIconDataCache.get(cacheKey);
    if (!imageValue) {
      const svg = await this.loadBottomNavIconSvg(sourceUrl);
      if (svg == null) return;
      const tintedSvg = stackDark
        ? this.tintStackIconSvg(svg, stackPrimary, stackSecondary)
        : svg.replace(/#6975a0/gi, color);
      imageValue = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(tintedSvg)}")`;
      this.bottomNavIconDataCache.set(cacheKey, imageValue);
    }

    if (icon.dataset.svgTintSource === sourceUrl && icon.dataset.svgTintColor === tintKey) {
      icon.style.setProperty("--bottom-nav-icon-image", imageValue);
    }
  }

  async loadBottomNavIconSvg(sourceUrl) {
    let svg = this.bottomNavIconSourceCache.get(sourceUrl);
    if (!svg) {
      const response = await fetch(sourceUrl);
      if (!response.ok) return null;
      svg = await response.text();
      this.bottomNavIconSourceCache.set(sourceUrl, svg);
    }
    return svg;
  }

  // Two-tone recolor for burger-stack icons: #6975A0 -> primary, white -> secondary.
  // A sentinel guards against the primary color (which may itself be white) being
  // swept up by the subsequent white->secondary replacement.
  tintStackIconSvg(svg, primary, secondary) {
    const SENTINEL = "__bnStackPrimary__";
    let tinted = svg.replace(/#6975a0/gi, SENTINEL);
    tinted = tinted.replace(
      /\b(fill|stroke|color|stop-color)=("|')(?:#fff(?:fff)?|white)\2/gi,
      `$1=$2${secondary}$2`
    );
    tinted = tinted.replace(
      /\b(fill|stroke|color|stop-color)\s*:\s*(?:#fff(?:fff)?|white)(?=[;\s"'])/gi,
      `$1:${secondary}`
    );
    return tinted.split(SENTINEL).join(primary);
  }

  tintSvgToDataUrl(svg, color, dark) {
    let tinted = svg.replace(/#6975a0/gi, color);
    if (dark) {
      tinted = tinted.replace(
        /\b(fill|stroke|color|stop-color)=("|')(?:#fff(?:fff)?|white)\2/gi,
        "$1=$2#000000$2"
      );
      tinted = tinted.replace(
        /\b(fill|stroke|color|stop-color)\s*:\s*(?:#fff(?:fff)?|white)(?=[;\s"'])/gi,
        "$1:#000000"
      );
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tinted)}`;
  }

  async applyObjectRowIconTint(icon, url) {
    if (!url || !/\.svg(?:[?#]|$)/i.test(url)) return;

    const dark = this.environmentMode === "dark";
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue("--ui_target_color").trim() || (dark ? "#00ff66" : "#7373ff");
    const cacheKey = `${url}|${color}|${dark ? "d" : "l"}`;

    const cached = this.objectRowIconTintedCache.get(cacheKey);
    if (cached) {
      icon.src = cached;
      return;
    }

    try {
      let fetchPromise = this.objectRowIconFetchCache.get(url);
      if (!fetchPromise) {
        fetchPromise = fetch(url).then((r) => {
          if (!r.ok) throw new Error();
          return r.text();
        });
        this.objectRowIconFetchCache.set(url, fetchPromise);
      }
      const svg = await fetchPromise;
      const dataUrl = this.tintSvgToDataUrl(svg, color, dark);
      this.objectRowIconTintedCache.set(cacheKey, dataUrl);
      icon.src = dataUrl;
    } catch {
      // icon.src already shows original
    }
  }

  async preloadObjectRowIcons(urls) {
    const svgUrls = [...new Set((urls || []).filter((url) => url && /\.svg(?:[?#]|$)/i.test(url)))];
    if (!svgUrls.length) return;

    const root = document.documentElement;
    const savedMode = root.dataset.environmentMode;
    root.dataset.environmentMode = "light";
    const lightColor = getComputedStyle(root).getPropertyValue("--ui_target_color").trim() || "#7373ff";
    root.dataset.environmentMode = "dark";
    const darkColor = getComputedStyle(root).getPropertyValue("--ui_target_color").trim() || "#00ff66";
    if (savedMode !== undefined) {
      root.dataset.environmentMode = savedMode;
    } else {
      delete root.dataset.environmentMode;
    }

    await Promise.all(svgUrls.map(async (url) => {
      let fetchPromise = this.objectRowIconFetchCache.get(url);
      if (!fetchPromise) {
        fetchPromise = fetch(url).then((r) => {
          if (!r.ok) throw new Error();
          return r.text();
        });
        this.objectRowIconFetchCache.set(url, fetchPromise);
      }
      try {
        const svg = await fetchPromise;
        const lightKey = `${url}|${lightColor}|l`;
        if (!this.objectRowIconTintedCache.has(lightKey)) {
          this.objectRowIconTintedCache.set(lightKey, this.tintSvgToDataUrl(svg, lightColor, false));
        }
        const darkKey = `${url}|${darkColor}|d`;
        if (!this.objectRowIconTintedCache.has(darkKey)) {
          this.objectRowIconTintedCache.set(darkKey, this.tintSvgToDataUrl(svg, darkColor, true));
        }
      } catch {
        // preload failure is non-critical
      }
    }));
  }

  refreshObjectRowIcons() {
    document.querySelectorAll(".object-row-icon[data-icon-src]").forEach((icon) => {
      if (icon instanceof HTMLImageElement) {
        void this.applyObjectRowIconTint(icon, icon.dataset.iconSrc);
      }
    });
  }

  getSvgIconSourceUrl(icon) {
    const source = getComputedStyle(icon).getPropertyValue("--svg-icon-source").trim();
    const match = source.match(/^url\((["']?)(.*?)\1\)$/);
    if (!match?.[2] || match[2] === "none") return "";
    return new URL(match[2], document.baseURI).href;
  }

  setPerformanceSettings(settings = {}) {
    this.performanceSettings = {
      materialMaps: settings.materialMaps !== false,
      stylizedRenderMode: ["off", "outline", "full"].includes(settings.stylizedRenderMode)
        ? settings.stylizedRenderMode
        : "off",
      renderResolutionScale: [0.5, 0.75, 1].includes(Number(settings.renderResolutionScale))
        ? Number(settings.renderResolutionScale)
        : 1,
      bloomQuality: ["none", "low", "medium", "high"].includes(settings.bloomQuality)
        ? settings.bloomQuality
        : "medium",
      lightingEffects: settings.lightingEffects !== false,
      antialias: settings.antialias === true
    };
    this.setBooleanRailChoice([
      this.elements.performanceMaterialMapsOffButton,
      this.elements.performanceMaterialMapsOnButton
    ], this.performanceSettings.materialMaps);
    this.setModeRailChoice([
      this.elements.performanceStylizedOffButton,
      this.elements.performanceStylizedOutlineButton,
      this.elements.performanceStylizedFullButton
    ], this.performanceSettings.stylizedRenderMode);
    this.setBooleanRailChoice([
      this.elements.performanceAntialiasOffButton,
      this.elements.performanceAntialiasOnButton
    ], this.performanceSettings.antialias);
    this.setBooleanRailChoice([
      this.elements.performanceLightingOffButton,
      this.elements.performanceLightingOnButton
    ], this.performanceSettings.lightingEffects);
    [
      this.elements.performanceRenderScale50Button,
      this.elements.performanceRenderScale75Button,
      this.elements.performanceRenderScale100Button
    ].forEach((button) => {
      const active = Number(button.dataset.renderResolutionScale) === this.performanceSettings.renderResolutionScale;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    [
      this.elements.performanceBloomNoneButton,
      this.elements.performanceBloomLowButton,
      this.elements.performanceBloomMediumButton,
      this.elements.performanceBloomHighButton
    ].forEach((button) => {
      const active = button.dataset.bloomQuality === this.performanceSettings.bloomQuality;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    this.elements.performanceBloomNoneButton
      .closest(".rail-choice-control")
      ?.classList.toggle("is-off", this.performanceSettings.bloomQuality === "none");
  }

  setModeRailChoice(buttons, activeValue) {
    buttons.forEach((button) => {
      const active = button.dataset.performanceModeValue === activeValue;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    buttons[0]
      ?.closest(".rail-choice-control")
      ?.classList.toggle("is-off", activeValue === "off");
  }

  setBooleanRailChoice(buttons, enabled) {
    buttons.forEach((button) => {
      const active = (button.dataset.performanceToggleValue === "true") === enabled;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    buttons[0]
      ?.closest(".rail-choice-control")
      ?.classList.toggle("is-off", !enabled);
  }

  setPlayerShips({
    shipDefinitions = {},
    shipCombatSummaries = {},
    weaponDefinitions = this.weaponDefinitions,
    shieldDefinitions = this.shieldDefinitions,
    equipmentDefinitions = this.equipmentDefinitions,
    combatCompatibilityDefinitions = this.combatCompatibilityDefinitions,
    defaultShipId = this.defaultShipId
  } = {}) {
    this.shipDefinitions = shipDefinitions || {};
    this.shipCombatSummaries = shipCombatSummaries || {};
    this.weaponDefinitions = weaponDefinitions || {};
    this.shieldDefinitions = shieldDefinitions || {};
    this.equipmentDefinitions = equipmentDefinitions || {};
    this.combatCompatibilityDefinitions = combatCompatibilityDefinitions || {};
    this.defaultShipId = defaultShipId;
    if (!this.shipDefinitions[this.selectedShipId]) this.selectedShipId = this.defaultShipId;
  }

  setPlayerProfile(profile = null) {
    this.playerProfile = profile;
    this.renderPlayerProfile();
  }

  formatShipStat(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return this.i18n.formatNumber(number, {
      maximumFractionDigits: Math.abs(number) >= 100 ? 0 : 1
    });
  }

  async openShipInfoPopup(shipId = this.selectedShipId) {
    // Re-read the authoritative player assets before rendering so the popup
    // reflects IndexedDB (e.g. loadout changes made in another tab), not a stale cache.
    try {
      await this.onRefreshPlayerAssets?.();
    } catch {
      /* fall back to cached state if the refresh fails */
    }
    this.openFittingSimulator(shipId, { mode: "info" });
  }

  closeShipInfoPopup() {
    document.querySelectorAll(".ship-info-backdrop").forEach((popup) => popup.remove());
    if (this.fittingState?.mode === "info") this.closeFittingSimulator();
  }

  renderShipInfoStat(label, value) {
    return `<span class="ship-info-stat"><b>${this.escapeHtml(label)}</b><span>${this.escapeHtml(value ?? "--")}</span></span>`;
  }

  renderShipInfoSlotSection(title, type, summary) {
    const slots = summary?.slots?.[type] || [];
    return `
      <section class="ship-info-section">
        <h3>${this.escapeHtml(title)}</h3>
        <div class="ship-slot-list">
          ${slots.length ? slots.map((slot) => this.renderShipSlotRow(type, slot)).join("") : `<div class="ship-slot-row"><div class="ship-slot-main"><b>No slots</b><span>--</span></div></div>`}
        </div>
      </section>
    `;
  }

  renderShipSlotRow(type, slot) {
    const definition = slot.equipped_definition;
    const name = definition ? this.getEquipmentDisplayName(definition) : "Empty";
    const meta = [
      type.toUpperCase(),
      String(slot.size || "--").toUpperCase(),
      slot.compatibility_preset_id || "no preset"
    ].join(" / ");
    return `
      <div class="ship-slot-row">
        <div class="ship-slot-main">
          <b>${this.escapeHtml(name)}</b>
          <span>${this.escapeHtml(slot.id || "slot")}</span>
        </div>
        <div class="ship-slot-meta">${this.escapeHtml(meta)}</div>
      </div>
    `;
  }

  renderShipInfoDetailStats(summary) {
    return `
      <section class="ship-info-section">
        <h3>Detailed Specs</h3>
        <div class="combat-detail-specs">
          ${this.renderCombatDetailSpecs(summary)}
        </div>
      </section>
    `;
  }

  renderCombatDetailSpecs(summary) {
    const stats = summary?.stats || {};
    return `
      <div class="combat-focus-stack">
        ${this.renderCombatDamagePanel(summary?.weapon_damage)}
        ${this.renderCombatShieldResPanel(summary)}
      </div>
      <div class="combat-secondary-stat-grid">
        ${[
      this.renderShipInfoStat("CPU", `${this.formatShipStat(stats.processing_load)}/${this.formatShipStat(stats.processing_capacity)}`),
      this.renderShipInfoStat("Power Regen", `${this.formatShipStat(stats.weapon_power_use)}/${this.formatShipStat(stats.power_recharge)}`),
      this.renderShipInfoStat("Power Cap", this.formatShipStat(stats.power_capacity)),
      this.renderShipInfoStat("Range", this.formatShipStat(summary?.weapon_range_max)),
      this.renderShipInfoStat("Hull", this.formatShipStat(stats.hull_capacity)),
      this.renderShipInfoStat("Hull Regen", this.formatShipStat(stats.hull_recharge_base)),
      this.renderShipInfoStat("Accuracy", this.formatPercent(summary?.weapon_average_accuracy)),
      this.renderShipInfoStat("Evasion", this.formatPercent(stats.evasion)),
      this.renderShipInfoStat("Crit", this.formatPercent(summary?.weapon_average_crit_chance)),
      this.renderShipInfoStat("Crit Dmg", this.formatPercent(summary?.weapon_average_crit_damage))
        ].join("")}
      </div>
    `;
  }

  renderCombatDamagePanel(damage = {}) {
    return `
      <section class="combat-focus-card">
        <h4>Weapons</h4>
        <div class="combat-attribute-list">
          ${this.renderCombatAttributeRow("Kinetic", this.formatShipStat(damage.kinetic))}
          ${this.renderCombatAttributeRow("Thermal", this.formatShipStat(damage.thermal))}
          ${this.renderCombatAttributeRow("Energy", this.formatShipStat(damage.energy))}
          ${this.renderCombatAttributeRow("Beta", this.formatShipStat(damage.beta))}
        </div>
      </section>
    `;
  }

  renderCombatShieldResPanel(summary) {
    const stats = summary?.stats || {};
    const defense = summary?.shield_defense || {};
    const shieldCount = summary?.equipped_counts?.shield || 0;
    const formula = shieldCount > 1
      ? `${this.formatShipStat(stats.shield_recharge_base)} + SUM(rate x cap) = ${this.formatShipStat(stats.shield_recharge_power)}`
      : `${this.formatShipStat(stats.shield_recharge_base)} + (${this.formatShipStat(stats.shield_recharge_rate)} x ${this.formatShipStat(stats.shield_power_use_cap)}) = ${this.formatShipStat(stats.shield_recharge_power)}`;
    return `
      <details class="combat-focus-card combat-shield-res-card">
        <summary class="combat-shield-res-summary">
          <div class="combat-focus-title-row">
            <h4>Shields</h4>
            <span class="combat-focus-title-value">
              <span>${this.escapeHtml(this.formatShipStat(stats.shield_capacity))}</span>
              <span class="combat-focus-title-separator">/</span>
              <span>${this.escapeHtml(this.formatShipStat(stats.shield_recharge_power))}</span>
            </span>
          </div>
          <div class="combat-attribute-list">
            ${this.renderCombatResistRow("Kinetic", defense.kinetic)}
            ${this.renderCombatResistRow("Thermal", defense.thermal)}
            ${this.renderCombatResistRow("Energy", defense.energy)}
          </div>
        </summary>
        <div class="combat-shield-regen-breakdown">
          ${this.renderCombatFormulaRow("Base Regen", this.formatShipStat(stats.shield_recharge_base))}
          ${this.renderCombatFormulaRow("Regen / Power", this.formatShipStat(stats.shield_recharge_rate))}
          ${this.renderCombatFormulaRow("Shield Power Cap", this.formatShipStat(stats.shield_power_use_cap))}
          <span class="combat-formula-tag">${this.escapeHtml(formula)}</span>
        </div>
      </details>
    `;
  }

  renderCombatAttributeRow(label, value) {
    return `
      <div class="combat-attribute-row">
        <span class="combat-attribute-badge">${this.escapeHtml(label)}</span>
        <span class="combat-attribute-value">${this.escapeHtml(value ?? "--")}</span>
      </div>
    `;
  }

  renderCombatResistRow(label, value) {
    return `
      <div class="combat-attribute-row combat-resist-row">
        <span class="combat-attribute-badge">${this.escapeHtml(label)}</span>
        <span class="combat-attribute-value">${this.escapeHtml(this.formatPercent(value))}</span>
      </div>
    `;
  }

  renderCombatFormulaRow(label, value) {
    return `
      <span class="combat-formula-row">
        <b>${this.escapeHtml(label)}</b>
        <span>${this.escapeHtml(value ?? "--")}</span>
      </span>
    `;
  }

  getEquipmentDisplayName(definition) {
    if (!definition) return "Empty";
    return this.i18n.resolveDefinitionText(definition, "name", definition.name || definition.id || "Equipment");
  }

  formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return `${this.i18n.formatNumber(number * 100, { maximumFractionDigits: 1 })}%`;
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  openFittingSimulator(shipId = this.selectedShipId, { mode = "simulation" } = {}) {
    this.closeFittingSimulator();
    const ship = this.shipDefinitions[shipId] || this.getSelectedShipDefinition();
    if (!ship) return;
    const panelMode = mode === "info" ? "info" : "simulation";
    const baseSummary = this.onBuildFittingSummary?.(ship.id, {}) || this.shipCombatSummaries?.[ship.id] || null;
    const panelTitle = panelMode === "simulation" ? "Fitting" : "Ship Info";
    const detailTitle = panelMode === "simulation" ? "Detailed Simulation" : "Detailed Specs";
    const fitToggleLabel = panelMode === "simulation" ? "Info" : "Fit";
    this.fittingState = {
      mode: panelMode,
      shipId: ship.id,
      selectedSlotKey: this.firstFittingSlotKey(baseSummary),
      overrides: {},
      compatibilityPopup: null
    };

    const backdrop = document.createElement("div");
    backdrop.className = `ship-fitting-backdrop ship-fitting-${panelMode}-backdrop`;
    backdrop.setAttribute("role", "presentation");
    backdrop.innerHTML = `
      <section class="ship-fitting-panel" role="dialog" aria-modal="true" aria-labelledby="shipFittingTitle">
        <header class="ship-fitting-header">
          <h2 class="ship-fitting-title" id="shipFittingTitle">${this.escapeHtml(panelTitle)}</h2>
          <button class="object-list-close" type="button" data-fitting-close aria-label="Close" title="Close">
            <span class="svg-icon svg-icon-close" aria-hidden="true"></span>
          </button>
        </header>
        <div class="ship-fitting-body">
          <div class="ship-fitting-layout">
            <div class="ship-fitting-stage">
              <div class="ship-fitting-model-wrap">
                <canvas data-fitting-canvas></canvas>
                <div class="ship-fitting-model-label">${this.escapeHtml(this.getShipDisplayName(ship))}</div>
                <details class="ship-fitting-menu">
                  <summary class="ship-fitting-menu-toggle" aria-label="Fitting menu" title="Fitting menu">
                    <span></span>
                    <span></span>
                    <span></span>
                  </summary>
                  <div class="ship-fitting-menu-panel">
                    <button class="ship-fitting-menu-item ship-fitting-base-spec-button" type="button" data-fitting-base-spec>Base Spec</button>
                    <button class="ship-fitting-menu-item" type="button" data-fitting-cargo>Cargo</button>
                    <button class="ship-fitting-menu-item" type="button" data-fitting-menu-action="fit">${this.escapeHtml(fitToggleLabel)}</button>
                    <button class="ship-fitting-menu-item" type="button" data-fitting-menu-action="preset">Preset</button>
                  </div>
                </details>
                <div class="ship-fitting-model-cargo" data-fitting-model-cargo>${this.escapeHtml(this.formatFittingCargo(baseSummary))}</div>
                ${panelMode === "simulation" ? `<div class="ship-fitting-mode-label">FIT SIMULATION</div>` : ""}
              </div>
              <div class="ship-fitting-slot-band">
                <div class="ship-fitting-section-title">Shield Slots</div>
                <div class="ship-fitting-slot-row" data-fitting-slots="shield"></div>
                <div class="ship-fitting-section-title">Equipment Slots</div>
                <div class="ship-fitting-slot-row" data-fitting-slots="equipment"></div>
              </div>
              <div class="ship-fitting-slot-band">
                <div class="ship-fitting-section-title">Weapon Slots</div>
                <div class="ship-fitting-slot-row" data-fitting-slots="weapon"></div>
              </div>
              <div class="fitting-stat-strip">
                <div class="ship-fitting-section-title">${this.escapeHtml(detailTitle)}</div>
                <div class="combat-detail-specs" data-fitting-stats></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    backdrop.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.target === backdrop || target?.closest("[data-fitting-close]")) {
        event.preventDefault();
        this.closeFittingSimulator();
        return;
      }

      const slotButton = target?.closest("[data-fitting-slot-key]");
      if (slotButton instanceof HTMLElement) {
        event.preventDefault();
        const summary = this.getFittingSummary();
        const slotRef = this.getFittingSlotByKey(summary, slotButton.dataset.fittingSlotKey);
        if (!slotRef) return;
        this.fittingState.selectedSlotKey = slotButton.dataset.fittingSlotKey;
        if (slotRef.slot.equipped) {
          this.openFittingSlotBubble(slotButton, slotRef.type, slotRef.slot);
        } else {
          this.closeFittingSlotBubble();
          this.openFittingCompatiblePopup(slotRef.type, slotRef.slot.id);
        }
      }

      const baseSpecButton = target?.closest("[data-fitting-base-spec]");
      if (baseSpecButton instanceof HTMLElement) {
        event.preventDefault();
        baseSpecButton.closest(".ship-fitting-menu")?.removeAttribute("open");
        this.openFittingBaseSpecPopup();
        return;
      }

      const cargoButton = target?.closest("[data-fitting-cargo]");
      if (cargoButton instanceof HTMLElement) {
        event.preventDefault();
        cargoButton.closest(".ship-fitting-menu")?.removeAttribute("open");
        this.openFittingCargoPopup();
        return;
      }

      const menuActionButton = target?.closest("[data-fitting-menu-action]");
      if (menuActionButton instanceof HTMLElement) {
        event.preventDefault();
        menuActionButton.closest(".ship-fitting-menu")?.removeAttribute("open");
        if (menuActionButton.dataset.fittingMenuAction === "fit" && this.fittingState) {
          const nextMode = this.fittingState.mode === "simulation" ? "info" : "simulation";
          this.openFittingSimulator(this.fittingState.shipId, { mode: nextMode });
        }
        return;
      }
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.closeFittingSimulator();
    });

    document.body.append(backdrop);
    this.updateFittingSimulator();
    const canvas = backdrop.querySelector("[data-fitting-canvas]");
    if (canvas instanceof HTMLCanvasElement) this.onOpenFittingSimulator?.({ canvas, shipId: ship.id, mode: panelMode });
    const closeButton = backdrop.querySelector("[data-fitting-close]");
    if (closeButton instanceof HTMLElement) closeButton.focus({ preventScroll: true });
  }

  closeFittingSimulator() {
    this.onCloseFittingSimulator?.();
    this.closeFittingSlotBubble();
    this.closeFittingCompatiblePopup();
    this.closeFittingItemInfoPopup();
    this.closeFittingBaseSpecPopup();
    this.closeFittingCargoPopup();
    document.querySelectorAll(".ship-fitting-backdrop").forEach((popup) => popup.remove());
    this.fittingState = null;
  }

  firstFittingSlotKey(summary) {
    for (const type of ["shield", "equipment", "weapon"]) {
      const slot = summary?.slots?.[type]?.[0];
      if (slot) return this.fittingSlotKey(type, slot.id);
    }
    return null;
  }

  fittingSlotKey(type, slotId) {
    return `${type}:${slotId}`;
  }

  getFittingSummary() {
    const state = this.fittingState;
    if (!state) return null;
    const overrides = state.mode === "simulation" ? state.overrides : {};
    return this.onBuildFittingSummary?.(state.shipId, overrides)
      || this.shipCombatSummaries?.[state.shipId]
      || null;
  }

  updateFittingSimulator() {
    const popup = document.querySelector(".ship-fitting-backdrop");
    const state = this.fittingState;
    if (!popup || !state) return;
    const summary = this.getFittingSummary();
    if (!state.selectedSlotKey) state.selectedSlotKey = this.firstFittingSlotKey(summary);

    for (const type of ["shield", "equipment", "weapon"]) {
      const root = popup.querySelector(`[data-fitting-slots="${type}"]`);
      if (root) root.innerHTML = this.renderFittingSlotButtons(type, summary);
    }

    const stats = popup.querySelector("[data-fitting-stats]");
    if (stats) stats.innerHTML = this.renderFittingStats(summary);

    const cargo = popup.querySelector("[data-fitting-model-cargo]");
    if (cargo) cargo.textContent = this.formatFittingCargo(summary);
  }

  formatFittingCargo(summary) {
    const used = Number.isFinite(Number(summary?.cargo?.used)) ? Number(summary.cargo.used) : 0;
    const capacity = Number.isFinite(Number(summary?.stats?.cargo_capacity)) ? Number(summary.stats.cargo_capacity) : Number(summary?.cargo?.capacity);
    return `Cargo ${this.formatShipStat(used)}/${this.formatShipStat(capacity)}`;
  }

  renderFittingStats(summary) {
    return this.renderCombatDetailSpecs(summary);
  }

  renderFittingSlotButtons(type, summary) {
    const slots = summary?.slots?.[type] || [];
    if (!slots.length) return `<div class="ship-slot-row"><div class="ship-slot-main"><b>No slots</b><span>--</span></div></div>`;
    return slots.map((slot) => {
      const key = this.fittingSlotKey(type, slot.id);
      const definition = slot.equipped_definition;
      const name = definition ? this.getEquipmentDisplayName(definition) : "Empty";
      const iconMarkup = definition
        ? `<img class="fitting-slot-icon" src="${this.escapeHtml(this.getFittingIconPath(type, definition))}" alt="" aria-hidden="true">`
        : "";
      const stateClass = definition ? "equiped" : "empty";
      const label = `${type.toUpperCase()} ${String(slot.size || "--").toUpperCase()} ${slot.id || "slot"}: ${name}`;
      return `
        <button class="fitting-slot-button ${stateClass}" type="button"
          data-fitting-slot-key="${this.escapeHtml(key)}" data-fitting-slot-type="${this.escapeHtml(type)}" data-fitting-slot-id="${this.escapeHtml(slot.id)}"
          aria-label="${this.escapeHtml(label)}" title="${this.escapeHtml(label)}">
          ${iconMarkup}
        </button>
      `;
    }).join("");
  }

  getFittingSlotByKey(summary, key) {
    if (!key) return null;
    const [type, slotId] = key.split(":");
    const slot = (summary?.slots?.[type] || []).find((entry) => entry.id === slotId) || null;
    return slot ? { type, slot } : null;
  }

  openFittingSlotBubble(slotButton, type, slot) {
    this.closeFittingSlotBubble();
    if (!(slotButton instanceof HTMLElement)) return;
    const key = this.fittingSlotKey(type, slot.id);
    const rect = slotButton.getBoundingClientRect();
    const bubble = document.createElement("div");
    bubble.className = "fitting-slot-bubble";
    bubble.dataset.fittingSlotKey = key;
    bubble.style.left = `${Math.min(window.innerWidth - 220, Math.max(12, rect.left))}px`;
    bubble.style.top = `${Math.min(window.innerHeight - 72, rect.bottom + 8)}px`;
    bubble.innerHTML = `
      <button class="fitting-bubble-button" type="button" data-fitting-bubble-action="unequip">Unequip</button>
      <button class="fitting-bubble-button" type="button" data-fitting-bubble-action="info">Info</button>
      <button class="fitting-bubble-button" type="button" data-fitting-bubble-action="change">Change</button>
    `;
    bubble.addEventListener("click", (event) => {
      const actionButton = event.target instanceof Element ? event.target.closest("[data-fitting-bubble-action]") : null;
      if (!(actionButton instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      const action = actionButton.dataset.fittingBubbleAction;
      if (action === "unequip") {
        this.applyFittingSlotOverride(type, slot.id, "");
        this.closeFittingSlotBubble();
      } else if (action === "info") {
        if (slot.equipped_definition) this.openFittingItemInfoPopup(type, slot.equipped_definition);
        this.closeFittingSlotBubble();
      } else if (action === "change") {
        this.openFittingCompatiblePopup(type, slot.id);
        this.closeFittingSlotBubble();
      }
    });
    document.body.append(bubble);
  }

  closeFittingSlotBubble() {
    document.querySelectorAll(".fitting-slot-bubble").forEach((bubble) => bubble.remove());
  }

  async applyFittingSlotOverride(type, slotId, equippedId) {
    if (!this.fittingState) return;
    const key = this.fittingSlotKey(type, slotId);
    this.fittingState.selectedSlotKey = key;
    if (this.fittingState.mode === "info") {
      const summary = await this.onApplyShipLoadoutChange?.({
        shipId: this.fittingState.shipId,
        type,
        slotId,
        equippedId: equippedId || ""
      });
      if (summary) {
        this.shipCombatSummaries = {
          ...this.shipCombatSummaries,
          [this.fittingState.shipId]: summary
        };
      }
      this.updateFittingSimulator();
      return;
    }
    this.fittingState.overrides[key] = equippedId || "";
    this.updateFittingSimulator();
  }

  openFittingCompatiblePopup(type, slotId) {
    this.closeFittingCompatiblePopup();
    this.closeFittingItemInfoPopup();
    const summary = this.getFittingSummary();
    const slot = (summary?.slots?.[type] || []).find((entry) => entry.id === slotId);
    if (!slot || !this.fittingState) return;
    const candidates = this.getFittingCandidates(type, slot);
    const selectedCandidate = candidates.find((candidate) => this.getFittingCandidateId(candidate) === slot.equipped_item_uid)
      || candidates.find((candidate) => candidate.id === slot.equipped_id)
      || candidates[0]
      || null;
    this.fittingState.compatibilityPopup = {
      type,
      slotId,
      selectedCandidateId: this.getFittingCandidateId(selectedCandidate)
    };

    const backdrop = document.createElement("div");
    backdrop.className = "fitting-compatible-backdrop";
    backdrop.innerHTML = `
      <section class="fitting-compatible-panel" role="dialog" aria-modal="true" aria-labelledby="fittingCompatibleTitle">
        <header class="fitting-compatible-header">
          <h2 class="fitting-compatible-title" id="fittingCompatibleTitle">${this.escapeHtml(type.toUpperCase())} Candidates</h2>
          <button class="object-list-close" type="button" data-compatible-close aria-label="Close" title="Close">
            <span class="svg-icon svg-icon-close" aria-hidden="true"></span>
          </button>
        </header>
        <div class="fitting-compatible-body">
          <div class="fitting-compatible-layout">
            <div class="fitting-compatible-detail" data-compatible-detail></div>
            <div class="fitting-candidate-list" data-compatible-list></div>
          </div>
        </div>
      </section>
    `;
    backdrop.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.target === backdrop || target?.closest("[data-compatible-close]")) {
        event.preventDefault();
        this.closeFittingCompatiblePopup();
        return;
      }
      const candidateButton = target?.closest("[data-compatible-candidate-id]");
      if (candidateButton instanceof HTMLElement) {
        event.preventDefault();
        this.fittingState.compatibilityPopup.selectedCandidateId = candidateButton.dataset.compatibleCandidateId || "";
        this.updateFittingCompatiblePopup();
        return;
      }
      const equipButton = target?.closest("[data-compatible-equip]");
      if (equipButton instanceof HTMLElement) {
        event.preventDefault();
        const context = this.fittingState?.compatibilityPopup;
        if (!context?.selectedCandidateId) return;
        this.applyFittingSlotOverride(context.type, context.slotId, context.selectedCandidateId);
        this.closeFittingCompatiblePopup();
      }
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.closeFittingCompatiblePopup();
    });
    document.body.append(backdrop);
    this.updateFittingCompatiblePopup();
  }

  closeFittingCompatiblePopup() {
    document.querySelectorAll(".fitting-compatible-backdrop").forEach((popup) => popup.remove());
    if (this.fittingState) this.fittingState.compatibilityPopup = null;
  }

  updateFittingCompatiblePopup() {
    const popup = document.querySelector(".fitting-compatible-backdrop");
    const context = this.fittingState?.compatibilityPopup;
    if (!popup || !context) return;
    const summary = this.getFittingSummary();
    const slot = (summary?.slots?.[context.type] || []).find((entry) => entry.id === context.slotId);
    const candidates = slot ? this.getFittingCandidates(context.type, slot) : [];
    const list = popup.querySelector("[data-compatible-list]");
    const detail = popup.querySelector("[data-compatible-detail]");
    if (list) {
      list.innerHTML = candidates.length
        ? candidates.map((definition) => this.renderCompatibleCandidateButton(context.type, definition, this.getFittingCandidateId(definition) === context.selectedCandidateId)).join("")
        : `<div class="player-ship-empty">No compatible candidates.</div>`;
    }
    const selected = candidates.find((definition) => this.getFittingCandidateId(definition) === context.selectedCandidateId) || null;
    if (detail) detail.innerHTML = this.renderFittingDefinitionDetail(context.type, selected, { actionLabel: "Equip", actionAttr: "data-compatible-equip" });
  }

  renderCompatibleCandidateButton(type, definition, active) {
    const candidateId = this.getFittingCandidateId(definition);
    return `
      <button class="fitting-candidate-button ${active ? "active" : ""}" type="button" data-compatible-candidate-id="${this.escapeHtml(candidateId)}">
        <b>${this.escapeHtml(this.getEquipmentDisplayName(definition))}</b>
        <span class="fitting-candidate-cost">${this.escapeHtml(`CPU ${this.formatShipStat(definition.processing_load)}`)}</span>
      </button>
    `;
  }

  getFittingCandidateId(candidate) {
    return candidate?.candidate_id || candidate?.item_uid || candidate?.id || "";
  }

  openFittingItemInfoPopup(type, definition) {
    this.closeFittingItemInfoPopup();
    if (!definition) return;
    const backdrop = document.createElement("div");
    backdrop.className = "fitting-item-info-backdrop";
    backdrop.innerHTML = `
      <section class="fitting-item-info-panel" role="dialog" aria-modal="true" aria-labelledby="fittingItemInfoTitle">
        <header class="fitting-item-info-header">
          <h2 class="fitting-item-info-title" id="fittingItemInfoTitle">${this.escapeHtml(this.getEquipmentDisplayName(definition))}</h2>
          <button class="object-list-close" type="button" data-item-info-close aria-label="Close" title="Close">
            <span class="svg-icon svg-icon-close" aria-hidden="true"></span>
          </button>
        </header>
        <div class="fitting-item-info-body">
          ${this.renderFittingDefinitionDetail(type, definition)}
        </div>
      </section>
    `;
    backdrop.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.target === backdrop || target?.closest("[data-item-info-close]")) {
        event.preventDefault();
        this.closeFittingItemInfoPopup();
      }
    });
    document.body.append(backdrop);
  }

  closeFittingItemInfoPopup() {
    document.querySelectorAll(".fitting-item-info-backdrop").forEach((popup) => popup.remove());
  }

  openFittingCargoPopup() {
    this.closeFittingCargoPopup();
    this.closeFittingItemInfoPopup();
    this.closeFittingBaseSpecPopup();
    const cargo = this.onGetActiveShipCargo?.() || null;
    const backdrop = document.createElement("div");
    backdrop.className = "fitting-item-info-backdrop fitting-cargo-backdrop";
    backdrop.innerHTML = `
      <section class="fitting-item-info-panel fitting-cargo-panel" role="dialog" aria-modal="true" aria-labelledby="fittingCargoTitle">
        <header class="fitting-item-info-header">
          <h2 class="fitting-item-info-title" id="fittingCargoTitle">Cargo</h2>
          <button class="object-list-close" type="button" data-cargo-close aria-label="Close" title="Close">
            <span class="svg-icon svg-icon-close" aria-hidden="true"></span>
          </button>
        </header>
        <div class="fitting-item-info-body">
          ${this.renderFittingCargoContent(cargo)}
        </div>
      </section>
    `;
    backdrop.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.target === backdrop || target?.closest("[data-cargo-close]")) {
        event.preventDefault();
        this.closeFittingCargoPopup();
        return;
      }
      const toggle = target?.closest("[data-cargo-display-toggle]");
      if (toggle instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        const dropdown = toggle.closest(".object-list-sort-dropdown");
        const shouldOpen = !dropdown?.classList.contains("open");
        this.closeCargoDisplayDropdowns(backdrop);
        if (shouldOpen) dropdown?.classList.add("open");
        return;
      }
      const option = target?.closest("[data-cargo-display]");
      if (option instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        this.cargoDisplayKind = this.getNormalizedCargoDisplayKind(option.dataset.cargoDisplay);
        this.updateFittingCargoPopup();
        return;
      }
      if (!target?.closest(".object-list-sort-dropdown")) {
        this.closeCargoDisplayDropdowns(backdrop);
      }
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.closeFittingCargoPopup();
    });
    document.body.append(backdrop);
  }

  closeFittingCargoPopup() {
    document.querySelectorAll(".fitting-cargo-backdrop").forEach((popup) => popup.remove());
  }

  updateFittingCargoPopup() {
    const popup = document.querySelector(".fitting-cargo-backdrop");
    const body = popup?.querySelector(".fitting-item-info-body");
    if (!body) return;
    body.innerHTML = this.renderFittingCargoContent(this.onGetActiveShipCargo?.() || null);
  }

  closeCargoDisplayDropdowns(root = document) {
    root.querySelectorAll(".object-list-sort-dropdown.open")
      .forEach((dropdown) => dropdown.classList.remove("open"));
  }

  renderFittingCargoContent(cargo) {
    const used = Number.isFinite(Number(cargo?.used_capacity)) ? Number(cargo.used_capacity) : 0;
    const capacity = Number.isFinite(Number(cargo?.capacity)) ? Number(cargo.capacity) : 0;
    const allRows = Array.isArray(cargo?.rows) ? cargo.rows : [];
    const displayKind = this.getNormalizedCargoDisplayKind(this.cargoDisplayKind);
    const rows = this.getFilteredCargoRows(allRows, displayKind);
    return `
      <section class="ship-info-section">
        ${this.renderFittingCargoDisplayControls(displayKind, rows, { used, capacity })}
        <div class="fitting-cargo-list">
          <div class="fitting-cargo-header">
            <span>Name</span>
            <span>Qty</span>
            <span>Volume</span>
          </div>
          ${rows.map((row) => this.renderFittingCargoRow(row)).join("")}
        </div>
      </section>
    `;
  }

  renderFittingCargoDisplayControls(displayKind, rows, { used = 0, capacity = 0 } = {}) {
    const options = this.getCargoDisplayOptions();
    const activeOption = options.find((option) => option.id === displayKind) || options[0];
    return `
      <div class="fitting-cargo-controls object-list-sort-controls" aria-label="Cargo display">
        <span class="fitting-cargo-capacity-summary">${this.escapeHtml(`${this.formatShipStat(used)}/${this.formatShipStat(capacity)}`)}</span>
        <div class="object-list-sort-dropdown">
          <button class="object-list-sort-button active" type="button" data-cargo-display-toggle="true">
            <span>${this.escapeHtml(activeOption.label)}</span>
            <span class="svg-icon svg-icon-drop-arrow" aria-hidden="true"></span>
          </button>
          <div class="object-list-sort-menu">
            ${options.map((option) => `
              <button class="object-list-sort-option ${option.id === displayKind ? "active" : ""}" type="button"
                data-cargo-display="${this.escapeHtml(option.id)}" aria-pressed="${option.id === displayKind ? "true" : "false"}">
                ${this.escapeHtml(option.label)}
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  getCargoDisplayOptions() {
    return [
      { id: "all", label: "All" },
      { id: "resource", label: "Resources" },
      { id: "weapon", label: "Weapons" },
      { id: "shield", label: "Shields" },
      { id: "equipment", label: "Equipment" },
      { id: "ship", label: "Ships" }
    ];
  }

  getNormalizedCargoDisplayKind(kind) {
    const value = String(kind || "all");
    return this.getCargoDisplayOptions().some((option) => option.id === value) ? value : "all";
  }

  getFilteredCargoRows(rows, displayKind = this.cargoDisplayKind) {
    const normalized = this.getNormalizedCargoDisplayKind(displayKind);
    if (normalized === "all") return rows;
    return rows.filter((row) => (row?.kind || row?.category || "item") === normalized);
  }

  renderFittingCargoRow(row) {
    const quantity = Number.isFinite(Number(row?.quantity)) ? Number(row.quantity) : 0;
    const totalMass = Number.isFinite(Number(row?.total_mass)) ? Number(row.total_mass) : 0;
    return `
      <div class="fitting-cargo-row">
        <span class="fitting-cargo-name">${this.escapeHtml(row?.display_name || row?.item_id || "Item")}</span>
        <span class="fitting-cargo-quantity">${this.escapeHtml(this.formatShipStat(quantity))}</span>
        <span class="fitting-cargo-volume">${this.escapeHtml(this.formatShipStat(totalMass))}</span>
      </div>
    `;
  }

  openFittingBaseSpecPopup() {
    this.closeFittingBaseSpecPopup();
    this.closeFittingCargoPopup();
    const summary = this.getFittingSummary();
    if (!summary) return;
    const backdrop = document.createElement("div");
    backdrop.className = "fitting-item-info-backdrop fitting-base-spec-backdrop";
    backdrop.innerHTML = `
      <section class="fitting-item-info-panel" role="dialog" aria-modal="true" aria-labelledby="fittingBaseSpecTitle">
        <header class="fitting-item-info-header">
          <h2 class="fitting-item-info-title" id="fittingBaseSpecTitle">Base Specs</h2>
          <button class="object-list-close" type="button" data-base-spec-close aria-label="Close" title="Close">
            <span class="svg-icon svg-icon-close" aria-hidden="true"></span>
          </button>
        </header>
        <div class="fitting-item-info-body">
          ${this.renderFittingBaseSpecContent(summary)}
        </div>
      </section>
    `;
    backdrop.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.target === backdrop || target?.closest("[data-base-spec-close]")) {
        event.preventDefault();
        this.closeFittingBaseSpecPopup();
      }
    });
    document.body.append(backdrop);
  }

  closeFittingBaseSpecPopup() {
    document.querySelectorAll(".fitting-base-spec-backdrop").forEach((popup) => popup.remove());
  }

  renderFittingBaseSpecContent(summary) {
    const ship = this.shipDefinitions?.[summary?.ship_id] || {};
    const { hyperdriveSpecs: nestedHyperdriveSpecs, ...flightSpecs } = ship.specs || {};
    const hyperdriveSpecs = ship.hyperdriveSpecs || nestedHyperdriveSpecs || {};
    return `
      <section class="ship-info-section">
        <h3>Ship Class</h3>
        <div class="ship-info-stat-grid">
          ${this.renderShipInfoStat("Class", summary?.ship_class ? String(summary.ship_class).toUpperCase() : "--")}
        </div>
      </section>
      <section class="ship-info-section">
        <h3>Flight Specs</h3>
        <div class="ship-info-stat-grid">
          ${this.renderDefinitionSpecStats(flightSpecs, [
            "maxSpeed",
            "minSpeed",
            "accelerationRate",
            "decelerationRate",
            "throttleAdjustRate",
            "arrivalRadius",
            "deactivationCoastDuration",
            "pitchRate",
            "yawRate",
            "rollRate",
            "strafeRate",
            "verticalRate"
          ])}
        </div>
      </section>
      <section class="ship-info-section">
        <h3>Hyperdrive Specs</h3>
        <div class="ship-info-stat-grid">
          ${this.renderDefinitionSpecStats(hyperdriveSpecs, [
            "cooldownDuration",
            "warpEntryDuration",
            "warpExitDuration",
            "warpMinFlightDuration",
            "warpFlightSpeed"
          ])}
        </div>
      </section>
    `;
  }

  renderDefinitionSpecStats(source, orderedKeys = []) {
    const isDisplayValue = (value) => value == null || typeof value !== "object";
    const keys = [
      ...orderedKeys.filter((key) => Object.prototype.hasOwnProperty.call(source || {}, key) && isDisplayValue(source[key])),
      ...Object.keys(source || {}).filter((key) => !orderedKeys.includes(key) && isDisplayValue(source[key])).sort()
    ];
    if (!keys.length) return this.renderShipInfoStat("None", "--");
    return keys
      .map((key) => this.renderShipInfoStat(this.formatSpecLabel(key), this.formatShipStat(source[key])))
      .join("");
  }

  formatSpecLabel(key) {
    return String(key || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  renderFittingDefinitionDetail(type, definition, { actionLabel = "", actionAttr = "" } = {}) {
    if (!definition) return `<div class="player-ship-empty">Select an item to inspect.</div>`;
    return `
      <div class="ship-slot-row">
        <img class="fitting-slot-icon" src="${this.escapeHtml(this.getFittingIconPath(type, definition))}" alt="" aria-hidden="true">
        <div class="ship-slot-main">
          <b>${this.escapeHtml(this.getEquipmentDisplayName(definition))}</b>
          <div class="ship-slot-cost-row">
            <span class="ship-slot-cost-badge">Cost</span>
            <span class="ship-slot-cost-value">${this.escapeHtml(this.formatShipStat(definition.processing_load))}</span>
          </div>
        </div>
      </div>
      <div class="ship-info-stat-grid">
        ${this.renderFittingDefinitionStats(type, definition)}
      </div>
      ${actionLabel ? `<div class="fitting-compatible-actions"><button class="fitting-compatible-action" type="button" ${actionAttr}>${this.escapeHtml(actionLabel)}</button></div>` : ""}
    `;
  }

  renderFittingDefinitionStats(type, definition) {
    if (type === "weapon") {
      return [
        this.renderShipInfoStat("Kinetic", this.formatShipStat(definition.damage_kinetic)),
        this.renderShipInfoStat("Thermal", this.formatShipStat(definition.damage_thermal)),
        this.renderShipInfoStat("Energy", this.formatShipStat(definition.damage_energy)),
        this.renderShipInfoStat("Beta", this.formatShipStat(definition.damage_beta)),
        this.renderShipInfoStat("Power", this.formatShipStat(definition.power_use)),
        this.renderShipInfoStat("Range", this.formatShipStat(definition.range)),
        this.renderShipInfoStat("Acc", this.formatPercent(definition.acc)),
        this.renderShipInfoStat("Crit", this.formatPercent(definition.crit_chance))
      ].join("");
    }
    if (type === "shield") {
      return [
        this.renderShipInfoStat("Capacity", this.formatShipStat(definition.capacity)),
        this.renderShipInfoStat("Base Regen", this.formatShipStat(definition.recharge_base)),
        this.renderShipInfoStat("Boost Regen", this.formatShipStat(definition.recharge_rate)),
        this.renderShipInfoStat("Power Cap", this.formatShipStat(definition.power_use_cap)),
        this.renderShipInfoStat("Def K", this.formatPercent(definition.def_bonus_kinetic)),
        this.renderShipInfoStat("Def T", this.formatPercent(definition.def_bonus_thermal)),
        this.renderShipInfoStat("Def E", this.formatPercent(definition.def_bonus_energy))
      ].join("");
    }
    return [
      this.renderShipInfoStat("CPU Bonus", this.formatShipStat(definition.processing_capacity_bonus)),
      this.renderShipInfoStat("Power Cap", this.formatShipStat(definition.power_capacity_bonus)),
      this.renderShipInfoStat("Power Regen", this.formatShipStat(definition.power_recharge_bonus)),
      this.renderShipInfoStat("Cargo", this.formatShipStat(definition.cargo_capacity_bonus)),
      this.renderShipInfoStat("Evasion", this.formatPercent(definition.evasion_bonus)),
      this.renderShipInfoStat("Hull", this.formatShipStat(definition.hull_capacity_bonus)),
      this.renderShipInfoStat("Hull Regen", this.formatShipStat(definition.hull_recharge_base_bonus))
    ].join("");
  }

  getFittingCandidates(type, slot, { candidateScope = this.getFittingCandidateScope() } = {}) {
    const runtimeCandidates = this.onGetFittingCandidates?.({
      shipId: this.fittingState?.shipId,
      type,
      slot,
      candidateScope
    });
    if (Array.isArray(runtimeCandidates)) return runtimeCandidates;

    const definitions = this.getEquipmentDefinitionsForType(type);
    const allDefinitions = Object.values(definitions);
    const preset = this.combatCompatibilityDefinitions?.compatibilityPresets?.[type]?.[slot.compatibility_preset_id];
    const presetIds = Array.isArray(preset?.compatible_ids) ? new Set(preset.compatible_ids) : null;
    const allowedSizes = this.combatCompatibilityDefinitions?.sizeCompatibility?.[slot.size] || [slot.size];
    return allDefinitions
      .filter((definition) => {
        if (presetIds && !presetIds.has(definition.id)) return false;
        if (!allowedSizes.includes(definition.size)) return false;
        if (candidateScope === "owned" && !this.isEquipmentDefinitionOwned(type, definition.id)) return false;
        return true;
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  getFittingCandidateScope() {
    return this.fittingState?.mode === "simulation" ? "all" : "owned";
  }

  isEquipmentDefinitionOwned(type, definitionId) {
    if (!definitionId) return false;
    return this.onCheckEquipmentOwned?.(type, definitionId) ?? true;
  }

  getFittingIconPath(type, definition = null) {
    if (type === "equipment") return "rss/svg/icn_equip_n.svg";
    if (type === "shield") return `rss/svg/icn_shield_${this.getShieldIconSuffix(definition)}.svg`;
    if (type === "weapon") return `rss/svg/icn_weapon_${this.getWeaponIconSuffix(definition)}.svg`;
    return "rss/svg/icn_equip_n.svg";
  }

  getWeaponIconSuffix(definition = null) {
    if (!definition) return "n";
    const values = {
      ki: Number(definition.damage_kinetic) || 0,
      th: Number(definition.damage_thermal) || 0,
      en: Number(definition.damage_energy) || 0,
      be: Number(definition.damage_beta) || 0
    };
    return this.maxPositiveKey(values) || "n";
  }

  getShieldIconSuffix(definition = null) {
    if (!definition) return "n";
    const values = {
      ki: Number(definition.def_bonus_kinetic) || 0,
      th: Number(definition.def_bonus_thermal) || 0,
      en: Number(definition.def_bonus_energy) || 0
    };
    return this.maxPositiveKey(values) || "n";
  }

  maxPositiveKey(values) {
    let bestKey = null;
    let bestValue = 0;
    let tied = false;
    for (const [key, value] of Object.entries(values || {})) {
      if (value === bestValue && value > 0) {
        tied = true;
        continue;
      }
      if (value < bestValue) continue;
      bestKey = key;
      bestValue = value;
      tied = false;
    }
    return bestValue > 0 && !tied ? bestKey : null;
  }

  getEquipmentDefinitionsForType(type) {
    if (type === "weapon") return this.weaponDefinitions || {};
    if (type === "shield") return this.shieldDefinitions || {};
    if (type === "equipment") return this.equipmentDefinitions || {};
    return {};
  }

  setSelectedShipId(shipId) {
    this.selectedShipId = this.shipDefinitions[shipId] ? shipId : this.defaultShipId;
  }

  setCameraOrbitActive(active) {
    const icon = this.elements.bottomNavMainToggleIcon;
    const changed = icon.classList.contains("svg-icon-main-toggle") !== active;

    this.elements.bottomNavMainToggleButton.setAttribute("aria-pressed", active ? "true" : "false");

    if (!changed) return;

    const applyIcon = () => {
      icon.classList.toggle("svg-icon-main-toggle", active);
      icon.classList.toggle("svg-icon-main", !active);
      this.updateBottomNavIconColors([icon]);
    };

    window.clearTimeout(this.cameraIconSwapTimer);
    icon.classList.remove("is-switching-out", "is-switching-in");

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reducedMotion) {
      applyIcon();
      return;
    }

    const swapToken = ++this.cameraIconSwapToken;
    icon.classList.add("is-switching-out");

    this.cameraIconSwapTimer = window.setTimeout(() => {
      if (this.cameraIconSwapToken !== swapToken) return;

      applyIcon();
      icon.classList.remove("is-switching-out");
      void icon.offsetWidth;
      icon.classList.add("is-switching-in");
    }, 90);
  }

  showTouchDpad({ x, y, maxDistance }) {
    const size = maxDistance * 2;
    this.elements.touchDpad.hidden = false;
    this.elements.touchDpad.style.left = `${x}px`;
    this.elements.touchDpad.style.top = `${y}px`;
    this.elements.touchDpad.style.setProperty("--touch-dpad-size", `${size}px`);
    this.updateTouchDpad({ knobX: 0, knobY: 0 });
    requestAnimationFrame(() => this.elements.touchDpad.classList.add("visible"));
  }

  updateTouchDpad({ knobX, knobY }) {
    this.elements.touchDpadKnob.style.setProperty("--touch-dpad-knob-x", `${knobX}px`);
    this.elements.touchDpadKnob.style.setProperty("--touch-dpad-knob-y", `${knobY}px`);
  }

  hideTouchDpad() {
    this.elements.touchDpad.classList.remove("visible");
    this.updateTouchDpad({ knobX: 0, knobY: 0 });
    window.setTimeout(() => {
      if (!this.elements.touchDpad.classList.contains("visible")) {
        this.elements.touchDpad.hidden = true;
      }
    }, 120);
  }

  setSelectedWorldObjectName(name, objectRef = null) {
    this.selectedWorldObjectSummary = objectRef && objectRef.id
      ? {
          id: objectRef.id,
          kind: objectRef.kind
        }
      : null;
    this.elements.selectionName.textContent = name || "UNKNOWN";
    this.elements.selectionSummary.setAttribute("aria-label", `Open scanner detail for ${name || "selected object"}`);
    this.elements.selectionSummary.hidden = false;
  }

  clearSelectedWorldObjectName() {
    this.selectedWorldObjectSummary = null;
    this.elements.selectionSummary.hidden = true;
    this.elements.selectionSummary.removeAttribute("aria-label");
    this.elements.selectionName.textContent = "";
    this.elements.selectionFocusButton.classList.remove("is-active");
    this.elements.selectionFocusButton.hidden = true;
    this.closeSelectionSummaryBubble();
    this.closeStandaloneObjectDetailPopup();
  }

  setTargetCamActive(active) {
    this.elements.selectionFocusButton.classList.toggle("is-active", active);
  }

  setFocusButtonVisible(visible) {
    this.elements.selectionFocusButton.hidden = !visible;
  }

  hideStartScene() {
    this.elements.startScene.classList.add("hidden");
    this._started = true;
    this.applyDockingOverlay();
    if (this._gatheringActive) this.setGatheringState({ active: true });
  }

  showToast(message) {
    this.elements.toast.textContent = message;
    this.elements.toast.classList.add("visible");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.elements.toast.classList.remove("visible"), 1800);
  }

  showErrorToast(message) {
    this.errorToastQueue.push(message);
    if (!this.errorToastActive) this.showNextErrorToast();
  }

  showNextErrorToast() {
    const nextMessage = this.errorToastQueue.shift();
    if (!nextMessage) {
      this.errorToastActive = false;
      this.elements.errorToast.classList.remove("visible");
      this.elements.errorToast.hidden = true;
      this.elements.errorToast.textContent = "";
      return;
    }

    this.errorToastActive = true;
    this.elements.errorToast.textContent = nextMessage;
    this.elements.errorToast.hidden = false;
    requestAnimationFrame(() => this.elements.errorToast.classList.add("visible"));
  }

  dismissErrorToast() {
    this.elements.errorToast.classList.remove("visible");
    window.setTimeout(() => this.showNextErrorToast(), 180);
  }

  // Lazily build the docking overlay (local presentational screen): station name + undock button.
  // Appended inside the HUD layer so the start/ready scene (which sits above the HUD) covers it.
  ensureDockingUi() {
    if (this.dockingUi) return this.dockingUi;
    const hud = document.querySelector(".hud");

    const overlay = document.createElement("div");
    overlay.id = "dockingOverlay";
    overlay.className = "docking-overlay";
    overlay.hidden = true;
    overlay.style.cssText = "position:fixed;inset:0;display:none;pointer-events:none;";

    const title = document.createElement("div");
    title.className = "docking-station-name";
    title.style.cssText = "position:absolute;top:24px;left:0;right:0;text-align:center;font-size:18px;letter-spacing:0.08em;color:#cfe6ff;text-shadow:0 1px 4px rgba(0,0,0,0.6);pointer-events:none;";

    const undockButton = document.createElement("button");
    undockButton.type = "button";
    undockButton.id = "undockButton";
    undockButton.className = "docking-undock-button";
    undockButton.setAttribute("aria-label", "출항하기");
    undockButton.title = "출항하기";
    const undockIcon = document.createElement("img");
    undockIcon.className = "docking-undock-icon";
    undockIcon.src = "rss/svg/ui_undock.svg";
    undockIcon.alt = "";
    undockIcon.setAttribute("aria-hidden", "true");
    undockButton.append(undockIcon);
    undockButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (this.onUndock) this.onUndock();
    });

    overlay.append(title, undockButton);
    (hud || document.body).append(overlay);

    this.dockingUi = { overlay, title, undockButton, hud, speedControl: document.querySelector("#speedControl") };
    return this.dockingUi;
  }

  // The undock overlay only shows once the game has started (start scene dismissed),
  // so it never draws over the start/ready scene.
  applyDockingOverlay() {
    const ui = this.ensureDockingUi();
    const show = this._dockingActive && this._started;
    ui.overlay.hidden = !show;
    ui.overlay.style.display = show ? "block" : "none";
    ui.title.textContent = this._dockingActive ? (this._dockingStationName || "") : "";
  }

  setDockingState({ active = false, stationName = "" } = {}) {
    const ui = this.ensureDockingUi();
    this._dockingActive = !!active;
    this._dockingStationName = stationName || "";
    // Hide the movement throttle UI while docked, but keep the burger/bottom-nav visible.
    if (ui.speedControl) ui.speedControl.style.display = active ? "none" : "";
    this.applyDockingOverlay();
  }

  // Bottom-of-screen "stop gathering" button, built to the same spec as the
  // station undock button (className + svg reused).
  ensureGatheringUi() {
    if (this.gatheringUi) return this.gatheringUi;
    const hud = document.querySelector(".hud");

    const overlay = document.createElement("div");
    overlay.id = "gatheringOverlay";
    overlay.className = "docking-overlay gathering-overlay";
    overlay.hidden = true;
    overlay.style.cssText = "position:fixed;inset:0;display:none;pointer-events:none;";

    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.id = "stopGatherButton";
    stopButton.className = "docking-undock-button";
    stopButton.setAttribute("aria-label", "채광 중지");
    stopButton.title = "채광 중지";
    const icon = document.createElement("img");
    icon.className = "docking-undock-icon";
    icon.src = "rss/svg/ui_undock.svg";
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    stopButton.append(icon);
    stopButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (this.onStopGathering) this.onStopGathering();
    });

    overlay.append(stopButton);
    (hud || document.body).append(overlay);

    this.gatheringUi = { overlay, stopButton, hud, speedControl: document.querySelector("#speedControl") };
    return this.gatheringUi;
  }

  setGatheringState({ active = false } = {}) {
    const ui = this.ensureGatheringUi();
    this._gatheringActive = !!active;
    // Hide the movement throttle UI while gathering (movement is locked anyway).
    if (ui.speedControl) ui.speedControl.style.display = active ? "none" : "";
    const show = this._gatheringActive && this._started;
    ui.overlay.hidden = !show;
    ui.overlay.style.display = show ? "block" : "none";
  }

  ensureFadeOverlay() {
    if (this._fadeOverlay) return this._fadeOverlay;
    const overlay = document.createElement("div");
    overlay.id = "sceneFadeOverlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:200;pointer-events:none;opacity:0;background:#000;";
    document.body.append(overlay);
    this._fadeOverlay = overlay;
    return overlay;
  }

  // Fade the screen TO a solid color over durationMs (covers a scene transition).
  fadeOut(color = "#000000", durationMs = 2000) {
    const overlay = this.ensureFadeOverlay();
    overlay.style.background = color;
    overlay.style.transition = "none";
    overlay.style.opacity = "0";
    void overlay.offsetHeight; // force reflow so the opacity transition runs from 0
    overlay.style.transition = `opacity ${durationMs}ms linear`;
    overlay.style.opacity = "1";
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  // Fade the solid color back out, revealing the scene, over durationMs.
  fadeIn(durationMs = 2000) {
    const overlay = this.ensureFadeOverlay();
    overlay.style.transition = `opacity ${durationMs}ms linear`;
    overlay.style.opacity = "0";
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  setBetaSpaceState({
    active = false,
    remainingMs = 0,
    outOfBoundsRemainingMs = null,
    gameOverAssumed = false
  } = {}) {
    this.elements.betaSpaceHud.hidden = !active;
    this.elements.betaSpaceHud.classList.toggle("visible", active);
    this.elements.betaSpaceHud.classList.toggle("out-of-bounds", active && outOfBoundsRemainingMs !== null);
    this.elements.betaSpaceHud.classList.toggle("game-over-assumed", active && gameOverAssumed);
    if (!active) {
      this.elements.betaSpaceTimeValue.textContent = "00:00";
      this.elements.betaSpaceBoundaryValue.hidden = true;
      this.elements.betaSpaceBoundaryValue.textContent = "";
      return;
    }

    this.elements.betaSpaceTimeValue.textContent = this.formatBetaSpaceDuration(remainingMs);
    if (gameOverAssumed) {
      this.elements.betaSpaceBoundaryValue.hidden = false;
      this.elements.betaSpaceBoundaryValue.textContent = "GAME OVER FLAG";
    } else if (outOfBoundsRemainingMs !== null) {
      this.elements.betaSpaceBoundaryValue.hidden = false;
      this.elements.betaSpaceBoundaryValue.textContent = `BOUNDARY ${this.formatBetaSpaceDuration(outOfBoundsRemainingMs)}`;
    } else {
      this.elements.betaSpaceBoundaryValue.hidden = true;
      this.elements.betaSpaceBoundaryValue.textContent = "";
    }
  }

  formatBetaSpaceDuration(ms) {
    const totalSeconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value) => String(value).padStart(2, "0");
    return hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  }

  updateHud(snapshot) {
    const speed = snapshot.speed;
    const zeroPercent = this.speedToGaugePercent(0);
    const currentPercent = this.speedToGaugePercent(speed);
    const targetPercent = this.speedToGaugePercent(snapshot.desiredSpeed);
    const fillStart = Math.min(zeroPercent, currentPercent);
    const fillWidth = Math.abs(currentPercent - zeroPercent);

    this.elements.speedValue.textContent = `${this.formatSignedSpeed(speed)} / ${this.formatSignedSpeed(snapshot.desiredSpeed)}`;
    this.elements.speedGaugeFill.style.left = `${fillStart}%`;
    this.elements.speedGaugeFill.style.width = `${fillWidth}%`;
    this.elements.speedGaugeFill.classList.toggle("is-negative", speed < 0);
    this.elements.speedZeroMark.style.left = `${zeroPercent}%`;
    this.elements.speedTargetMark.style.left = `${targetPercent}%`;
    this.elements.speedGauge.setAttribute("aria-valuenow", snapshot.desiredSpeed.toFixed(1));
    this.elements.speedGauge.setAttribute("aria-valuetext", this.formatSignedSpeed(snapshot.desiredSpeed));
    this.navActive = snapshot.autopilot;
    this.elements.targetForm.classList.toggle("nav-active", snapshot.autopilot);
    this.elements.navToggle.textContent = snapshot.autopilot ? "Nav On" : "Nav Off";
    this.elements.navToggle.setAttribute("aria-pressed", snapshot.autopilot ? "true" : "false");
    this.elements.navToggle.title = snapshot.autopilot
      ? "Disable autopilot navigation"
      : "Enable autopilot navigation";

    const hp = snapshot.hyperdrivePhase;
    this.warpPending = hp !== null && hp !== undefined && hp !== "warping";
    this.warpActive = hp === "warping";
    this.elements.targetForm.classList.toggle("warp-pending", this.warpPending);
    this.elements.targetForm.classList.toggle("warp-active", this.warpActive);
    if (this.warpActive) {
      this.elements.warpToggle.textContent = this.t("ui.nav.hyperdriving", "Hyperdriving");
      this.elements.warpToggle.disabled = true;
      this.elements.warpToggle.setAttribute("aria-pressed", "true");
      this.elements.warpToggle.title = this.t("ui.nav.hyperdriveLocked", "Hyperdrive engaged — cannot cancel");
    } else if (this.warpPending) {
      this.elements.warpToggle.textContent = this.t("ui.nav.hyperdriveOn", "Hyperdrive On");
      this.elements.warpToggle.disabled = false;
      this.elements.warpToggle.setAttribute("aria-pressed", "true");
      this.elements.warpToggle.title = this.t("ui.nav.hyperdriveCancelHint", "Cancel hyperdrive");
    } else {
      this.elements.warpToggle.textContent = this.t("ui.nav.hyperdrive", "Hyperdrive");
      this.elements.warpToggle.disabled = false;
      this.elements.warpToggle.setAttribute("aria-pressed", "false");
      this.elements.warpToggle.title = this.t("ui.nav.hyperdriveHint", "Engage hyperdrive");
    }

    this.updateWarpHud({
      phase: snapshot.hyperdrivePhase,
      cooldownStartAt: snapshot.cooldownStartAt,
      jumpStartAt: snapshot.jumpStartAt,
      elapsed: snapshot.hyperdriveElapsed,
      duration: snapshot.hyperdriveDuration
    });
  }

  initWarpHud() {
    this._warpHudOuterValue = 0;
    this._warpHudCurrentValue = 0;
    this.applyWarpHudMorph(0);
    this.setWarpHudOuterValue(0, { text: "0", instant: true });
    this.setWarpHudCurrentValue(0);
  }

  updateWarpHud({ phase, cooldownStartAt, jumpStartAt, elapsed, duration }) {
    const cooldownActive = phase === "cooldown" && cooldownStartAt && jumpStartAt;
    const warpActive = phase === "warping" &&
      Number.isFinite(elapsed) &&
      Number.isFinite(duration) &&
      duration > 0;
    const previousMode = this._warpHudMode;

    if (cooldownActive) {
      const total = Math.max(0.001, (jumpStartAt - cooldownStartAt) / 1000);
      const cooldownElapsed = (Date.now() - cooldownStartAt) / 1000;
      const progress = this.clamp01(cooldownElapsed / total);
      const remaining = Math.max(0, total - cooldownElapsed);
      const text = this.formatWarpHudRemaining(remaining);

      this.showWarpHud();
      this._warpHudMode = "cooldown";
      this.setWarpHudOuterValue(progress * 100, { text });
      this.setWarpHudCurrentValue(0);
      this.elements.warpHud.setAttribute("aria-label", `Hyperdrive cooldown: ${this.formatWarpHudRemainingLabel(remaining)}`);
      return;
    }

    if (warpActive) {
      const progress = this.clamp01(elapsed / duration);
      const remaining = Math.max(0, duration - elapsed);
      const text = this.formatWarpHudRemaining(remaining);

      this.showWarpHud();
      this._warpHudMode = "warping";
      this.setWarpHudOuterValue(100, { text });
      this.setWarpHudCurrentValue(progress * 100);
      this.elements.warpHud.setAttribute("aria-label", `Hyperdrive: ${this.formatWarpHudRemainingLabel(remaining)}`);
      return;
    }

    if (this._warpHudCompleteTimer || this._warpHudCompleteCleanup) {
      this._warpHudMode = null;
      return;
    }

    this._warpHudMode = null;
    if (previousMode === "warping") {
      this.completeWarpHud();
    } else {
      this.hideWarpHud(previousMode == null);
    }
  }

  showWarpHud() {
    this.cancelWarpHudCompletion();

    const hud = this.elements.warpHud;
    hud.classList.remove("completing");
    hud.setAttribute("aria-hidden", "false");
    hud.classList.add("visible");
  }

  hideWarpHud(instant = false) {
    this.cancelWarpHudCompletion();

    const hud = this.elements.warpHud;
    hud.classList.remove("visible", "completing");
    hud.setAttribute("aria-hidden", "true");
    hud.setAttribute("aria-label", "Hyperdrive status");

    if (instant) {
      this.setWarpHudOuterValue(0, { text: "0", instant: true });
      this.setWarpHudCurrentValue(0);
    }
  }

  completeWarpHud() {
    const hud = this.elements.warpHud;
    this.cancelWarpHudCompletion();
    const completeToken = ++this._warpHudCompleteToken;

    this.setWarpHudOuterValue(100, { text: "0", instant: true });
    this.setWarpHudCurrentValue(100);
    hud.setAttribute("aria-hidden", "true");
    hud.setAttribute("aria-label", "Hyperdrive complete");
    hud.classList.add("visible");
    hud.classList.remove("completing");
    void hud.offsetWidth;
    hud.classList.add("completing");

    const finishCompletion = () => {
      if (completeToken !== this._warpHudCompleteToken) return;
      if (this._warpHudCompleteTimer) {
        window.clearTimeout(this._warpHudCompleteTimer);
        this._warpHudCompleteTimer = null;
      }
      if (this._warpHudCompleteCleanup) {
        this._warpHudCompleteCleanup();
        this._warpHudCompleteCleanup = null;
      }
      hud.classList.remove("visible", "completing");
      hud.setAttribute("aria-label", "Hyperdrive status");
      this.setWarpHudOuterValue(0, { text: "0", instant: true });
      this.setWarpHudCurrentValue(0);
    };

    const onAnimationEnd = (event) => {
      if (event.animationName !== "warp-hud-complete") return;
      finishCompletion();
    };

    hud.addEventListener("animationend", onAnimationEnd);
    this._warpHudCompleteCleanup = () => hud.removeEventListener("animationend", onAnimationEnd);
    this._warpHudCompleteTimer = window.setTimeout(finishCompletion, WARP_HUD_COMPLETE_DURATION + 120);
  }

  cancelWarpHudCompletion() {
    this._warpHudCompleteToken += 1;
    if (this._warpHudCompleteTimer) {
      window.clearTimeout(this._warpHudCompleteTimer);
      this._warpHudCompleteTimer = null;
    }
    if (this._warpHudCompleteCleanup) {
      this._warpHudCompleteCleanup();
      this._warpHudCompleteCleanup = null;
    }
  }

  setWarpHudOuterValue(value, { text = null, instant = false } = {}) {
    const blueValue = this.clamp100(value);
    this._warpHudOuterValue = blueValue;
    if (text !== null) this.elements.warpHudValue.textContent = text;
    this.renderWarpHudGauge();
    this.setWarpHudMorphTarget(blueValue >= 100 ? 1 : 0, instant);
  }

  setWarpHudCurrentValue(value) {
    this._warpHudCurrentValue = this.clamp100(value);
    this.renderWarpHudGauge();
  }

  setWarpHudMorphTarget(target, instant = false) {
    const nextTarget = this.clamp01(target);
    this._warpHudMorphTarget = nextTarget;

    if (instant) {
      if (this._warpHudMorphFrameId) {
        window.cancelAnimationFrame(this._warpHudMorphFrameId);
        this._warpHudMorphFrameId = 0;
      }
      this._warpHudMorph = nextTarget;
      this._warpHudMorphLastTs = null;
      this.applyWarpHudMorph(this._warpHudMorph);
      return;
    }

    this.renderWarpHudGauge();
    this.startWarpHudMorph();
  }

  startWarpHudMorph() {
    if (this._warpHudMorphFrameId || this._warpHudMorph === this._warpHudMorphTarget) return;

    this._warpHudMorphLastTs = null;
    this._warpHudMorphFrameId = window.requestAnimationFrame((timestamp) => this.animateWarpHudMorph(timestamp));
  }

  animateWarpHudMorph(timestamp) {
    if (this._warpHudMorphLastTs == null) this._warpHudMorphLastTs = timestamp;

    const delta = timestamp - this._warpHudMorphLastTs;
    const direction = this._warpHudMorphTarget > this._warpHudMorph ? 1 : -1;
    this._warpHudMorphLastTs = timestamp;
    this._warpHudMorph += (delta / WARP_HUD_MORPH_DURATION) * direction;

    if (
      (direction > 0 && this._warpHudMorph >= this._warpHudMorphTarget) ||
      (direction < 0 && this._warpHudMorph <= this._warpHudMorphTarget)
    ) {
      this._warpHudMorph = this._warpHudMorphTarget;
      this.applyWarpHudMorph(this._warpHudMorph);
      this._warpHudMorphFrameId = 0;
      this._warpHudMorphLastTs = null;
      return;
    }

    this.applyWarpHudMorph(this._warpHudMorph);
    this._warpHudMorphFrameId = window.requestAnimationFrame((nextTimestamp) => this.animateWarpHudMorph(nextTimestamp));
  }

  applyWarpHudMorph(value) {
    const mergeT = this.easeInOut(this.clamp01(value / 0.55));
    const gauge = this.elements.warpHudGauge;

    gauge.style.setProperty("--warp-hud-value-size", mergeT > 0.001 ? "1.35vh" : "1.45vh");
    gauge.style.setProperty(
      "--warp-hud-fill-inner-current",
      mergeT > 0.001 ? "var(--warp-hud-fill-outer)" : "var(--warp-hud-fill-inner)"
    );
    gauge.style.setProperty(
      "--warp-hud-blue-fill-opacity",
      mergeT > 0.001 ? "0.2" : "1"
    );

    this.renderWarpHudGauge();
  }

  renderWarpHudGauge() {
    const renderSignature = [
      this._warpHudOuterValue.toFixed(3),
      this._warpHudCurrentValue.toFixed(3),
      this._warpHudMorph.toFixed(3)
    ].join("|");
    if (renderSignature === this._warpHudRenderSignature) return;
    this._warpHudRenderSignature = renderSignature;

    const mergeT = this.easeInOut(this.clamp01(this._warpHudMorph / 0.55));
    const currentFade = this.clamp01((this._warpHudMorph - 0.25) / 0.2);
    const slotAngle = 360 / WARP_HUD_BLOCK_COUNT;
    const gap = this.lerp(WARP_HUD_BASE_GAP_ANGLE, WARP_HUD_MERGED_GAP_ANGLE, mergeT);
    const blockAngle = Math.max(0.001, slotAngle - gap);
    const outerR = this.lerp(WARP_HUD_BASE_OUTER_R, WARP_HUD_BASE_OUTER_R - WARP_HUD_MORPH_INSET, mergeT);
    const innerR = outerR - WARP_HUD_RING_THICKNESS;
    const fillAngle = this.clamp100(this._warpHudOuterValue) * 3.6;
    const { warpHudTrackSegments, warpHudFillSegments, warpHudCurrentArc, warpHudCurrentDot } = this.elements;

    this.clearWarpHudChildren(warpHudTrackSegments);
    this.clearWarpHudChildren(warpHudFillSegments);

    for (let i = 0; i < WARP_HUD_BLOCK_COUNT; i += 1) {
      const startAngle = i * slotAngle + gap / 2;
      const endAngle = startAngle + blockAngle;

      warpHudTrackSegments.appendChild(
        this.createWarpHudSegment("track", startAngle, endAngle, outerR, innerR)
      );

      if (startAngle < fillAngle) {
        const clippedEndAngle = Math.min(endAngle, fillAngle);

        if (clippedEndAngle > startAngle) {
          warpHudFillSegments.appendChild(
            this.createWarpHudSegment("fill", startAngle, clippedEndAngle, outerR, innerR)
          );
        }
      }
    }

    const currentRadius = this.lerp(WARP_HUD_CURRENT_BASE_R, WARP_HUD_CURRENT_MORPH_R, currentFade);
    const hasCurrentValue = this._warpHudCurrentValue > 0;
    const currentSweepAngle = hasCurrentValue ? this._warpHudCurrentValue * 3.6 : 0;

    warpHudCurrentArc.setAttribute("d", this.describeWarpHudCurrentArc(currentRadius, currentSweepAngle));
    warpHudCurrentArc.style.opacity = hasCurrentValue ? currentFade.toFixed(3) : "0";

    const dotPoint = this.warpHudPolarToCartesian(50, 50, currentRadius, 0);
    warpHudCurrentDot.setAttribute("cx", dotPoint.x.toFixed(3));
    warpHudCurrentDot.setAttribute("cy", dotPoint.y.toFixed(3));
    warpHudCurrentDot.setAttribute("r", WARP_HUD_CURRENT_DOT_R.toFixed(3));
    warpHudCurrentDot.style.opacity = hasCurrentValue ? "0" : currentFade.toFixed(3);
  }

  clearWarpHudChildren(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  createWarpHudSegment(className, startAngle, endAngle, outerR, innerR) {
    const path = document.createElementNS(WARP_HUD_SVG_NS, "path");
    path.setAttribute("class", `warp-hud-segment ${className}`);
    path.setAttribute("d", this.describeWarpHudDonutSegment(startAngle, endAngle, outerR, innerR));
    return path;
  }

  describeWarpHudDonutSegment(startAngle, endAngle, outerR, innerR) {
    const cx = 50;
    const cy = 50;
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
    const outerStart = this.warpHudPolarToCartesian(cx, cy, outerR, startAngle);
    const outerEnd = this.warpHudPolarToCartesian(cx, cy, outerR, endAngle);
    const innerEnd = this.warpHudPolarToCartesian(cx, cy, innerR, endAngle);
    const innerStart = this.warpHudPolarToCartesian(cx, cy, innerR, startAngle);

    return [
      `M ${outerStart.x.toFixed(3)} ${outerStart.y.toFixed(3)}`,
      `A ${outerR.toFixed(3)} ${outerR.toFixed(3)} 0 ${largeArcFlag} 1 ${outerEnd.x.toFixed(3)} ${outerEnd.y.toFixed(3)}`,
      `L ${innerEnd.x.toFixed(3)} ${innerEnd.y.toFixed(3)}`,
      `A ${innerR.toFixed(3)} ${innerR.toFixed(3)} 0 ${largeArcFlag} 0 ${innerStart.x.toFixed(3)} ${innerStart.y.toFixed(3)}`,
      "Z"
    ].join(" ");
  }

  describeWarpHudCurrentArc(radius, sweepAngle) {
    const cx = 50;
    const cy = 50;
    const sweep = Math.max(0, Math.min(360, sweepAngle));

    if (sweep <= 0) return "";

    if (sweep >= 359.999) {
      const p0 = this.warpHudPolarToCartesian(cx, cy, radius, 0);
      const p180 = this.warpHudPolarToCartesian(cx, cy, radius, 180);
      const p360 = this.warpHudPolarToCartesian(cx, cy, radius, 359.999);

      return [
        `M ${p0.x.toFixed(3)} ${p0.y.toFixed(3)}`,
        `A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 0 1 ${p180.x.toFixed(3)} ${p180.y.toFixed(3)}`,
        `A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 0 1 ${p360.x.toFixed(3)} ${p360.y.toFixed(3)}`
      ].join(" ");
    }

    const start = this.warpHudPolarToCartesian(cx, cy, radius, 0);
    const end = this.warpHudPolarToCartesian(cx, cy, radius, sweep);
    const largeArcFlag = sweep > 180 ? 1 : 0;

    return [
      `M ${start.x.toFixed(3)} ${start.y.toFixed(3)}`,
      `A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArcFlag} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`
    ].join(" ");
  }

  warpHudPolarToCartesian(cx, cy, radius, angleDeg) {
    const angleRad = (angleDeg - 90) * Math.PI / 180;

    return {
      x: cx + radius * Math.cos(angleRad),
      y: cy + radius * Math.sin(angleRad)
    };
  }

  clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  clamp100(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }

  easeInOut(t) {
    return t < 0.5
      ? 2 * t * t
      : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  formatWarpHudRemaining(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const days = Math.floor(safeSeconds / WARP_HUD_DAY_SECONDS);
    if (days > 0) return `${days}D`;
    return String(Math.ceil(safeSeconds));
  }

  formatWarpHudRemainingLabel(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const days = Math.floor(safeSeconds / WARP_HUD_DAY_SECONDS);
    if (days > 0) return `${days} day${days === 1 ? "" : "s"} remaining`;
    const wholeSeconds = Math.ceil(safeSeconds);
    return `${wholeSeconds} second${wholeSeconds === 1 ? "" : "s"} remaining`;
  }

  refreshSpeedGaugeRange() {
    this.elements.speedGauge.setAttribute("aria-valuemin", String(this.shipStats.minSpeed));
    this.elements.speedGauge.setAttribute("aria-valuemax", String(this.shipStats.maxSpeed));
  }

  speedToGaugePercent(value) {
    const clamped = Math.max(this.shipStats.minSpeed, Math.min(this.shipStats.maxSpeed, value));
    if (clamped < 0) {
      return this.mapLinear(clamped, this.shipStats.minSpeed, 0, 0, this.config.reverseGaugePercent);
    }

    return this.mapLinear(clamped, 0, this.shipStats.maxSpeed, this.config.reverseGaugePercent, 100);
  }

  gaugePercentToSpeed(percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    if (clamped < this.config.reverseGaugePercent) {
      return this.mapLinear(clamped, 0, this.config.reverseGaugePercent, this.shipStats.minSpeed, 0);
    }

    return this.mapLinear(clamped, this.config.reverseGaugePercent, 100, 0, this.shipStats.maxSpeed);
  }

  getSpeedFromPointer(event) {
    const rect = this.elements.speedGauge.getBoundingClientRect();
    const style = getComputedStyle(this.elements.speedGauge);
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;
    const trackLeft = rect.left + borderLeft;
    const trackWidth = Math.max(1, rect.width - borderLeft - borderRight);
    const percent = ((event.clientX - trackLeft) / trackWidth) * 100;
    return this.gaugePercentToSpeed(percent);
  }

  setSpeedFromPointer(event) {
    if (!this.onSetSpeed) return;
    this.onSetSpeed(this.getSpeedFromPointer(event));
  }

  onSpeedPointerDown(event) {
    if (!this.onSetSpeed) return;
    if (this.speedPointerId !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    this.speedPointerId = event.pointerId;
    this.elements.speedControl.classList.add("is-dragging");
    this.elements.speedControl.setPointerCapture(event.pointerId);
    this.setSpeedFromPointer(event);
  }

  onSpeedPointerMove(event) {
    if (this.speedPointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    this.setSpeedFromPointer(event);
  }

  onSpeedPointerEnd(event) {
    if (this.speedPointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    this.speedPointerId = null;
    this.elements.speedControl.classList.remove("is-dragging");
    if (this.elements.speedControl.hasPointerCapture(event.pointerId)) {
      this.elements.speedControl.releasePointerCapture(event.pointerId);
    }
  }

  onSpeedKeyDown(event) {
    if (!this.onSetSpeed) return;

    const current = Number(this.elements.speedGauge.getAttribute("aria-valuenow")) || 0;
    const smallStep = event.shiftKey ? 5 : 1;
    const largeStep = event.shiftKey ? 20 : 10;
    let nextSpeed = null;

    if (event.code === "ArrowLeft" || event.code === "ArrowDown") nextSpeed = current - smallStep;
    if (event.code === "ArrowRight" || event.code === "ArrowUp") nextSpeed = current + smallStep;
    if (event.code === "PageDown") nextSpeed = current - largeStep;
    if (event.code === "PageUp") nextSpeed = current + largeStep;
    if (event.code === "Home") nextSpeed = this.shipStats.minSpeed;
    if (event.code === "End") nextSpeed = this.shipStats.maxSpeed;

    if (nextSpeed === null) return;

    event.preventDefault();
    event.stopPropagation();
    this.onSetSpeed(nextSpeed);
  }

  mapLinear(value, inMin, inMax, outMin, outMax) {
    return outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);
  }

  formatSignedSpeed(value) {
    const fixed = value.toFixed(1);
    return value > 0 ? `${fixed}` : fixed;
  }

  formatVector(vector, digits) {
    return `${vector.x.toFixed(digits)}, ${vector.y.toFixed(digits)}, ${vector.z.toFixed(digits)}`;
  }

  formatPosition(position) {
    return `${Math.round(position.x)}, ${Math.round(position.y)}, ${Math.round(position.z)}`;
  }

  formatListPosition(position) {
    const compact = (value) => String(Math.round(value)).slice(0, 2);
    return `${compact(position.x)} / ${compact(position.y)} / ${compact(position.z)}`;
  }

  formatKeyCode(code) {
    const labels = {
      ArrowUp: "Arrow Up",
      ArrowDown: "Arrow Down",
      ArrowLeft: "Arrow Left",
      ArrowRight: "Arrow Right",
      PageUp: "Page Up",
      PageDown: "Page Down",
      Home: "Home",
      End: "End",
      Space: "Space",
      Escape: "Esc",
      Backquote: "`",
      Minus: "-",
      Equal: "=",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/"
    };

    if (labels[code]) return labels[code];
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
    return code.replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  dispose() {
    clearTimeout(this.toastTimer);
    this.cancelWarpHudCompletion();
    if (this._warpHudMorphFrameId) {
      window.cancelAnimationFrame(this._warpHudMorphFrameId);
      this._warpHudMorphFrameId = 0;
    }
    window.clearTimeout(this.cameraIconSwapTimer);
    this.cancelLoadingProgressAnimation();
    window.removeEventListener("keydown", this.boundBindingKeyDown, true);
    document.removeEventListener("pointerdown", this.boundSelectionSummaryGlobalPointerDown, true);
    this.closeSelectionSummaryBubble();
    this.closeStandaloneObjectDetailPopup();
    this.closeShipInfoPopup();
    this.closeFittingSimulator();
  }
}
