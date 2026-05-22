export class UIManager {
  constructor({ config, keyBindings, keyBindingGroups, defaultKeyBindings }) {
    this.config = config;
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
    this.cameraIconSwapTimer = 0;
    this.cameraIconSwapToken = 0;
    this.selectedObjectListTargetId = null;
    this.renderedObjectList = [];
    this.objectListPayload = { buildings: [], resources: [] };
    this.objectListCategory = "resources";
    this.objectListSort = {
      buildings: "sector",
      resources: "sector"
    };
    this.onKeyBindingsChange = null;
    this.onRequestObjectList = null;
    this.onNavigateToWorldObject = null;
    this.boundBindingKeyDown = (event) => this.onBindingKeyDown(event);
    this.elements = {
      startScene: this.getElement("#startScene"),
      startGateScene: this.getElement("#startGateScene"),
      startReadyScene: this.getElement("#startReadyScene"),
      startButton: this.getElement("#startButton"),
      settingsButton: this.getElement("#settingsButton"),
      settingsPopup: this.getElement("#settingsPopup"),
      settingsCloseButton: this.getElement("#settingsCloseButton"),
      settingsResetButton: this.getElement("#settingsResetButton"),
      settingsKeysTab: this.getElement("#settingsKeysTab"),
      settingsDataTab: this.getElement("#settingsDataTab"),
      settingsKeysPanel: this.getElement("#settingsKeysPanel"),
      settingsDataPanel: this.getElement("#settingsDataPanel"),
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
      chunkBoundsAllButton: this.getElement("#chunkBoundsAllButton"),
      chunkBoundsSectorButton: this.getElement("#chunkBoundsSectorButton"),
      chunkBoundsOffButton: this.getElement("#chunkBoundsOffButton"),
      navRestoreFixedButton: this.getElement("#navRestoreFixedButton"),
      navRestoreInfiniteButton: this.getElement("#navRestoreInfiniteButton"),
      navRestoreCapRow: this.getElement("#navRestoreCapRow"),
      navRestoreCapInput: this.getElement("#navRestoreCapInput"),
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
    this.settingsTab = "keys";
    this.chunkBoundsMode = "all";
    this.navRestoreMode = "fixed";
    this.speedPointerId = null;
    this.onSetSpeed = null;
    this.elements.speedGauge.setAttribute("aria-valuemin", String(this.config.minSpeed));
    this.elements.speedGauge.setAttribute("aria-valuemax", String(this.config.maxSpeed));
    this.setStartButtonText("Start");
    this.renderKeyBindings();
  }

  getElement(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
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
    onChunkBoundsModeChange,
    onNavRestoreModeChange,
    onNavRestoreCapChange,
    onRequestObjectList,
    onNavigateToWorldObject,
    onToggleCameraMode
  }) {
    this.onSetSpeed = onSetSpeed;
    this.onKeyBindingsChange = onKeyBindingsChange;
    this.onRequestObjectList = typeof onRequestObjectList === "function" ? onRequestObjectList : null;
    this.onNavigateToWorldObject = typeof onNavigateToWorldObject === "function" ? onNavigateToWorldObject : null;

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
    this.elements.settingsCloseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeSettings();
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
    this.elements.settingsResetButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.pendingBindingAction = null;
      this.setKeyBindings(this.defaultKeyBindings);
    });
    this.elements.worldRegenerateButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (confirm("Regenerate world data?")) onRegenerateWorld();
    });
    this.elements.dataClearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (confirm("Clear all stored data? (world, player, navigation)")) onClearAllData();
    });
    this.elements.worldReloadButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onReloadWorldData();
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
    [
      this.elements.navRestoreFixedButton,
      this.elements.navRestoreInfiniteButton
    ].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onNavRestoreModeChange(button.dataset.navRestoreMode);
      });
    });
    this.elements.navRestoreCapInput.addEventListener("change", (event) => {
      const val = parseFloat(event.target.value);
      if (Number.isFinite(val) && val >= 0) onNavRestoreCapChange(val);
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

  async openObjectList() {
    this.objectListReturnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
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
      const payload = this.onRequestObjectList ? await this.onRequestObjectList() : { buildings: [], resources: [] };
      this.renderObjectList(payload || { buildings: [], resources: [] });
    } catch {
      this.renderObjectList({ buildings: [], resources: [] });
      this.showErrorToast("scanner unavailable");
    }

    try {
      this.elements.objectListCloseButton.focus({ preventScroll: true });
    } catch {
      this.elements.objectListCloseButton.focus();
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

  renderObjectList({ buildings = [], resources = [] }) {
    this.objectListPayload = { buildings, resources };
    this.renderObjectListCategory();
  }

  renderObjectListCategory() {
    const category = this.objectListCategory === "buildings" ? "buildings" : "resources";
    const items = this.getSortedObjectListItems(category);
    this.renderedObjectList = items;
    this.selectedObjectListTargetId = null;
    this.elements.objectListContent.replaceChildren();
    this.closeObjectListTransient();

    this.elements.objectListCategoryCurrent.textContent = category === "buildings" ? "Buildings" : "Resources";
    this.renderObjectListSortControls(items.length);

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "object-list-empty";
      empty.textContent = "No objects detected";
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

    const name = document.createElement("div");
    name.className = "object-row-name";
    name.textContent = category === "buildings" ? item.name : item.typeLabel;

    main.append(name);

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

    const row = target?.closest("[data-object-id]");
    if (!row) return;

    event.preventDefault();
    event.stopPropagation();
    this.selectObjectListItem(row.dataset.objectId);
  }

  selectObjectListItem(objectId) {
    const object = this.findRenderedObject(objectId);
    if (!object) return;

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
    if (!wrapper) return;

    const bubble = this.createObjectBubble(object);
    this.elements.objectListPanel.append(bubble);
    this.positionObjectBubble(bubble, row);
  }

  createObjectBubble(object) {
    const bubble = document.createElement("div");
    bubble.className = "object-detail-bubble";
    bubble.dataset.objectBubbleId = object.id;

    const detail = document.createElement("button");
    detail.className = "object-bubble-button";
    detail.type = "button";
    detail.dataset.objectDetailId = object.id;
    detail.textContent = "Detail";

    const nav = document.createElement("button");
    nav.className = "object-bubble-button object-navigate-button";
    nav.type = "button";
    nav.dataset.objectNavId = object.id;
    nav.textContent = "Auto Navigate";

    bubble.append(detail, nav);
    return bubble;
  }

  openObjectDetailPopup(object) {
    this.closeObjectDetailPopup();

    const popup = document.createElement("section");
    popup.className = "object-detail-popup";
    popup.dataset.objectDetailPopupId = object.id;
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "Object detail");

    const header = document.createElement("header");
    header.className = "object-detail-popup-header";

    const title = document.createElement("h3");
    title.className = "object-detail-popup-title";
    title.textContent = object.kind === "building" ? object.name : object.typeLabel;

    const close = document.createElement("button");
    close.className = "object-detail-popup-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close detail");
    close.innerHTML = '<span class="svg-icon svg-icon-close" aria-hidden="true"></span>';
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeObjectDetailPopup();
    });

    header.append(title, close);

    const lines = [
      this.createObjectBubbleLine("Category", object.kind),
      this.createObjectBubbleLine("Sector", object.sectorName),
      this.createObjectBubbleLine("Chunk", object.chunkId || "UNKNOWN"),
      this.createObjectBubbleLine("Position", this.formatPosition(object.position)),
      this.createObjectBubbleLine(
        "Chunk Relative",
        object.relativePosition ? this.formatPosition(object.relativePosition) : "unavailable"
      ),
      this.createObjectBubbleLine("Distance", object.distanceText || "unknown")
    ];

    if (object.kind === "resource") {
      lines.splice(1, 0, this.createObjectBubbleLine("Type", object.typeLabel));
      lines.splice(2, 0, this.createObjectBubbleLine("Amount", object.amountLabel));
    } else {
      lines.splice(1, 0, this.createObjectBubbleLine("Name", object.name));
      lines.splice(2, 0, this.createObjectBubbleLine("Status", object.statusLabel));
      lines.splice(3, 0, this.createObjectBubbleLine("HP", object.hpLabel));
    }

    const nav = document.createElement("button");
    nav.className = "object-navigate-button";
    nav.type = "button";
    nav.dataset.objectNavId = object.id;
    nav.textContent = "Auto Navigate";

    popup.append(header, ...lines, nav);
    this.elements.objectListPanel.append(popup);
    try {
      close.focus({ preventScroll: true });
    } catch {
      close.focus();
    }
  }

  closeObjectDetailPopup() {
    this.elements.objectListPanel.querySelectorAll(".object-detail-popup").forEach((popup) => popup.remove());
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

  setObjectListCategory(category) {
    this.objectListCategory = category === "buildings" ? "buildings" : "resources";
    this.closeObjectDetailPopup();
    this.renderObjectListCategory();
  }

  stepObjectListCategory(step) {
    const categories = ["resources", "buildings"];
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
    return category === "buildings"
      ? [
          { id: "sector", label: "Sector" },
          { id: "name", label: "Name" },
          { id: "status", label: "Status" },
          { id: "x", label: "X" },
          { id: "y", label: "Y" },
          { id: "z", label: "Z" }
        ]
      : [
          { id: "sector", label: "Sector" },
          { id: "type", label: "Type" },
          { id: "amount", label: "Amount" },
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
    this.elements.settingsPopup.removeAttribute("inert");
    this.elements.settingsPopup.classList.add("open");
    this.elements.settingsPopup.setAttribute("aria-hidden", "false");
    this.cancelBindingCapture();
    this.setSettingsTab(this.settingsTab);
    try {
      this.elements.settingsCloseButton.focus({ preventScroll: true });
    } catch {
      this.elements.settingsCloseButton.focus();
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
    this.cancelBindingCapture();
  }

  setSettingsTab(tab) {
    this.settingsTab = tab === "data" ? "data" : "keys";
    const dataActive = this.settingsTab === "data";
    this.elements.settingsKeysTab.classList.toggle("active", !dataActive);
    this.elements.settingsDataTab.classList.toggle("active", dataActive);
    this.elements.settingsKeysTab.setAttribute("aria-selected", dataActive ? "false" : "true");
    this.elements.settingsDataTab.setAttribute("aria-selected", dataActive ? "true" : "false");
    this.elements.settingsKeysPanel.classList.toggle("active", !dataActive);
    this.elements.settingsDataPanel.classList.toggle("active", dataActive);
    this.elements.settingsResetButton.hidden = dataActive;
    if (dataActive) this.cancelBindingCapture();
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
    this.elements.worldCurrentSectorValue.textContent = summary.currentSector?.name || "UNKNOWN";
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
  }

  setNavRestoreMode(mode) {
    this.navRestoreMode = mode === "infinite" ? "infinite" : "fixed";
    [this.elements.navRestoreFixedButton, this.elements.navRestoreInfiniteButton].forEach((btn) => {
      const active = btn.dataset.navRestoreMode === this.navRestoreMode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    this.elements.navRestoreCapRow.hidden = this.navRestoreMode === "infinite";
  }

  setNavRestoreCap(minutes) {
    this.elements.navRestoreCapInput.value = String(minutes);
  }

  setCameraOrbitActive(active) {
    const icon = this.elements.bottomNavMainToggleIcon;
    const changed = icon.classList.contains("svg-icon-main-toggle") !== active;

    this.elements.bottomNavMainToggleButton.setAttribute("aria-pressed", active ? "true" : "false");

    if (!changed) return;

    const applyIcon = () => {
      icon.classList.toggle("svg-icon-main-toggle", active);
      icon.classList.toggle("svg-icon-main", !active);
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

  speedToGaugePercent(value) {
    const clamped = Math.max(this.config.minSpeed, Math.min(this.config.maxSpeed, value));
    if (clamped < 0) {
      return this.mapLinear(clamped, this.config.minSpeed, 0, 0, this.config.reverseGaugePercent);
    }

    return this.mapLinear(clamped, 0, this.config.maxSpeed, this.config.reverseGaugePercent, 100);
  }

  gaugePercentToSpeed(percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    if (clamped < this.config.reverseGaugePercent) {
      return this.mapLinear(clamped, 0, this.config.reverseGaugePercent, this.config.minSpeed, 0);
    }

    return this.mapLinear(clamped, this.config.reverseGaugePercent, 100, 0, this.config.maxSpeed);
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
    try {
      this.elements.speedGauge.focus({ preventScroll: true });
    } catch {
      this.elements.speedGauge.focus();
    }
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
    if (event.code === "Home") nextSpeed = this.config.minSpeed;
    if (event.code === "End") nextSpeed = this.config.maxSpeed;

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
  }
}
