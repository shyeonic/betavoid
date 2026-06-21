import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ToonRenderStyle } from "./ToonRenderStyle.js";

const DEFAULT_OBJECT_BLOOM = {
  enabled: true,
  layer: 1,
  strength: 0.2,
  radius: 0.1,
  threshold: 0.14,
  pixelRatioCap: 1,
  resolutionScale: 0.75
};

const STYLIZED_RENDER_MODES = ["off", "outline", "full"];

const DEFAULT_OUTLINE_SETTINGS = {
  color: 0x102033,
  widthVh: 0.3
};

export class BloomRenderPipeline {
  constructor({ renderer, scene, camera, objectBloom = DEFAULT_OBJECT_BLOOM, renderResolutionScale = 1, maxPixelRatio = 2 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.objectBloom = { ...DEFAULT_OBJECT_BLOOM, ...objectBloom };
    this.renderResolutionScale = this.normalizeRenderResolutionScale(renderResolutionScale);
    this.maxPixelRatio = this.normalizeMaxPixelRatio(maxPixelRatio);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.objectBloomLayer = new THREE.Layers();
    this.objectBloomLayer.set(this.objectBloom.layer);
    this._hyperdriveWarpLayer = null;
    this.bloomOcclusionMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      fog: false,
      toneMapped: false
    });
    this.materialOverrideTargets = [];
    this.materialsOverriddenDuringBloom = [];
    this.hiddenUnauthorizedBloomObjects = [];

    // Stylized rendering (inverted-hull outline + optional flat cell tone).
    this.stylizedRenderMode = "off";
    this.outlineEnabled = false;
    this.fullToonEnabled = false;
    this.outlineSettings = { ...DEFAULT_OUTLINE_SETTINGS };
    this.stylizedRenderTargets = new Set();
    this._pendingStyleRoots = new Set();
    this.toonRenderStyle = new ToonRenderStyle({
      outlineColor: this.outlineSettings.color,
      outlineWidthVh: this.outlineSettings.widthVh
    });

    this.bloomComposer = new EffectComposer(renderer);
    this.bloomComposer.renderToScreen = false;
    this.applyBloomComposerSize();
    this.bloomRenderPass = new RenderPass(scene, camera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.getBloomRenderWidth(), this.getBloomRenderHeight()),
      this.objectBloom.strength,
      this.objectBloom.radius,
      this.objectBloom.threshold
    );
    this.bloomComposer.addPass(this.bloomRenderPass);
    this.bloomComposer.addPass(this.bloomPass);

    this.finalComposer = new EffectComposer(renderer);
    this.finalComposer.setPixelRatio(this.getFinalPixelRatio());
    this.finalComposer.setSize(window.innerWidth, window.innerHeight);
    this.finalRenderPass = new RenderPass(scene, camera);
    this.finalComposer.addPass(this.finalRenderPass);
    this.bloomCompositePass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
        },
        vertexShader: `
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D baseTexture;
          uniform sampler2D bloomTexture;
          varying vec2 vUv;

          void main() {
            gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
          }
        `,
        defines: {}
      }),
      "baseTexture"
    );
    this.bloomCompositePass.needsSwap = true;
    this.finalComposer.addPass(this.bloomCompositePass);
    this.outputPass = new OutputPass();
    this.finalComposer.addPass(this.outputPass);
  }

  get objectBloomLayerId() {
    return this.objectBloom.layer;
  }

  setObjectBloomSettings(settings = {}) {
    this.objectBloom = { ...this.objectBloom, ...settings };
    this.objectBloomLayer.set(this.objectBloom.layer);
    this.bloomPass.strength = this.objectBloom.strength;
    this.bloomPass.radius = this.objectBloom.radius;
    this.bloomPass.threshold = this.objectBloom.threshold;
    this.applyBloomComposerSize();
    this.markTargetsDirty();
  }

  setStylizedRenderMode(mode, settings = {}) {
    const nextMode = STYLIZED_RENDER_MODES.includes(mode) ? mode : "off";
    this.stylizedRenderMode = nextMode;
    this.outlineEnabled = nextMode === "outline" || nextMode === "full";
    this.fullToonEnabled = nextMode === "full";

    if (settings.color != null) this.outlineSettings.color = settings.color;
    if (settings.widthVh != null) this.outlineSettings.widthVh = settings.widthVh;
    this.toonRenderStyle.setSettings({
      outlineColor: this.outlineSettings.color,
      outlineWidthVh: this.outlineSettings.widthVh
    });

    if (this.outlineEnabled) {
      this.toonRenderStyle.setEnabled(true);
      this._pendingStyleRoots = new Set(this.stylizedRenderTargets);
    } else {
      this.cleanupToonRenderStyle();
    }
  }

  registerStylizedRenderTarget(root) {
    if (!root || !root.isObject3D) return;
    this.stylizedRenderTargets.add(root);
    if (this.outlineEnabled) this._pendingStyleRoots.add(root);
  }

  unregisterStylizedRenderTarget(root) {
    if (!root) return;
    this.stylizedRenderTargets.delete(root);
    this._pendingStyleRoots.delete(root);
    this.toonRenderStyle?.removeOutlineShells?.(root);
  }

  findStylizedRenderRoot(object) {
    let current = object;
    while (current && current !== this.scene) {
      if (this.stylizedRenderTargets.has(current)) return current;
      current = current.parent;
    }
    return null;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.applyBloomComposerSize();
    this.finalComposer.setPixelRatio(this.getFinalPixelRatio());
    this.finalComposer.setSize(width, height);
    this.updateOutlineMetrics();
  }

  setHyperdriveWarpLayer(layer) {
    this._hyperdriveWarpLayer = layer;
  }

  // Repoint the pipeline at a different scene/camera (e.g. the docking scene) so it
  // still receives bloom. The render passes and material-override traversal follow.
  setRenderTarget(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.bloomRenderPass.scene = scene;
    this.bloomRenderPass.camera = camera;
    this.finalRenderPass.scene = scene;
    this.finalRenderPass.camera = camera;
  }

  setRenderResolutionScale(scale) {
    this.renderResolutionScale = this.normalizeRenderResolutionScale(scale);
    this.finalComposer.setPixelRatio(this.getFinalPixelRatio());
    this.finalComposer.setSize(this.width, this.height);
    this.updateOutlineMetrics();
  }

  setMaxPixelRatio(maxPixelRatio) {
    this.maxPixelRatio = this.normalizeMaxPixelRatio(maxPixelRatio);
    this.applyBloomComposerSize();
    this.finalComposer.setPixelRatio(this.getFinalPixelRatio());
    this.finalComposer.setSize(this.width, this.height);
    this.updateOutlineMetrics();
  }

  normalizeMaxPixelRatio(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? THREE.MathUtils.clamp(n, 0.5, 3) : 2;
  }

  normalizeRenderResolutionScale(scale) {
    const value = Number(scale);
    return Number.isFinite(value) && value > 0
      ? THREE.MathUtils.clamp(value, 0.25, 1)
      : 1;
  }

  getFinalPixelRatio() {
    return Math.min(window.devicePixelRatio, this.maxPixelRatio) * this.renderResolutionScale;
  }

  getBloomPixelRatio() {
    const pixelRatioCap = Number(this.objectBloom.pixelRatioCap);
    const maxPixelRatio = Number.isFinite(pixelRatioCap) && pixelRatioCap > 0 ? pixelRatioCap : 1;
    return Math.min(window.devicePixelRatio, maxPixelRatio);
  }

  getBloomResolutionScale() {
    const resolutionScale = Number(this.objectBloom.resolutionScale);
    return Number.isFinite(resolutionScale) && resolutionScale > 0
      ? THREE.MathUtils.clamp(resolutionScale, 0.25, 1)
      : 1;
  }

  getBloomRenderWidth() {
    return Math.max(1, Math.round(this.width * this.getBloomResolutionScale()));
  }

  getBloomRenderHeight() {
    return Math.max(1, Math.round(this.height * this.getBloomResolutionScale()));
  }

  applyBloomComposerSize() {
    this.bloomComposer.setPixelRatio(this.getBloomPixelRatio());
    this.bloomComposer.setSize(this.getBloomRenderWidth(), this.getBloomRenderHeight());
  }

  getFinalRenderWidth() {
    return Math.max(1, Math.round(this.width * this.getFinalPixelRatio()));
  }

  getFinalRenderHeight() {
    return Math.max(1, Math.round(this.height * this.getFinalPixelRatio()));
  }

  isStylizedTargetMesh(object) {
    return object.isMesh
      && object.geometry
      && object.visible
      && !object.userData?.__voidZeroToonHelper
      && !!this.findStylizedRenderRoot(object);
  }

  markTargetsDirty() {
    // Layer-based bloom does not need a target cache; kept as a stable hook for scene mutations.
  }

  registerMaterialOverrideTarget(object, material, options = {}) {
    if (!object || !material) return;
    const existing = this.materialOverrideTargets.find((target) => target.object === object);
    if (existing) {
      existing.material = material;
      existing.temporaryLayer = options.temporaryLayer === true;
      return;
    }
    this.materialOverrideTargets.push({
      object,
      material,
      temporaryLayer: options.temporaryLayer === true
    });
  }

  registerOcclusionTarget(object) {
    this.registerMaterialOverrideTarget(object, this.bloomOcclusionMaterial, { temporaryLayer: true });
  }

  unregisterMaterialOverrideTarget(object) {
    this.materialOverrideTargets = this.materialOverrideTargets
      .filter((target) => target.object !== object);
  }

  applyBloomMaterialOverrides() {
    this.materialsOverriddenDuringBloom.length = 0;
    const allowedBloomObjects = new Set(this.materialOverrideTargets.map(({ object }) => object));
    this.scene.traverse((object) => {
      if (!this.isRenderableObject(object)) return;
      if (!this.objectBloomLayer.test(object.layers)) return;
      if (allowedBloomObjects.has(object)) return;
      if (!object.visible) return;

      this.hiddenUnauthorizedBloomObjects.push(object);
      object.visible = false;
    });

    this.materialOverrideTargets.forEach(({ object, material, temporaryLayer }) => {
      if (!object.visible) return;
      this.materialsOverriddenDuringBloom.push({
        object,
        material: object.material,
        layerMask: object.layers.mask
      });
      if (temporaryLayer) object.layers.enable(this.objectBloom.layer);
      object.material = material;
    });
  }

  restoreBloomMaterialOverrides() {
    this.materialsOverriddenDuringBloom.forEach(({ object, material, layerMask }) => {
      object.material = material;
      object.layers.mask = layerMask;
    });
    this.materialsOverriddenDuringBloom.length = 0;
    this.hiddenUnauthorizedBloomObjects.forEach((object) => {
      object.visible = true;
    });
    this.hiddenUnauthorizedBloomObjects.length = 0;
  }

  isRenderableObject(object) {
    return object.isMesh || object.isPoints || object.isLine || object.isSprite;
  }

  cleanupToonRenderStyle() {
    this.toonRenderStyle?.restoreMaterialOverrides?.();
    this.stylizedRenderTargets.forEach((root) => this.toonRenderStyle?.removeOutlineShells?.(root));
    this._pendingStyleRoots.clear();
  }

  // Build outline shells for newly-registered roots (bounded to those roots, not the whole scene).
  processPendingStyleRoots() {
    if (!this._pendingStyleRoots.size) return;
    this._pendingStyleRoots.forEach((root) => {
      if (this.stylizedRenderTargets.has(root)) {
        this.toonRenderStyle.buildOutlineShells(root, (object) => this.isStylizedTargetMesh(object));
      }
    });
    this._pendingStyleRoots.clear();
  }

  updateOutlineMetrics() {
    if (!this.outlineEnabled) return;
    const fov = this.camera?.isPerspectiveCamera ? this.camera.fov : 60;
    this.toonRenderStyle.setOutlineMetrics(fov);
  }

  // Live tuning (color + width in vh) without rebuilding shells — they share one material.
  setOutlineSettings({ color, widthVh } = {}) {
    if (color != null) {
      this.outlineSettings.color = color;
      this.toonRenderStyle.setOutlineColor(color);
    }
    if (widthVh != null) {
      this.outlineSettings.widthVh = widthVh;
      this.toonRenderStyle.setOutlineWidthVh(widthVh);
    }
  }

  // Live tuning of the full-toon cell-tone settings (bodyColor, bodyOpacity, doubleSided,
  // emissiveIntensityThreshold). Rebuilds the cached cell materials on next render.
  setStylizedSettings(partial = {}) {
    if (partial.outlineColor != null) this.outlineSettings.color = partial.outlineColor;
    if (partial.outlineWidthVh != null) this.outlineSettings.widthVh = partial.outlineWidthVh;
    this.toonRenderStyle.setSettings(partial);
  }

  renderFinalComposer({ bloomEnabled = this.objectBloom.enabled !== false } = {}) {
    this.bloomCompositePass.enabled = bloomEnabled;
    this.finalComposer.render();
  }

  renderBaseScene(renderFn = () => this.renderFinalComposer()) {
    if (!this.outlineEnabled) {
      renderFn();
      return;
    }

    this.processPendingStyleRoots();
    this.updateOutlineMetrics();

    // Outline shells are persistent scene children and render in the normal pass.
    // Full-toon swaps target materials to flat cell tones for this frame only, so the
    // earlier bloom pass still sees the original emissive materials.
    if (!this.fullToonEnabled) {
      renderFn();
      return;
    }

    try {
      this.stylizedRenderTargets.forEach((root) => {
        this.toonRenderStyle.applyMaterialOverrides(root, (object) => this.isStylizedTargetMesh(object));
      });
      renderFn();
    } finally {
      this.toonRenderStyle.restoreMaterialOverrides();
    }
  }

  renderBloomComposer() {
    const originalCameraLayerMask = this.camera.layers.mask;
    const originalBackground = this.scene.background;
    const originalFog = this.scene.fog;
    try {
      this.applyBloomMaterialOverrides();
      this.camera.layers.set(this.objectBloom.layer);
      this.scene.background = null;
      this.scene.fog = null;
      this.bloomComposer.render();
    } finally {
      this.camera.layers.mask = originalCameraLayerMask;
      this.scene.background = originalBackground;
      this.scene.fog = originalFog;
      this.restoreBloomMaterialOverrides();
    }
  }

  render() {
    const bloomEnabled = this.objectBloom.enabled !== false;
    if (bloomEnabled) {
      this.renderBloomComposer();
      this.renderBaseScene(() => this.renderFinalComposer({ bloomEnabled: true }));
    } else if (this.outlineEnabled) {
      this.renderBaseScene(() => this.renderFinalComposer({ bloomEnabled: false }));
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this._hyperdriveWarpLayer?.render(this.camera);
  }

  dispose() {
    this.cleanupToonRenderStyle();
    this.toonRenderStyle?.dispose?.();
    this.bloomOcclusionMaterial.dispose();
    this.bloomComposer.dispose();
    this.finalComposer.dispose();
  }
}
