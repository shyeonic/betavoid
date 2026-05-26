import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const DEFAULT_OBJECT_BLOOM = {
  layer: 1,
  strength: 0.2,
  radius: 0.1,
  threshold: 0.14,
  pixelRatioCap: 1,
  resolutionScale: 0.75
};

export class BloomRenderPipeline {
  constructor({ renderer, scene, camera, objectBloom = DEFAULT_OBJECT_BLOOM }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.objectBloom = { ...DEFAULT_OBJECT_BLOOM, ...objectBloom };
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.objectBloomLayer = new THREE.Layers();
    this.objectBloomLayer.set(this.objectBloom.layer);
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
    this.finalComposer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.finalComposer.setSize(window.innerWidth, window.innerHeight);
    this.finalComposer.addPass(new RenderPass(scene, camera));
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

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.applyBloomComposerSize();
    this.finalComposer.setPixelRatio(this.getFinalPixelRatio());
    this.finalComposer.setSize(width, height);
  }

  getFinalPixelRatio() {
    return Math.min(window.devicePixelRatio, 2);
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
  }

  render() {
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
    this.finalComposer.render();
  }

  dispose() {
    this.bloomOcclusionMaterial.dispose();
    this.bloomComposer.dispose();
    this.finalComposer.dispose();
  }
}
