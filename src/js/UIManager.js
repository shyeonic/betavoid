export class UIManager {
  constructor({ config, shipStats, i18n, keyBindings, keyBindingGroups, defaultKeyBindings }) {
    this.config = config;
    this.shipStats = shipStats;
    this.i18n = i18n || {
      t: (key, params = {}, fallback = key) => fallback,
      resolveDefinitionText: (definition, field = "name", fallback = "") => definition?.[field] || fallback
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
    this.objectListCategory = "resources";
    this.objectListSort = {
      buildings: "sector",
      resources: "sector",
      betaVoids: "sector"
    };
    this.onKeyBindingsChange = null;
    this.onRequestObjectList = null;
    this.onSelectWorldObject = null;
    this.onNavigateToWorldObject = null;
    this.onClearWorldSelection = null;
    this.onEnterTargetCam = null;
    this.onProcessBetaVoid = null;
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
      playerPopup: this.getElement("#playerPopup"),
      playerPopupCloseButton: this.getElement("#playerPopupCloseButton"),
      playerShipGrid: this.getElement("#playerShipGrid"),
      loadingText: this.getElement("#loadingText"),
      loadingBar: this.getElement("#loadingBar"),
      loadingDetail: this.getElement("#loadingDetail"),
      speedControl: this.getElement("#speedControl"),
      speedGauge: this.getElement("#speedGauge"),
      speedValue: this.getElement("#speedValue"),
      speedGaugeFill: this.getElement("#speedGaugeFill"),
      speedZeroMark: this.getElement("#speedZeroMark"),
      speedTargetMark: this.getElement("#speedTargetMark"),
      positionXValue: this.getElement("#positionXValue"),
      positionYValue: this.getElement("#positionYValue"),
      positionZValue: this.getElement("#positionZValue"),
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
    this.settingsTab = "data";
    this.environmentMode = "light";
    this.performanceSettings = {
      materialMaps: true,
      renderResolutionScale: 1,
      bloomQuality: "medium",
      lightingEffects: true,
      antialias: false
    };
    this.chunkBoundsMode = "all";
    this.selectedShipId = "ship_01";
    this.speedPointerId = null;
    this.onSetSpeed = null;
    document.documentElement.lang = this.i18n.locale || document.documentElement.lang;
    this.elements.speedGauge.setAttribute("aria-valuemin", String(this.shipStats.minSpeed));
    this.elements.speedGauge.setAttribute("aria-valuemax", String(this.shipStats.maxSpeed));
    this.renderStaticText();
    this.renderLanguageSettings();
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
    onProcessBetaVoid,
    onToggleCameraMode
  }) {
    this.onSetSpeed = onSetSpeed;
    this.onKeyBindingsChange = onKeyBindingsChange;
    this.onRequestObjectList = typeof onRequestObjectList === "function" ? onRequestObjectList : null;
    this.onSelectWorldObject = typeof onSelectWorldObject === "function" ? onSelectWorldObject : null;
    this.onNavigateToWorldObject = typeof onNavigateToWorldObject === "function" ? onNavigateToWorldObject : null;
    this.onClearWorldSelection = typeof onClearWorldSelection === "function" ? onClearWorldSelection : null;
    this.onEnterTargetCam = typeof onEnterTargetCam === "function" ? onEnterTargetCam : null;
    this.onProcessBetaVoid = typeof onProcessBetaVoid === "function" ? onProcessBetaVoid : null;

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
    this.elements.playerPopupCloseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closePlayerPopup();
    });
    this.elements.playerPopup.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === this.elements.playerPopup) {
        this.closePlayerPopup();
        return;
      }
      const card = event.target instanceof Element ? event.target.closest("[data-ship-id]") : null;
      if (card instanceof HTMLElement && typeof onShipSelect === "function") {
        event.preventDefault();
        onShipSelect(card.dataset.shipId);
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
      this.openTargetPopup();
    });
    this.elements.readout.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      event.stopPropagation();
      this.openTargetPopup();
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

      const processButton = target?.closest("[data-beta-void-process-id]");
      if (processButton) {
        event.preventDefault();
        const object = this.findRenderedObject(processButton.dataset.betaVoidProcessId);
        if (!object || !this.onProcessBetaVoid) return;

        this.onProcessBetaVoid(object);
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

    const processButton = target?.closest("[data-beta-void-process-id]");
    if (processButton) {
      event.preventDefault();
      event.stopPropagation();
      const object = this.findRenderedObject(processButton.dataset.betaVoidProcessId);
      if (!object || !this.onProcessBetaVoid) return;

      this.onProcessBetaVoid(object);
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

    if (includeSelect) bubble.append(select);
    bubble.append(detail, nav);
    return bubble;
  }

  openObjectDetailPopup(object) {
    this.closeObjectDetailPopup();
    this.elements.objectListPanel.querySelectorAll(".object-detail-bubble").forEach((bubble) => bubble.remove());

    const popup = this.createObjectDetailPopupElement(object, () => this.closeObjectDetailPopup());
    this.elements.objectListPanel.append(popup);
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

    const actions = [nav];
    if (object.kind === "betaVoid" && object.status === "active") {
      const process = document.createElement("button");
      process.className = "object-navigate-button";
      process.type = "button";
      process.dataset.betaVoidProcessId = object.id;
      process.textContent = "Process";
      actions.push(process);
    }

    popup.append(header, ...lines, ...actions);
    return popup;
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
      }
    });

    document.body.append(bubble);
    this.positionSelectionSummaryBubble(bubble);
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
      const processButton = target?.closest("[data-beta-void-process-id]");
      if (!navButton && !processButton) return;

      event.preventDefault();
      event.stopPropagation();
      if (navButton && this.onNavigateToWorldObject) this.onNavigateToWorldObject(object);
      if (processButton && this.onProcessBetaVoid) this.onProcessBetaVoid(object);
      this.closeStandaloneObjectDetailPopup();
    });

    document.body.append(popup);
    this.focusObjectDetailPopup(popup);
  }

  closeSelectionSummaryBubble() {
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
    const color = getComputedStyle(document.documentElement).getPropertyValue("--ui_color").trim() || "#6975A0";
    Array.from(icons).forEach((icon) => {
      if (icon instanceof HTMLElement) {
        void this.applyBottomNavIconColor(icon, color);
      }
    });
  }

  async applyBottomNavIconColor(icon, color) {
    const sourceUrl = this.getSvgIconSourceUrl(icon);
    if (!sourceUrl) return;
    icon.dataset.svgTintSource = sourceUrl;
    icon.dataset.svgTintColor = color;

    const cacheKey = `${sourceUrl}|${color}`;
    let imageValue = this.bottomNavIconDataCache.get(cacheKey);
    if (!imageValue) {
      let svg = this.bottomNavIconSourceCache.get(sourceUrl);
      if (!svg) {
        const response = await fetch(sourceUrl);
        if (!response.ok) return;
        svg = await response.text();
        this.bottomNavIconSourceCache.set(sourceUrl, svg);
      }

      const tintedSvg = svg.replace(/#6975a0/gi, color);
      imageValue = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(tintedSvg)}")`;
      this.bottomNavIconDataCache.set(cacheKey, imageValue);
    }

    if (icon.dataset.svgTintSource === sourceUrl && icon.dataset.svgTintColor === color) {
      icon.style.setProperty("--bottom-nav-icon-image", imageValue);
    }
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

  setSelectedShipId(shipId) {
    this.selectedShipId = shipId;
    this.elements.playerShipGrid.querySelectorAll("[data-ship-id]").forEach((card) => {
      card.classList.toggle("active", card.dataset.shipId === shipId);
      card.setAttribute("aria-pressed", card.dataset.shipId === shipId ? "true" : "false");
    });
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
    this.elements.positionXValue.textContent = snapshot.position.x.toFixed(0);
    this.elements.positionYValue.textContent = snapshot.position.y.toFixed(0);
    this.elements.positionZValue.textContent = snapshot.position.z.toFixed(0);

    this.navActive = snapshot.autopilot;
    this.elements.targetForm.classList.toggle("nav-active", snapshot.autopilot);
    this.elements.navToggle.textContent = snapshot.autopilot ? "Nav On" : "Nav Off";
    this.elements.navToggle.setAttribute("aria-pressed", snapshot.autopilot ? "true" : "false");
    this.elements.navToggle.title = snapshot.autopilot
      ? "Disable autopilot navigation"
      : "Enable autopilot navigation";
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
    window.clearTimeout(this.cameraIconSwapTimer);
    this.cancelLoadingProgressAnimation();
    window.removeEventListener("keydown", this.boundBindingKeyDown, true);
    document.removeEventListener("pointerdown", this.boundSelectionSummaryGlobalPointerDown, true);
    this.closeSelectionSummaryBubble();
    this.closeStandaloneObjectDetailPopup();
  }
}
