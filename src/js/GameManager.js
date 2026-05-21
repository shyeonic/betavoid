import * as THREE from "three";
import { CONFIG, CONTROL_SETTINGS, DEFAULT_KEY_BINDINGS, KEY_BINDING_GROUPS } from "./config.js";
import { ResourceManager } from "./ResourceManager.js";
import { SoundManager } from "./SoundManager.js";
import { UIManager } from "./UIManager.js";

export class GameManager {
  constructor({ root }) {
    this.root = root;
    this.config = CONFIG;
    this.keyBindingStorageKey = "void-zero-key-bindings";
    this.keyBindings = this.loadKeyBindings();
    this.keyToAction = this.createKeyToAction(this.keyBindings);
    this.state = {
      phase: "standby",
      speed: 0,
      desiredSpeed: 0,
      target: null,
      autopilot: false,
      cameraFxAmount: 0,
      speedTrend: 0
    };

    this.activeActions = new Set();
    this.clock = new THREE.Clock();
    this.ui = new UIManager({
      config: this.config,
      keyBindings: this.keyBindings,
      keyBindingGroups: KEY_BINDING_GROUPS,
      defaultKeyBindings: DEFAULT_KEY_BINDINGS
    });
    this.resourceManager = new ResourceManager({
      onChange: (snapshot) => this.ui.setResourceProgress(snapshot)
    });
    this.soundManager = new SoundManager(this.resourceManager);

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
      lastX: 0,
      lastY: 0
    };

    this.starLayers = [];
    this.loadingStarted = false;
    this.starting = false;
    this.disposed = false;
    this.animationFrameId = null;
    this.boundEvents = null;
  }

  async init() {
    this.setupRenderer();
    this.setupScene();
    this.setupWorld();
    this.setupTargetMarker();
    this.setupEvents();
    this.ui.bindControls({
      onPrepare: () => this.prepareStartSequence(),
      onStart: () => this.startGame(),
      onNavigate: (coords) => this.setTarget(coords),
      onCancelNavigate: () => this.clearTarget("navigation stopped"),
      onSetSpeed: (speed) => this.setManualSpeed(speed),
      onKeyBindingsChange: (bindings) => this.setKeyBindings(bindings)
    });

    this.ui.setInteractionGate();
    this.updateCameraProjection();
    this.resetInitialCamera();
    this.animate();
  }

  loadKeyBindings() {
    try {
      const savedBindings = JSON.parse(localStorage.getItem(this.keyBindingStorageKey));
      return this.normalizeKeyBindings(savedBindings);
    } catch {
      return { ...DEFAULT_KEY_BINDINGS };
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
      pointerup: (event) => this.stopCameraDrag(event),
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
      detail: "validating ship and BGM",
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

    await Promise.allSettled([shipTask, audioTask]);
    if (this.disposed) return;
    await this.waitForMinimumLoadingTime(loadingStartedAt);
    if (this.disposed) return;

    this.state.phase = "ready";
    this.ui.setReady({ warnings });
    warnings.forEach((message) => this.ui.showErrorToast(message));
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

    const audioStarted = await this.soundManager.enterGame();
    if (this.disposed) return;
    if (!audioStarted) {
      this.ui.showErrorToast("BGM unavailable");
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
    this.ui.showToast("cam: follow");
  }

  enterOrbitCameraMode() {
    const modeChanged = this.cameraControl.followShip || this.cameraControl.returningToFollow;
    if (this.cameraControl.followShip || this.cameraControl.returningToFollow) {
      this.updateShipCenter();
      this.vectors.cameraLocalOffset.copy(this.camera.position).sub(this.vectors.shipCenter);
      if (this.vectors.cameraLocalOffset.lengthSq() > 0.000001) {
        this.cameraControl.orbitDistance = this.vectors.cameraLocalOffset.length();
        this.lookMatrix.lookAt(this.camera.position, this.vectors.shipCenter, this.axes.y);
        this.quaternions.cameraOrbitTarget.setFromRotationMatrix(this.lookMatrix).normalize();
      } else {
        this.cameraControl.orbitDistance = this.getFollowCameraRadius();
        this.quaternions.cameraOrbitTarget.identity();
      }
    }

    this.cameraControl.followShip = false;
    this.cameraControl.returningToFollow = false;
    this.state.cameraFxAmount = 0;
    this.vectors.cameraActionOffset.set(0, 0, 0);
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

  updateShipCenter() {
    this.vectors.shipCenter.copy(this.ship.position);
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
    this.state.target = new THREE.Vector3(x, y, z);
    this.state.autopilot = true;
    this.targetMarker.visible = true;
    this.targetMarker.position.copy(this.state.target);
    this.ui.showToast("navigation engaged");
  }

  clearTarget(message) {
    this.state.autopilot = false;
    this.state.target = null;
    this.targetMarker.visible = false;
    if (message) this.ui.showToast(message);
  }

  cancelAutopilot() {
    if (!this.state.autopilot) return;
    this.state.autopilot = false;
  }

  updateThrottleTarget(dt) {
    if (this.state.autopilot) return;

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

    if (this.activeActions.has("pitchUp")) pitch += this.config.pitchRate * dt * pitchDirection;
    if (this.activeActions.has("pitchDown")) pitch -= this.config.pitchRate * dt * pitchDirection;
    if (this.activeActions.has("yawLeft")) yaw += this.config.yawRate * dt;
    if (this.activeActions.has("yawRight")) yaw -= this.config.yawRate * dt;
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
    if (!this.state.autopilot || !this.state.target) return;

    this.vectors.targetVec.copy(this.state.target).sub(this.ship.position);
    const distance = this.vectors.targetVec.length();

    if (distance <= this.config.arrivalRadius) {
      this.state.autopilot = false;
      this.setSpeed(0);
      return;
    }

    const direction = this.vectors.targetVec.normalize();
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion);
    this.lookMatrix.lookAt(new THREE.Vector3(0, 0, 0), direction, this.vectors.up);
    this.quaternions.desired.setFromRotationMatrix(this.lookMatrix);
    this.ship.quaternion.slerp(this.quaternions.desired, Math.min(1, this.config.autopilotTurnRate * dt)).normalize();

    const cruise = THREE.MathUtils.clamp(distance * 0.04, 18, 72);
    this.setSpeed(cruise);
  }

  updatePosition(dt) {
    this.ship.getWorldDirection(this.vectors.forward).normalize();
    this.vectors.right.set(1, 0, 0).applyQuaternion(this.ship.quaternion).normalize();
    this.vectors.up.set(0, 1, 0).applyQuaternion(this.ship.quaternion).normalize();

    this.vectors.movement.set(0, 0, 0);
    this.vectors.movement.addScaledVector(this.vectors.forward, this.state.speed * dt);

    if (!this.state.autopilot) {
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

    if (!this.state.autopilot) {
      const pitchActionDirection = CONTROL_SETTINGS.arrowPitchNormal ? 1 : -1;
      if (this.activeActions.has("yawLeft")) this.vectors.cameraActionTarget.x += this.config.cameraYawOffset;
      if (this.activeActions.has("yawRight")) this.vectors.cameraActionTarget.x -= this.config.cameraYawOffset;
      if (this.activeActions.has("pitchUp")) this.vectors.cameraActionTarget.y -= this.config.cameraPitchOffset * pitchActionDirection;
      if (this.activeActions.has("pitchDown")) this.vectors.cameraActionTarget.y += this.config.cameraPitchOffset * pitchActionDirection;
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

  updateHud() {
    this.ship.getWorldDirection(this.vectors.forward).normalize();
    this.ui.updateHud({
      phase: this.state.phase === "running" ? "Manual" : this.state.phase,
      speed: this.state.speed,
      desiredSpeed: this.state.desiredSpeed,
      position: this.ship.position,
      heading: this.vectors.forward,
      target: this.state.target,
      autopilot: this.state.autopilot
    });
  }

  update(dt) {
    this.updateAutopilot(dt);
    this.updateThrottleTarget(dt);
    this.updateSpeed(dt);
    if (!this.state.autopilot) this.updateManualRotation(dt);
    this.updatePosition(dt);
    this.updateCamera(dt);
    this.updateStars();
  }

  animate() {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state.phase === "running") {
      this.update(dt);
    }

    this.updateTargetMarker(dt);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  onPointerDown(event) {
    if (this.state.phase !== "running") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    this.cameraControl.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.renderer.domElement.setPointerCapture(event.pointerId);

    if (this.cameraControl.pointers.size >= 2) {
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

    if (!this.cameraControl.dragging || this.cameraControl.pointerId !== event.pointerId) return;
    event.preventDefault();

    const dx = event.clientX - this.cameraControl.lastX;
    const dy = event.clientY - this.cameraControl.lastY;
    this.cameraControl.lastX = event.clientX;
    this.cameraControl.lastY = event.clientY;

    if (dx === 0 && dy === 0) return;

    this.vectors.cameraUp.set(0, 1, 0).applyQuaternion(this.quaternions.cameraOrbitTarget);
    const yawSign = this.vectors.cameraUp.dot(this.axes.y) >= 0 ? 1 : -1;

    this.quaternions.cameraOrbitYawDelta.setFromAxisAngle(
      this.axes.y,
      -dx * this.config.cameraOrbitSensitivity * yawSign
    );
    this.quaternions.cameraOrbitPitchDelta.setFromAxisAngle(
      this.axes.x,
      -dy * this.config.cameraOrbitSensitivity
    );
    this.quaternions.cameraOrbitTarget
      .premultiply(this.quaternions.cameraOrbitYawDelta)
      .multiply(this.quaternions.cameraOrbitPitchDelta)
      .normalize();
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

    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  }

  onWheel(event) {
    if (this.state.phase !== "running") return;
    event.preventDefault();
    this.applyCameraZoomDelta(event.deltaY * this.config.cameraZoomSensitivity);
  }

  onKeyDown(event) {
    if (event.target instanceof HTMLInputElement) return;
    if (this.state.phase !== "running") return;

    const action = this.getActionForCode(event.code);
    if (!action) return;

    this.activeActions.add(action);

    if (action === "throttleUp" || action === "throttleDown") {
      event.preventDefault();
    } else if (action === "maxSpeed") {
      event.preventDefault();
      this.setSpeed(this.config.maxSpeed);
    } else if (action === "stopSpeed") {
      event.preventDefault();
      this.setSpeed(0);
    } else if (action === "cameraToggle") {
      event.preventDefault();
      if (!event.repeat) {
        this.toggleCameraMode();
        this.playCameraToggleSfx();
      }
    } else if (this.isManualControlAction(action)) {
      event.preventDefault();
      this.cancelAutopilot();
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
    this.soundManager.dispose();
    this.resourceManager.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
