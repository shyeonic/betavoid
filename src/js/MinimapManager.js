import * as THREE from "three";
import { SPACE_ENVIRONMENT_PRESETS } from "./definitions/environmentDefinitions.js";

// non-product-test-and-sample/minimap-final-test.html 의 카메라/줌/페이드 상세값을 그대로 따른다.
const GALAXY_SCALE = 4.8;
const SECTOR_MAP_SIZE = 150;
const MAP_FRAME_PADDING = 1.08;
const ISO_POLAR_ANGLE = Math.acos(1 / Math.sqrt(3));
const ISO_DEFAULT_AZIMUTH = Math.PI / 4;
const ISO_DRAG_ROTATION_SPEED = 0.006;
const ENTER_SECTOR_ZOOM = { from: 1, to: 7, duration: 460 };
const RETURN_CLUSTER_ZOOM = { from: 1, to: 0.3, duration: 350 };
const MAP_FADE_OUT_DURATION = 240;
const MAP_FADE_IN_DURATION = 300;
const WHEEL_NAV_COOLDOWN = 1000;
const FIT_DURATION_GALAXY = 920;
const FIT_DURATION_CLUSTER = 880;
const FIT_DURATION_SECTOR = 960;
const FIT_DURATION_VIEW_SWITCH = 520;

export class MinimapManager {
  constructor({
    gameData,
    worldDataManager,
    i18n,
    getShipDataPosition,
    getEnvironmentMode,
    onVisibilityChange = null,
    onSelectObject = null,
    onShowObjectDetail = null
  }) {
    this.gameData = gameData;
    this.worldDataManager = worldDataManager;
    this.i18n = i18n;
    this.getShipDataPosition = typeof getShipDataPosition === "function" ? getShipDataPosition : () => null;
    this.getEnvironmentMode = typeof getEnvironmentMode === "function" ? getEnvironmentMode : () => "light";
    this.onVisibilityChange = typeof onVisibilityChange === "function" ? onVisibilityChange : null;
    this.onSelectObject = typeof onSelectObject === "function" ? onSelectObject : null;
    this.onShowObjectDetail = typeof onShowObjectDetail === "function" ? onShowObjectDetail : null;

    this.elements = {
      popup: this.getElement("#minimapPopup"),
      panel: this.getElement("#minimapPopup .minimap-panel"),
      closeButton: this.getElement("#minimapCloseButton"),
      stage: this.getElement("#minimapStage"),
      canvas: this.getElement("#minimapCanvas"),
      backButton: this.getElement("#minimapBackButton"),
      modeLabel: this.getElement("#minimapModeLabel"),
      viewStrip: this.getElement("#minimapViewStrip"),
      objectToast: this.getElement("#minimapObjectToast"),
      toastName: this.getElement("#minimapToastName"),
      toastSelectButton: this.getElement("#minimapToastSelectButton"),
      toastDetailButton: this.getElement("#minimapToastDetailButton")
    };

    this.isOpen = false;
    this.disposed = false;
    this.returnFocus = null;
    this.rendererReady = false;
    this.animationFrameId = null;
    this.resizeObserver = null;

    this.state = {
      mode: "galaxy",
      view: "iso",
      currentClusterId: null,
      currentSectorId: null,
      selected: null,
      hovered: null,
      baseOrthoSize: 180,
      focus: { center: new THREE.Vector3(), radius: 120 }
    };

    this.themeMode = null;
    this.colors = { accent: "#7373ff", text: "#133047", muted: "#537083" };

    this.isoAzimuth = ISO_DEFAULT_AZIMUTH;
    this.cameraTarget = new THREE.Vector3();
    this.cameraAnim = null;
    this.zoomAnim = null;
    this.cameraInitialized = false;
    this.mapTransitioning = false;
    this.isoDrag = null;
    this.suppressNextClick = false;
    this.wheelNavCooldown = false;
    this.resizeQueued = false;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickables = [];
    this.toastObject = null;

    this.svgFetchCache = new Map();
    this.svgTextureCache = new Map();

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2400, 2400);
    this.root = new THREE.Group();
    this.boundsGroup = new THREE.Group();
    this.markerGroup = new THREE.Group();
    this.shipGroup = new THREE.Group();
    this.root.add(this.boundsGroup, this.markerGroup, this.shipGroup);
    this.scene.add(this.root);
    this.renderer = null;
    this.materials = null;
    this.shipMarker = null;

    this.bindUi();
  }

  getElement(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing minimap element: ${selector}`);
    return element;
  }

  t(key, fallback, params = {}) {
    return this.i18n?.t ? this.i18n.t(key, params, fallback) : fallback;
  }

  get snapshot() {
    return this.worldDataManager?.snapshot || null;
  }

  bindUi() {
    this.elements.closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
    this.elements.popup.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === this.elements.popup) this.close();
    });
    this.elements.popup.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (this.toastObject) {
        this.hideObjectToast();
        return;
      }
      this.close();
    });
    this.elements.backButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.navigateBack();
    });
    this.elements.toastSelectButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const payload = this.createSelectionPayload(this.toastObject);
      this.close();
      if (payload && this.onSelectObject) this.onSelectObject(payload);
    });
    this.elements.toastDetailButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const data = this.toastObject;
      if (!data?.id || !this.onShowObjectDetail) return;
      this.onShowObjectDetail({
        id: data.id,
        kind: data.kind === "anomaly" ? "betaVoid" : data.kind
      });
    });
    this.elements.viewStrip.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-minimap-view]") : null;
      if (!(button instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      this.elements.viewStrip.querySelectorAll("[data-minimap-view]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      this.state.view = button.dataset.minimapView;
      if (this.state.view === "iso") this.isoAzimuth = ISO_DEFAULT_AZIMUTH;
      this.fitCamera({ duration: FIT_DURATION_VIEW_SWITCH });
    });

    const canvas = this.elements.canvas;
    canvas.addEventListener("pointerdown", (event) => this.onCanvasPointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.onCanvasPointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.onCanvasPointerUp(event));
    canvas.addEventListener("pointercancel", (event) => this.onCanvasPointerUp(event));
    canvas.addEventListener("pointerleave", () => {
      if (this.isoDrag) return;
      this.state.hovered = null;
      this.updateHoverMaterials();
    });
    canvas.addEventListener("click", (event) => this.onCanvasClick(event));
    canvas.addEventListener("wheel", (event) => this.onCanvasWheel(event), { passive: false });
  }

  syncViewStrip() {
    this.elements.viewStrip.querySelectorAll("[data-minimap-view]").forEach((item) => {
      item.classList.toggle("active", item.dataset.minimapView === this.state.view);
    });
  }

  open() {
    if (this.disposed || this.isOpen) return;
    if (!this.snapshot) return;
    this.isOpen = true;

    this.returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;

    this.elements.popup.hidden = false;
    this.elements.popup.removeAttribute("inert");
    this.elements.popup.classList.add("open");
    this.elements.popup.setAttribute("aria-hidden", "false");
    this.onVisibilityChange?.(true);

    this.ensureRenderer();
    this.refreshTheme();
    this.resetTransientState();

    // 항상 기본값으로 시작: ISO 기본 각도 + 함선이 위치한 클러스터 뷰 (없으면 은하 맵)
    this.state.view = "iso";
    this.isoAzimuth = ISO_DEFAULT_AZIMUTH;
    this.syncViewStrip();
    this.cameraInitialized = false;
    this.resizeRenderer();
    const shipClusterId = this.getShipClusterId();
    const shipCluster = this.getEnabledClusters().find((cluster) => cluster.id === shipClusterId);
    if (shipCluster) {
      this.renderCluster(shipCluster.id);
    } else {
      this.renderGalaxy();
    }
    this.startLoop();
    this.observeResize();

    try {
      this.elements.closeButton.focus({ preventScroll: true });
    } catch {
      this.elements.closeButton.focus();
    }
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    this.stopLoop();
    this.unobserveResize();
    this.resetTransientState();

    const activeElement = document.activeElement;
    this.elements.popup.classList.remove("open");
    this.elements.popup.setAttribute("aria-hidden", "true");
    this.elements.popup.setAttribute("inert", "");
    this.elements.popup.hidden = true;
    this.onVisibilityChange?.(false);

    if (activeElement instanceof HTMLElement && this.elements.popup.contains(activeElement)) {
      activeElement.blur();
    }
    if (this.returnFocus instanceof HTMLElement && document.contains(this.returnFocus)) {
      try {
        this.returnFocus.focus({ preventScroll: true });
      } catch {
        this.returnFocus.focus();
      }
    }
    this.returnFocus = null;
  }

  resetTransientState() {
    if (this.cameraAnim?.resolve) this.cameraAnim.resolve(false);
    if (this.zoomAnim?.resolve) this.zoomAnim.resolve(false);
    this.cameraAnim = null;
    this.zoomAnim = null;
    this.camera.zoom = 1;
    this.mapTransitioning = false;
    this.isoDrag = null;
    this.suppressNextClick = false;
    this.wheelNavCooldown = false;
    this.state.hovered = null;
    this.hideObjectToast();
    this.elements.stage.classList.remove("map-fading", "map-transitioning");
  }

  ensureRenderer() {
    if (this.rendererReady) return;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.elements.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.materials = {
      marker: new THREE.MeshBasicMaterial({
        color: this.colors.accent,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        toneMapped: false
      }),
      shipHalo: new THREE.MeshBasicMaterial({
        color: this.colors.accent,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
        toneMapped: false
      })
    };
    this.shipMarker = this.createShipMarker();
    this.shipGroup.add(this.shipMarker);
    this.rendererReady = true;
  }

  createShipMarker() {
    const group = new THREE.Group();
    const halo = new THREE.Mesh(new THREE.SphereGeometry(3.8, 14, 10), this.materials.shipHalo);
    group.add(halo);
    group.userData = { halo };
    group.visible = false;
    return group;
  }

  observeResize() {
    if (this.resizeObserver) return;
    this.resizeObserver = new ResizeObserver(() => this.requestResize());
    this.resizeObserver.observe(this.elements.stage);
  }

  unobserveResize() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  startLoop() {
    if (this.animationFrameId !== null) return;
    const tick = () => {
      this.animationFrameId = requestAnimationFrame(tick);
      this.animate(performance.now());
    };
    this.animationFrameId = requestAnimationFrame(tick);
  }

  stopLoop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // 테마 — object-row-main 의 svg 틴트 색(--ui_target_color)을 그대로 사용한다.
  // ---------------------------------------------------------------------------

  setEnvironmentMode() {
    if (!this.isOpen) return;
    this.refreshTheme();
    this.renderCurrentMap({ instant: true });
  }

  refreshTheme() {
    const mode = this.getEnvironmentMode() === "dark" ? "dark" : "light";
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--ui_target_color").trim() || (mode === "dark" ? "#00ff66" : "#7373ff");
    const text = styles.getPropertyValue("--text").trim() || (mode === "dark" ? "#c4e2f6" : "#133047");
    const muted = styles.getPropertyValue("--muted").trim() || (mode === "dark" ? "#4e7a94" : "#537083");
    this.themeMode = mode;
    this.colors = { accent, text, muted };

    const preset = SPACE_ENVIRONMENT_PRESETS[mode] || SPACE_ENVIRONMENT_PRESETS.light;
    this.scene.background = new THREE.Color(preset.scene.background);

    if (this.materials) {
      this.materials.marker.color.set(accent);
      this.materials.shipHalo.color.set(accent);
    }
  }

  // ---------------------------------------------------------------------------
  // 맵 렌더링
  // ---------------------------------------------------------------------------

  renderCurrentMap({ instant = false } = {}) {
    if (this.state.mode === "sector" && this.state.currentSectorId) {
      this.renderSector(this.state.currentSectorId, { preserveSelection: true, instant });
      return;
    }
    if (this.state.mode === "cluster" && this.state.currentClusterId) {
      this.renderCluster(this.state.currentClusterId, {
        focusSectorId: this.state.currentSectorId,
        instant
      });
      return;
    }
    this.renderGalaxy({ instant });
  }

  renderGalaxy({ instant = false } = {}) {
    this.state.mode = "galaxy";
    this.state.currentClusterId = null;
    this.state.currentSectorId = null;
    this.state.selected = null;
    this.clearMap();
    this.elements.modeLabel.textContent = this.t("ui.map.galaxy", "Galaxy");
    this.elements.backButton.disabled = true;

    for (const cluster of this.getEnabledClusters()) this.addClusterBox(cluster);
    for (const sector of this.getSectors()) this.addSectorMarker(sector);

    this.setFocusFromClusters(this.getEnabledClusters());
    this.fitCamera({ duration: FIT_DURATION_GALAXY, instant });
  }

  renderCluster(clusterId, { focusSectorId = null, instant = false } = {}) {
    const cluster = this.getCluster(clusterId);
    if (!cluster) return;
    this.state.mode = "cluster";
    this.state.currentClusterId = clusterId;
    this.state.currentSectorId = focusSectorId;
    this.state.selected = focusSectorId
      ? { kind: "sector", sectorId: focusSectorId }
      : { kind: "cluster", clusterId };
    this.clearMap();

    this.elements.modeLabel.textContent = cluster.name || clusterId;
    this.elements.backButton.disabled = false;

    this.addClusterBox(cluster, { selected: true, interactive: false });
    for (const sector of this.getSectorsInCluster(clusterId)) this.addSectorMarker(sector);

    const focusSector = focusSectorId ? this.getSector(focusSectorId) : null;
    if (focusSector && this.getClusterIdForSector(focusSector) === clusterId) {
      this.setFocusFromSectorInCluster(cluster, focusSector);
    } else {
      this.setFocusFromClusters([cluster]);
    }
    this.updateHoverMaterials();
    this.fitCamera({ duration: instant ? 0 : FIT_DURATION_CLUSTER, instant });
  }

  renderSector(sectorId, { preserveSelection = false, instant = false } = {}) {
    const sector = this.getSector(sectorId);
    if (!sector) return;
    const previousSelection = preserveSelection ? this.state.selected : null;
    this.state.mode = "sector";
    this.state.currentClusterId = this.getClusterIdForSector(sector) || this.state.currentClusterId;
    this.state.currentSectorId = sectorId;
    this.state.selected = previousSelection?.sectorId === sectorId
      ? previousSelection
      : { kind: "sector", sectorId };
    this.clearMap();

    this.elements.modeLabel.textContent = this.getSectorName(sector);
    this.elements.backButton.disabled = false;

    this.buildSectorBounds();
    this.addSectorInternalObjects(sector);

    this.state.focus = { center: new THREE.Vector3(), radius: 92 };
    this.updateHoverMaterials();
    this.fitCamera({ duration: instant ? 0 : FIT_DURATION_SECTOR, instant });
  }

  clearMap() {
    this.hideObjectToast();
    this.pickables.length = 0;
    this.disposeGroup(this.boundsGroup);
    this.disposeGroup(this.markerGroup);
  }

  addClusterBox(cluster, { selected = false, interactive = true } = {}) {
    const box = this.createGalaxyClusterBox(cluster.bounds, { selected });
    box.line.userData = {
      kind: "cluster",
      clusterId: cluster.id,
      label: cluster.name || cluster.id
    };
    box.pick.userData = box.line.userData;
    this.boundsGroup.add(box.line);
    if (interactive) {
      this.markerGroup.add(box.pick);
      this.pickables.push(box.pick);
    } else {
      this.disposeObject(box.pick);
    }
  }

  addSectorMarker(sector) {
    const group = new THREE.Group();
    const marker = new THREE.Mesh(new THREE.SphereGeometry(1.85, 12, 8), this.materials.marker.clone());
    const pick = new THREE.Mesh(
      new THREE.SphereGeometry(6.2, 16, 10),
      new THREE.MeshBasicMaterial({
        color: this.colors.accent,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false
      })
    );

    group.position.copy(this.galaxyPositionForSector(sector));
    group.userData = {
      kind: "sector",
      sectorId: sector.sector_id,
      label: this.getSectorName(sector)
    };
    marker.userData = group.userData;
    pick.userData = { ...group.userData, pickOnly: true };
    this.pickables.push(pick);
    group.add(marker, pick);
    this.markerGroup.add(group);
  }

  buildSectorBounds() {
    const geometry = new THREE.BoxGeometry(SECTOR_MAP_SIZE, SECTOR_MAP_SIZE, SECTOR_MAP_SIZE);
    const edges = new THREE.EdgesGeometry(geometry);
    geometry.dispose();
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: this.colors.accent,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      toneMapped: false
    }));
    line.userData = { kind: "sector-bounds" };
    this.boundsGroup.add(line);
  }

  addSectorInternalObjects(sector) {
    const snapshot = this.snapshot;
    if (!snapshot) return;

    for (const building of snapshot.buildings.filter((item) => item.sector_id === sector.sector_id)) {
      this.addObjectMarker({
        kind: "building",
        id: building.building_instance_id,
        sectorId: sector.sector_id,
        label: this.buildingLabel(building),
        position: this.sectorLocalPosition(sector, building.position),
        data: building
      });
    }

    for (const resource of snapshot.resourceNodes.filter((item) => item.sector_id === sector.sector_id)) {
      this.addObjectMarker({
        kind: "resource",
        id: resource.resource_instance_id,
        sectorId: sector.sector_id,
        label: this.resourceLabel(resource),
        position: this.sectorLocalPosition(sector, resource.position),
        data: resource
      });
    }

    for (const anomaly of snapshot.betaVoids.filter((item) => item.sector_id === sector.sector_id && item.status === "active")) {
      this.addObjectMarker({
        kind: "anomaly",
        id: anomaly.id,
        sectorId: sector.sector_id,
        label: this.t("betaVoid.name", "Beta Void"),
        position: this.sectorLocalPosition(sector, anomaly.position),
        data: anomaly
      });
    }
  }

  addObjectMarker({ kind, id, sectorId, label, position, data }) {
    const url = this.getObjectIconUrl(kind, data?.building_id);
    const material = new THREE.SpriteMaterial({
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      toneMapped: false,
      color: "#ffffff"
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(9, 9, 1);
    sprite.position.copy(position);
    sprite.userData = { kind, id, sectorId, label, data };
    this.markerGroup.add(sprite);
    this.pickables.push(sprite);
    void this.assignTintedSvgTexture(sprite, url);
  }

  getObjectIconUrl(kind, buildingId) {
    if (kind === "anomaly") return new URL("../rss/svg/ind_void.svg", import.meta.url).href;
    if (kind === "resource") return new URL("../rss/svg/ind_loot.svg", import.meta.url).href;
    if (kind === "building") {
      const size = this.gameData.buildingDefinitions?.[buildingId]?.size || "M";
      if (size === "EX") return new URL("../rss/svg/ind_ex.svg", import.meta.url).href;
      if (size === "L") return new URL("../rss/svg/ind_large.svg", import.meta.url).href;
      if (size === "S") return new URL("../rss/svg/ind_small.svg", import.meta.url).href;
    }
    return new URL("../rss/svg/ind_medium.svg", import.meta.url).href;
  }

  // object-row-main 아이콘과 동일한 틴트 규칙(#6975a0 → --ui_target_color, 다크 모드에서 흰색 → 검정)을 적용한다.
  async assignTintedSvgTexture(sprite, url) {
    const dark = this.themeMode === "dark";
    const color = this.colors.accent;
    const cacheKey = `${url}|${color}|${dark ? "d" : "l"}`;

    let texture = this.svgTextureCache.get(cacheKey);
    if (!texture) {
      try {
        let fetchPromise = this.svgFetchCache.get(url);
        if (!fetchPromise) {
          fetchPromise = fetch(url).then((response) => {
            if (!response.ok) throw new Error(`Failed to load ${url}`);
            return response.text();
          });
          this.svgFetchCache.set(url, fetchPromise);
        }
        const svg = await fetchPromise;
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
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tinted)}`;
        texture = await new Promise((resolve, reject) => {
          new THREE.TextureLoader().load(dataUrl, resolve, undefined, reject);
        });
        texture.colorSpace = THREE.SRGBColorSpace;
        this.svgTextureCache.set(cacheKey, texture);
      } catch {
        return;
      }
    }

    if (sprite.parent && sprite.material) {
      sprite.material.map = texture;
      sprite.material.needsUpdate = true;
    }
  }

  createGalaxyClusterBox(bounds, { selected = false } = {}) {
    const min = bounds?.min;
    const max = bounds?.max;
    if (!Array.isArray(min) || !Array.isArray(max)) {
      return { line: new THREE.Group(), pick: new THREE.Mesh() };
    }
    const mn = this.galaxyPositionFromChunk({ x: min[0], y: min[1], z: min[2] });
    const mx = this.galaxyPositionFromChunk({ x: max[0], y: max[1], z: max[2] });
    const center = mn.clone().add(mx).multiplyScalar(0.5);
    const size = new THREE.Vector3(
      Math.max(1, Math.abs(mx.x - mn.x)),
      Math.max(1, Math.abs(mx.y - mn.y)),
      Math.max(1, Math.abs(mx.z - mn.z))
    );
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: this.colors.accent,
      transparent: true,
      opacity: selected ? 0.44 : 0.22,
      depthWrite: false,
      toneMapped: false
    }));
    line.position.copy(center);

    const pick = new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial({
      color: this.colors.accent,
      transparent: true,
      opacity: 0.02,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    }));
    pick.position.copy(center);
    return { line, pick, center, size };
  }

  // ---------------------------------------------------------------------------
  // 데이터 조회
  // ---------------------------------------------------------------------------

  getSectors() {
    return [...(this.snapshot?.sectors || [])].sort((a, b) => a.sector_id.localeCompare(b.sector_id));
  }

  getSector(sectorId) {
    return this.snapshot?.sectors?.find((sector) => sector.sector_id === sectorId) || null;
  }

  getSectorName(sector) {
    if (!sector) return "";
    return this.i18n?.resolveDefinitionText
      ? this.i18n.resolveDefinitionText(sector, "name", sector.name || sector.sector_id)
      : sector.name || sector.sector_id;
  }

  getEnabledClusters() {
    return Object.values(this.gameData.chunkMap?.clusters || {}).filter((cluster) => cluster.enabled);
  }

  getCluster(clusterId) {
    return this.gameData.chunkMap?.clusters?.[clusterId] || null;
  }

  getClusterIdForSector(sector) {
    if (!sector?.chunk) return null;
    return this.getClusterIdForChunk(sector.chunk);
  }

  getClusterIdForChunk(chunk) {
    const key = `${chunk.x}:${chunk.y}:${chunk.z}`;
    const index = this.gameData.clusterData?.chunkToCluster?.[key];
    return Number.isInteger(index) ? this.gameData.clusterData.clusterIds[index] : null;
  }

  getSectorsInCluster(clusterId) {
    return this.getSectors().filter((sector) => this.getClusterIdForSector(sector) === clusterId);
  }

  getShipClusterId() {
    const position = this.getShipDataPosition();
    if (!position) return null;
    const chunk = this.worldDataManager.getChunkAtPosition(position.x, position.y, position.z);
    return this.getClusterIdForChunk(chunk);
  }

  getShipSector() {
    const position = this.getShipDataPosition();
    if (!position) return null;
    return this.worldDataManager.getSectorAtPosition(position.x, position.y, position.z);
  }

  buildingLabel(building) {
    const definition = this.gameData.buildingDefinitions?.[building.building_id];
    if (definition && this.i18n?.resolveDefinitionText) {
      const resolved = this.i18n.resolveDefinitionText(definition, "name", "");
      if (resolved) return resolved;
    }
    return this.titleFromId(definition?.id || building.building_id);
  }

  resourceLabel(resource) {
    const definition = this.gameData.resourceDefinitions?.[resource.resource_id || resource.type];
    if (definition && this.i18n?.resolveDefinitionText) {
      const resolved = this.i18n.resolveDefinitionText(definition, "name", "");
      if (resolved) return resolved;
    }
    return this.titleFromId(definition?.id || resource.resource_id || "resource");
  }

  titleFromId(id) {
    return String(id || "")
      .split(/[_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  // ---------------------------------------------------------------------------
  // 좌표 변환
  // ---------------------------------------------------------------------------

  galaxyPositionForSector(sector) {
    return this.galaxyPositionFromChunk(sector.chunk);
  }

  galaxyPositionFromChunk(chunk) {
    const { gx, gy, gz } = this.gameData.gmapData;
    return new THREE.Vector3(
      (chunk.x - (gx - 1) / 2) * GALAXY_SCALE,
      (chunk.y - (gy - 1) / 2) * GALAXY_SCALE,
      (chunk.z - (gz - 1) / 2) * GALAXY_SCALE
    );
  }

  shipGalaxyPosition() {
    const position = this.getShipDataPosition();
    if (!position) return null;
    const chunkSize = this.worldDataManager.config.chunkSize;
    return this.galaxyPositionFromChunk({
      x: position.x / chunkSize.x,
      y: position.y / chunkSize.y,
      z: position.z / chunkSize.z
    });
  }

  sectorLocalPosition(sector, position) {
    const bounds = sector.global_bounds;
    const center = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2
    };
    const size = {
      x: Math.abs(bounds.max.x - bounds.min.x),
      y: Math.abs(bounds.max.y - bounds.min.y),
      z: Math.abs(bounds.max.z - bounds.min.z)
    };
    const scale = SECTOR_MAP_SIZE / Math.max(size.x, size.y, size.z, 1);
    return new THREE.Vector3(
      (position.x - center.x) * scale,
      (position.y - center.y) * scale,
      (position.z - center.z) * scale
    );
  }

  isPositionInBounds(position, bounds) {
    return (
      position.x >= bounds.min.x && position.x <= bounds.max.x &&
      position.y >= bounds.min.y && position.y <= bounds.max.y &&
      position.z >= bounds.min.z && position.z <= bounds.max.z
    );
  }

  // ---------------------------------------------------------------------------
  // 함선 실시간 마커
  // ---------------------------------------------------------------------------

  updateShipMarker(now) {
    if (!this.shipMarker) return;

    let target = null;
    if (this.state.mode === "sector") {
      const sector = this.getSector(this.state.currentSectorId);
      const position = this.getShipDataPosition();
      if (sector && position && this.isPositionInBounds(position, sector.global_bounds)) {
        target = this.sectorLocalPosition(sector, position);
      }
    } else {
      target = this.shipGalaxyPosition();
    }

    if (!target) {
      this.shipMarker.visible = false;
      return;
    }

    this.shipMarker.visible = true;
    this.shipMarker.position.copy(target);
    const pulse = 1 + Math.sin(now / 1000 * 4) * 0.16;
    this.shipMarker.userData.halo.scale.setScalar(pulse);
  }

  // ---------------------------------------------------------------------------
  // 입력
  // ---------------------------------------------------------------------------

  onCanvasPointerDown(event) {
    if (event.button !== 0 || this.state.view !== "iso" || this.mapTransitioning) return;
    this.isoDrag = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      moved: false
    };
    this.elements.canvas.setPointerCapture?.(event.pointerId);
  }

  onCanvasPointerMove(event) {
    if (this.isoDrag?.pointerId === event.pointerId) {
      const dx = event.clientX - this.isoDrag.lastX;
      this.isoDrag.lastX = event.clientX;
      if (Math.abs(dx) > 0.25) {
        this.isoDrag.moved = true;
        this.isoAzimuth -= dx * ISO_DRAG_ROTATION_SPEED;
        this.cameraAnim = null;
        this.applyIsoYawToCamera();
        this.state.hovered = null;
      }
      event.preventDefault();
      return;
    }

    const hit = this.pickObject(event);
    this.state.hovered = hit?.object?.userData || null;
    this.updateHoverMaterials();
  }

  onCanvasPointerUp(event) {
    if (this.isoDrag?.pointerId !== event.pointerId) return;
    this.suppressNextClick = this.isoDrag.moved;
    if (this.suppressNextClick) {
      setTimeout(() => {
        this.suppressNextClick = false;
      }, 80);
    }
    this.isoDrag = null;
    this.elements.canvas.releasePointerCapture?.(event.pointerId);
  }

  onCanvasClick(event) {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    const hit = this.pickObject(event);
    if (!hit) {
      this.hideObjectToast();
      return;
    }
    const data = hit.object.userData;
    if (data.kind === "cluster") {
      this.renderCluster(data.clusterId);
      return;
    }
    if (data.kind === "sector") {
      void this.enterSector(data.sectorId);
      return;
    }
    if (["building", "resource", "anomaly"].includes(data.kind)) {
      this.state.selected = data;
      this.updateHoverMaterials();
      this.showObjectToast(data);
    }
  }

  onCanvasWheel(event) {
    event.preventDefault();
    if (this.mapTransitioning || this.wheelNavCooldown) return;

    const zoomIn = event.deltaY < 0;

    if (zoomIn) {
      if (this.state.mode === "galaxy") {
        // 함선이 위치한 클러스터를 우선 진입 대상으로 한다.
        const clusters = this.getEnabledClusters();
        const shipClusterId = this.getShipClusterId();
        const target = clusters.find((cluster) => cluster.id === shipClusterId) || clusters[0];
        if (!target) return;
        this.startWheelNavCooldown();
        this.renderCluster(target.id);
      } else if (this.state.mode === "cluster") {
        const sectors = this.getSectorsInCluster(this.state.currentClusterId);
        const shipSector = this.getShipSector();
        const target = sectors.find((sector) => sector.sector_id === shipSector?.sector_id) || sectors[0];
        if (!target) return;
        this.startWheelNavCooldown();
        void this.enterSector(target.sector_id);
      }
      // sector = 가장 깊은 계층, 줌인 없음
    } else {
      if (this.state.mode === "galaxy") return; // 가장 얕은 계층, 줌아웃 없음
      this.startWheelNavCooldown();
      this.navigateBack();
    }
  }

  startWheelNavCooldown() {
    this.wheelNavCooldown = true;
    setTimeout(() => {
      this.wheelNavCooldown = false;
    }, WHEEL_NAV_COOLDOWN);
  }

  pickObject(event) {
    if (!this.pickables.length) return null;
    const rect = this.elements.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.pickables, false)[0] || null;
  }

  updateHoverMaterials() {
    this.markerGroup.traverse((object) => {
      if ((!object.isMesh && !object.isSprite) || !object.material || !object.userData?.kind) return;
      const data = object.userData;
      if (data.pickOnly) {
        if (object.isMesh) object.material.opacity = 0;
        return;
      }
      const selected = this.state.selected && this.selectionKey(this.state.selected) === this.selectionKey(data);
      const hovered = this.state.hovered && this.selectionKey(this.state.hovered) === this.selectionKey(data);
      if (data.kind === "cluster") {
        object.material.opacity = hovered || selected ? 0.06 : 0.02;
      } else if (object.isSprite) {
        object.material.opacity = selected ? 1 : hovered ? 0.82 : 0.92;
      } else if (selected || hovered) {
        object.material.opacity = selected ? 1 : 0.82;
      } else {
        object.material.opacity = 0.92;
      }
    });
  }

  selectionKey(data) {
    if (!data) return "";
    return `${data.kind}:${data.sectorId || ""}:${data.id || data.sectorId || ""}`;
  }

  // ---------------------------------------------------------------------------
  // 오브젝트 토스트 — 스테이지 하단 고정 위치에서 나타나며 이름 + 선택/상세 버튼을 제공한다.
  // 섹터 맵 전용: 계층 전환 시(clearMap) 트랜지션과 함께 자연스럽게 사라진다.
  // ---------------------------------------------------------------------------

  showObjectToast(data) {
    if (!data?.id) return;
    this.toastObject = data;
    const name = data.label || data.id;
    this.elements.toastName.textContent = name;
    this.elements.toastName.title = name;
    this.elements.objectToast.classList.add("visible");
    this.elements.objectToast.setAttribute("aria-hidden", "false");
  }

  hideObjectToast() {
    if (!this.toastObject && !this.elements.objectToast.classList.contains("visible")) return;
    this.toastObject = null;
    this.elements.objectToast.classList.remove("visible");
    this.elements.objectToast.setAttribute("aria-hidden", "true");
  }

  // 스캐너 리스트 항목(onSelectWorldObject)과 동일하게 동작하도록 선택 페이로드를 구성한다.
  createSelectionPayload(data) {
    if (!data?.id) return null;
    const kind = data.kind === "anomaly" ? "betaVoid" : data.kind;
    const type = kind === "betaVoid"
      ? "beta_void"
      : data.data?.building_id || data.data?.resource_id || data.data?.type || "unknown";
    const position = data.data?.position ? { ...data.data.position } : null;
    return {
      id: data.id,
      kind,
      type,
      name: data.label || data.id,
      position
    };
  }

  // ---------------------------------------------------------------------------
  // 내비게이션 + 줌 전환 (테스트 페이지의 상세값 그대로)
  // ---------------------------------------------------------------------------

  navigateBack() {
    if (this.state.mode === "sector" && this.state.currentClusterId) {
      void this.returnToClusterFromSector(this.state.currentClusterId, this.state.currentSectorId);
      return;
    }
    this.renderGalaxy();
  }

  async enterSector(sectorId) {
    const sector = this.getSector(sectorId);
    if (!sector) return;
    if (!["galaxy", "cluster"].includes(this.state.mode)) {
      this.renderSector(sectorId);
      return;
    }
    if (this.mapTransitioning) return;
    this.mapTransitioning = true;

    this.state.selected = {
      kind: "sector",
      sectorId,
      label: this.getSectorName(sector)
    };
    this.updateHoverMaterials();

    try {
      await this.runZoomAnim(
        ENTER_SECTOR_ZOOM.from,
        ENTER_SECTOR_ZOOM.to,
        ENTER_SECTOR_ZOOM.duration,
        easeInCubic,
        this.galaxyPositionForSector(sector)
      );
      await this.fadeAndSwap(() => this.renderSector(sectorId, { instant: true }));
    } finally {
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
      this.mapTransitioning = false;
    }
  }

  async returnToClusterFromSector(clusterId, sectorId) {
    if (this.mapTransitioning) return;
    this.mapTransitioning = true;

    const sector = this.getSector(sectorId);

    try {
      await this.runZoomAnim(
        RETURN_CLUSTER_ZOOM.from,
        RETURN_CLUSTER_ZOOM.to,
        RETURN_CLUSTER_ZOOM.duration,
        easeOutCubic
      );
      await this.fadeAndSwap(() => this.renderCluster(clusterId, {
        focusSectorId: sector ? sectorId : null,
        instant: true
      }));
    } finally {
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
      this.mapTransitioning = false;
    }
  }

  runZoomAnim(fromZoom, toZoom, duration, easingFn, endTarget = null) {
    if (this.cameraAnim?.resolve) this.cameraAnim.resolve(false);
    this.cameraAnim = null;
    this.zoomAnim = null;
    const startTarget = endTarget ? this.cameraTarget.clone() : null;
    const camDist = this.camera.position.distanceTo(this.cameraTarget);
    return new Promise((resolve) => {
      this.zoomAnim = {
        startTime: performance.now(),
        duration,
        fromZoom,
        toZoom,
        easing: easingFn,
        resolve,
        startTarget,
        endTarget,
        camDist
      };
    });
  }

  setFocusFromSectorInCluster(cluster, sector) {
    const clusterFocus = this.getClusterBoxFocus(cluster.bounds);
    this.state.focus = {
      min: clusterFocus?.min?.clone?.(),
      max: clusterFocus?.max?.clone?.(),
      center: this.galaxyPositionForSector(sector),
      radius: clusterFocus?.radius || 120
    };
  }

  async fadeAndSwap(renderNext) {
    const stage = this.elements.stage;
    stage.classList.add("map-transitioning");
    let faded = false;
    try {
      await this.setMapFaded(true, MAP_FADE_OUT_DURATION);
      faded = true;
      renderNext();
      this.state.hovered = null;
      await nextFrame();
      await this.setMapFaded(false, MAP_FADE_IN_DURATION);
      faded = false;
    } finally {
      if (faded) stage.classList.remove("map-fading");
      stage.classList.remove("map-transitioning");
    }
  }

  setMapFaded(faded, duration) {
    const stage = this.elements.stage;
    const canvas = this.elements.canvas;
    const alreadySet = stage.classList.contains("map-fading") === faded;
    if (alreadySet) return delay(duration);

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        canvas.removeEventListener("transitionend", onTransitionEnd);
        resolve();
      };
      const onTransitionEnd = (event) => {
        if (event.target === canvas && event.propertyName === "opacity") finish();
      };
      const timer = setTimeout(finish, duration + 80);
      canvas.addEventListener("transitionend", onTransitionEnd);
      requestAnimationFrame(() => {
        stage.classList.toggle("map-fading", faded);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 카메라
  // ---------------------------------------------------------------------------

  fitCamera({ duration = 820, instant = false } = {}) {
    const pose = this.getCameraPose({
      view: this.state.view,
      focus: this.state.focus
    });
    return this.animateCameraTo(pose, {
      duration,
      instant: instant || !this.cameraInitialized
    });
  }

  getCameraPose({ view, focus }) {
    const safeFocus = focus || { center: new THREE.Vector3(), radius: 120 };
    const direction = this.getViewDirection(view);
    const frame = this.getStageFrame(safeFocus);
    const baseOrthoSize = this.getFixedOrthoSize(frame, view);
    const distance = Math.max(560, baseOrthoSize * 4.2);
    const center = (safeFocus.min && safeFocus.max)
      ? frame.min.clone().add(frame.max).multiplyScalar(0.5)
      : safeFocus.center.clone();
    return {
      position: center.clone().add(direction.multiplyScalar(distance)),
      target: center,
      baseOrthoSize,
      zoom: 1,
      up: this.getViewUp(view)
    };
  }

  getViewDirection(view) {
    if (view === "top") return new THREE.Vector3(0, 1, 0);
    if (view === "front") return new THREE.Vector3(0, 0, 1);
    if (view === "side") return new THREE.Vector3(1, 0, 0);
    return this.getIsoViewDirection();
  }

  getViewUp(view) {
    if (view === "top") return new THREE.Vector3(0, 0, -1);
    return new THREE.Vector3(0, 1, 0);
  }

  getIsoViewDirection() {
    const horizontal = Math.sin(ISO_POLAR_ANGLE);
    return new THREE.Vector3(
      Math.sin(this.isoAzimuth) * horizontal,
      Math.cos(ISO_POLAR_ANGLE),
      Math.cos(this.isoAzimuth) * horizontal
    ).normalize();
  }

  applyIsoYawToCamera() {
    const target = this.cameraTarget.clone();
    const distance = Math.max(560, this.camera.position.distanceTo(target), this.state.baseOrthoSize * 4.2);
    const direction = this.getIsoViewDirection();
    this.camera.up.copy(this.getViewUp("iso"));
    this.camera.position.copy(target.clone().add(direction.multiplyScalar(distance)));
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.renderer?.render(this.scene, this.camera);
  }

  getStageFrame(focus) {
    if (focus?.min && focus?.max) {
      return {
        min: focus.min.clone(),
        max: focus.max.clone()
      };
    }

    if (this.state.mode === "sector") {
      const half = SECTOR_MAP_SIZE * 0.5;
      return {
        min: new THREE.Vector3(-half, -half, -half),
        max: new THREE.Vector3(half, half, half)
      };
    }

    const center = focus?.center?.clone?.() || new THREE.Vector3();
    const radius = Math.max(1, Number(focus?.radius) || 120);
    return {
      min: center.clone().addScalar(-radius),
      max: center.clone().addScalar(radius)
    };
  }

  getFixedOrthoSize(frame, view) {
    const aspect = this.getStageAspect();
    const basis = this.getViewBasis(view);
    const corners = this.getFrameCorners(frame);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const corner of corners) {
      const x = corner.dot(basis.right);
      const y = corner.dot(basis.up);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return Math.max(height, width / aspect) * MAP_FRAME_PADDING;
  }

  getViewBasis(view) {
    const direction = this.getViewDirection(view).normalize();
    const upHint = this.getViewUp(view).normalize();
    const right = new THREE.Vector3().crossVectors(upHint, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    return { right, up };
  }

  getFrameCorners(frame) {
    const { min, max } = frame;
    return [
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(min.x, min.y, max.z),
      new THREE.Vector3(min.x, max.y, min.z),
      new THREE.Vector3(min.x, max.y, max.z),
      new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(max.x, max.y, min.z),
      new THREE.Vector3(max.x, max.y, max.z)
    ];
  }

  getStageAspect() {
    return Math.max(0.1, (this.elements.stage.clientWidth || 1) / (this.elements.stage.clientHeight || 1));
  }

  animateCameraTo(pose, { duration = 820, instant = false } = {}) {
    if (this.cameraAnim?.resolve) {
      this.cameraAnim.resolve(false);
    }
    if (instant || duration <= 0) {
      this.cameraAnim = null;
      this.applyCameraPose(pose);
      this.cameraInitialized = true;
      return Promise.resolve(true);
    }

    this.cameraInitialized = true;
    return new Promise((resolve) => {
      this.cameraAnim = {
        startTime: performance.now(),
        duration,
        startPosition: this.camera.position.clone(),
        endPosition: pose.position.clone(),
        startTarget: this.cameraTarget.clone(),
        endTarget: pose.target.clone(),
        startBaseOrthoSize: this.state.baseOrthoSize,
        endBaseOrthoSize: pose.baseOrthoSize,
        startZoom: this.camera.zoom,
        endZoom: pose.zoom,
        startUp: this.camera.up.clone(),
        endUp: pose.up.clone(),
        resolve
      };
    });
  }

  applyCameraPose(pose) {
    this.state.baseOrthoSize = pose.baseOrthoSize;
    this.camera.zoom = pose.zoom;
    this.camera.up.copy(pose.up);
    this.camera.position.copy(pose.position);
    this.cameraTarget.copy(pose.target);
    this.camera.lookAt(this.cameraTarget);
    this.resizeRenderer();
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  updateCameraAnimation(now) {
    if (!this.cameraAnim) return;
    const t = Math.min(1, (now - this.cameraAnim.startTime) / this.cameraAnim.duration);
    const eased = easeInOutCubic(t);
    this.camera.position.lerpVectors(this.cameraAnim.startPosition, this.cameraAnim.endPosition, eased);
    this.cameraTarget.lerpVectors(this.cameraAnim.startTarget, this.cameraAnim.endTarget, eased);
    this.camera.up.copy(this.cameraAnim.startUp).lerp(this.cameraAnim.endUp, eased).normalize();
    this.state.baseOrthoSize = lerp(this.cameraAnim.startBaseOrthoSize, this.cameraAnim.endBaseOrthoSize, eased);
    this.camera.zoom = lerp(this.cameraAnim.startZoom, this.cameraAnim.endZoom, eased);
    this.camera.lookAt(this.cameraTarget);
    this.resizeRenderer();
    this.camera.updateProjectionMatrix();
    if (t >= 1) {
      const completed = this.cameraAnim;
      this.cameraAnim = null;
      completed.resolve?.(true);
    }
  }

  setFocusFromClusters(clusters) {
    const boxes = clusters
      .map((cluster) => this.getClusterBoxFocus(cluster.bounds))
      .filter(Boolean);
    if (!boxes.length) {
      this.state.focus = { center: new THREE.Vector3(), radius: 120 };
      return;
    }

    if (boxes.length === 1) {
      this.state.focus = boxes[0];
      return;
    }

    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    boxes.forEach((box) => {
      min.min(box.min);
      max.max(box.max);
    });
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(40, max.clone().sub(min).length() * 0.5);
    this.state.focus = { min, max, center, radius };
  }

  getClusterBoxFocus(bounds) {
    const min = bounds?.min;
    const max = bounds?.max;
    if (!Array.isArray(min) || !Array.isArray(max)) return null;
    const mn = this.galaxyPositionFromChunk({ x: min[0], y: min[1], z: min[2] });
    const mx = this.galaxyPositionFromChunk({ x: max[0], y: max[1], z: max[2] });
    const center = mn.clone().add(mx).multiplyScalar(0.5);
    const radius = Math.max(34, mx.clone().sub(mn).length() * 0.5);
    return { min: mn, max: mx, center, radius };
  }

  requestResize() {
    if (this.resizeQueued || !this.isOpen) return;
    this.resizeQueued = true;
    requestAnimationFrame(() => {
      this.resizeQueued = false;
      if (this.cameraInitialized) {
        this.fitCamera({ instant: true });
      } else {
        this.resizeRenderer();
      }
    });
  }

  resizeRenderer() {
    if (!this.renderer) return;
    const width = this.elements.stage.clientWidth;
    const height = this.elements.stage.clientHeight;
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const ortho = this.state.baseOrthoSize || 180;
    this.camera.left = -ortho * aspect * 0.5;
    this.camera.right = ortho * aspect * 0.5;
    this.camera.top = ortho * 0.5;
    this.camera.bottom = -ortho * 0.5;
    const clipDist = Math.max(2400, ortho * 6.4);
    this.camera.near = -clipDist;
    this.camera.far = clipDist;
    this.camera.updateProjectionMatrix();
  }

  animate(now) {
    if (this.zoomAnim) {
      const t = Math.min(1, (now - this.zoomAnim.startTime) / this.zoomAnim.duration);
      const eased = this.zoomAnim.easing(t);
      const Z = lerp(this.zoomAnim.fromZoom, this.zoomAnim.toZoom, eased);
      this.camera.zoom = Z;
      if (this.zoomAnim.startTarget && this.zoomAnim.endTarget) {
        // T = P + (T0 - P) / Z  →  lerpVectors(P, T0, 1/Z)
        // Z가 pan을 직접 결정: Z가 클수록 T가 P에 수렴 → P가 화면 중앙으로 이동
        this.cameraTarget.lerpVectors(this.zoomAnim.endTarget, this.zoomAnim.startTarget, 1 / Z);
        const dir = this.getViewDirection(this.state.view).normalize();
        this.camera.position.copy(this.cameraTarget.clone().add(dir.multiplyScalar(this.zoomAnim.camDist)));
        this.camera.lookAt(this.cameraTarget);
      }
      this.camera.updateProjectionMatrix();
      if (t >= 1) {
        const done = this.zoomAnim;
        this.zoomAnim = null;
        done.resolve();
      }
    }

    if (!this.zoomAnim) this.updateCameraAnimation(now);
    this.updateShipMarker(now);
    this.renderer?.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------------------
  // 정리
  // ---------------------------------------------------------------------------

  disposeGroup(group) {
    while (group.children.length > 0) {
      const child = group.children.pop();
      this.disposeObject(child);
    }
  }

  disposeObject(object) {
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => this.disposeMaterial(material));
        } else {
          this.disposeMaterial(child.material);
        }
      }
    });
  }

  disposeMaterial(material) {
    // 스프라이트 텍스처는 캐시에서 공유하므로 여기서는 재질만 정리한다.
    material.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    this.clearMap();
    if (this.shipMarker) {
      this.shipGroup.remove(this.shipMarker);
      this.disposeObject(this.shipMarker);
      this.shipMarker = null;
    }
    if (this.materials) {
      Object.values(this.materials).forEach((material) => material.dispose());
      this.materials = null;
    }
    this.svgTextureCache.forEach((texture) => texture.dispose());
    this.svgTextureCache.clear();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInCubic(t) {
  return t * t * t;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
