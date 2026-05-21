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
    this.pendingBindingAction = null;
    this.settingsReturnFocus = null;
    this.targetPopupReturnFocus = null;
    this.onKeyBindingsChange = null;
    this.boundBindingKeyDown = (event) => this.onBindingKeyDown(event);
    this.elements = {
      startScene: this.getElement("#startScene"),
      startButton: this.getElement("#startButton"),
      settingsButton: this.getElement("#settingsButton"),
      settingsPopup: this.getElement("#settingsPopup"),
      settingsCloseButton: this.getElement("#settingsCloseButton"),
      settingsResetButton: this.getElement("#settingsResetButton"),
      keyBindingList: this.getElement("#keyBindingList"),
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
      readout: this.getElement(".readout"),
      targetPopupBackdrop: this.getElement("#targetPopupBackdrop"),
      targetForm: this.getElement("#targetForm"),
      targetX: this.getElement("#targetX"),
      targetY: this.getElement("#targetY"),
      targetZ: this.getElement("#targetZ"),
      navToggle: this.getElement("#navToggle"),
      toast: this.getElement("#toast"),
      errorToast: this.getElement("#errorToast")
    };
    this.navActive = false;
    this.speedPointerId = null;
    this.onSetSpeed = null;
    this.elements.speedGauge.setAttribute("aria-valuemin", String(this.config.minSpeed));
    this.elements.speedGauge.setAttribute("aria-valuemax", String(this.config.maxSpeed));
    this.renderKeyBindings();
  }

  getElement(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }

  bindControls({ onPrepare, onStart, onNavigate, onCancelNavigate, onSetSpeed, onKeyBindingsChange }) {
    this.onSetSpeed = onSetSpeed;
    this.onKeyBindingsChange = onKeyBindingsChange;

    this.elements.startScene.addEventListener("click", (event) => {
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
    this.elements.settingsResetButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.pendingBindingAction = null;
      this.setKeyBindings(this.defaultKeyBindings);
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

  openSettings() {
    this.settingsReturnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : this.elements.settingsButton;
    this.elements.settingsPopup.removeAttribute("inert");
    this.elements.settingsPopup.classList.add("open");
    this.elements.settingsPopup.setAttribute("aria-hidden", "false");
    this.cancelBindingCapture();
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

  setInteractionGate() {
    this.startStage = "standby";
    this.elements.startScene.classList.remove("loading", "ready");
    this.elements.startScene.classList.add("standby");
    this.elements.loadingText.textContent = "Standby";
    this.elements.loadingDetail.textContent = "click anywhere";
    this.elements.loadingBar.style.width = "0%";
    this.elements.startButton.disabled = true;
    this.elements.startButton.textContent = "Start";
  }

  setLoadingState({ message, detail = "", progress = 0, canStart = false }) {
    this.startStage = "loading";
    this.elements.startScene.classList.add("loading");
    this.elements.startScene.classList.remove("standby", "ready");
    this.elements.loadingText.textContent = message;
    this.elements.loadingDetail.textContent = detail;
    this.elements.loadingBar.style.width = `${Math.round(progress * 100)}%`;
    this.elements.startButton.disabled = !canStart;
    this.elements.startButton.textContent = canStart ? "Start" : "Loading";
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
    this.elements.startScene.classList.remove("loading");
    this.elements.startScene.classList.add("ready");
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
    window.removeEventListener("keydown", this.boundBindingKeyDown, true);
  }
}
