import * as THREE from "three";

const DEFAULT_TOON_SETTINGS = {
  enabled: true,
  bodyColor: 0x96a0aa,
  bodyOpacity: 1,
  outlineColor: 0x102033,
  outlineWidthVh: 0.3,
  doubleSided: true,
  emissiveIntensityThreshold: 0.3,
  toneSteps: 6,
  toneFloor: 0.2
};

/**
 * Stylized rendering helper.
 *
 * Outline: single-pass inverted-hull silhouette. Each target mesh gets a child
 * "shell" mesh that renders back faces extruded along smoothed normals by a
 * screen-constant pixel width. Because the shell shares the scene depth buffer,
 * a nearer object's shell rim naturally draws over a farther object — i.e.
 * inter-object overlap outlines work without any full-screen post-process.
 *
 * Full toon: additionally swaps target materials for flat MeshBasic cell tones.
 * (No internal crease/edge lines — silhouette only.)
 */
export class ToonRenderStyle {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_TOON_SETTINGS, ...settings };
    this.enabled = this.settings.enabled !== false;
    this.materialCache = new Map();
    this.materialOverrideRecords = [];
    this._lastFov = 60;
    this.gradientTex = this.makeGradientTex(this.getToneSteps(), this.getToneFloor());
    this.outlineMaterial = this.createOutlineMaterial();
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
  }

  setSettings(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    this.enabled = this.settings.enabled !== false;
    this.materialCache.forEach((material) => material.dispose());
    this.materialCache.clear();
    if (settings.toneSteps != null || settings.toneFloor != null || !this.gradientTex) {
      this.gradientTex?.dispose();
      this.gradientTex = this.makeGradientTex(this.getToneSteps(), this.getToneFloor());
    }
    this.outlineMaterial.color.set(this.settings.outlineColor);
    this.outlineMaterial.userData.outlineUniforms.uExtrudeK.value = this.computeOutlineExtrudeK();
  }

  getToneSteps() {
    const n = Math.round(Number(this.settings.toneSteps));
    return Number.isFinite(n) ? THREE.MathUtils.clamp(n, 1, 8) : 6;
  }

  getToneFloor() {
    const f = Number(this.settings.toneFloor);
    return Number.isFinite(f) ? THREE.MathUtils.clamp(f, 0, 1) : 0.45;
  }

  /** N-step toon ramp: a 1-D Nearest-filtered texture quantizing diffuse light into bands. */
  makeGradientTex(steps, floor) {
    const n = Math.max(1, steps | 0);
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 1 : i / (n - 1);
      data[i] = Math.round((floor + (1 - floor) * t) * 255);
    }
    const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  isStylableMesh(object) {
    return object?.isMesh
      && object.geometry
      && !object.userData?.__betaVoidToonHelper;
  }

  /* ── Inverted-hull outline ─────────────────────────────────── */

  createOutlineMaterial() {
    const material = new THREE.MeshBasicMaterial({
      color: this.settings.outlineColor,
      side: THREE.BackSide,
      fog: false,
      toneMapped: false
    });
    material.userData.outlineUniforms = {
      uExtrudeK: { value: this.computeOutlineExtrudeK() }
    };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uExtrudeK = material.userData.outlineUniforms.uExtrudeK;
      shader.vertexShader =
        "attribute vec3 aSmoothNormal;\nuniform float uExtrudeK;\n" +
        shader.vertexShader.replace(
          "#include <project_vertex>",
          [
            "vec4 _vzViewPos = modelViewMatrix * vec4(transformed, 1.0);",
            "vec3 _vzViewNormal = normalize(normalMatrix * aSmoothNormal);",
            "float _vzDepth = max(-_vzViewPos.z, 1e-3);",
            "_vzViewPos.xyz += _vzViewNormal * (uExtrudeK * _vzDepth);",
            "gl_Position = projectionMatrix * _vzViewPos;"
          ].join("\n")
        );
    };
    material.customProgramCacheKey = () => "beta-void-inverted-hull-outline-v2";
    return material;
  }

  getOutlineWidthVh() {
    const width = Number(this.settings.outlineWidthVh);
    return Number.isFinite(width) ? THREE.MathUtils.clamp(width, 0, 3) : 0.3;
  }

  /**
   * Outline width as a fraction of viewport height (vh), resolution/DPR independent.
   * The projected screen height of the hull extrusion equals (widthVh%) * bufferHeight
   * for any buffer size, so this constant depends only on width and vertical FOV — the
   * buffer height cancels out (no per-resize work, same shader cost as before).
   */
  computeOutlineExtrudeK() {
    const fov = THREE.MathUtils.degToRad(Number(this._lastFov) || 60);
    return (this.getOutlineWidthVh() / 100) * 2.0 * Math.tan(fov * 0.5);
  }

  setOutlineMetrics(verticalFovDeg) {
    const fov = Number(verticalFovDeg);
    if (Number.isFinite(fov) && fov > 0) this._lastFov = fov;
    this.outlineMaterial.userData.outlineUniforms.uExtrudeK.value = this.computeOutlineExtrudeK();
  }

  setOutlineWidthVh(vh) {
    this.settings.outlineWidthVh = vh;
    this.outlineMaterial.userData.outlineUniforms.uExtrudeK.value = this.computeOutlineExtrudeK();
  }

  setOutlineColor(color) {
    this.settings.outlineColor = color;
    this.outlineMaterial.color.set(color);
  }

  /** Welds vertices by position and averages normals so the hull extrudes without seams. */
  bakeSmoothNormals(geo) {
    if (geo.getAttribute("aSmoothNormal")) return;
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    const eps = Math.max((size.x + size.y + size.z) / 3 * 1e-4, 1e-6);
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const key = (x, y, z) => `${Math.round(x / eps)}_${Math.round(y / eps)}_${Math.round(z / eps)}`;
    const acc = new Map();
    for (let i = 0; i < pos.count; i++) {
      const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
      let a = acc.get(k);
      if (!a) { a = [0, 0, 0]; acc.set(k, a); }
      a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
    }
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = acc.get(key(pos.getX(i), pos.getY(i), pos.getZ(i)));
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
    }
    geo.setAttribute("aSmoothNormal", new THREE.BufferAttribute(out, 3));
  }

  ensureOutlineShell(mesh) {
    const existing = mesh.userData?.__betaVoidOutlineShell;
    if (existing?.userData?.sourceGeometry === mesh.geometry) {
      existing.visible = true;
      return existing;
    }
    if (existing) this.disposeOutlineShell(existing);
    if (!mesh.geometry?.attributes?.position) return null;

    this.bakeSmoothNormals(mesh.geometry);
    const shell = new THREE.Mesh(mesh.geometry, this.outlineMaterial);
    shell.name = `${mesh.name || "mesh"}_outline_shell`;
    shell.frustumCulled = false;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.renderOrder = (mesh.renderOrder || 0) - 1;
    shell.userData.__betaVoidToonHelper = true;
    shell.userData.sourceGeometry = mesh.geometry;
    mesh.add(shell);
    mesh.userData.__betaVoidOutlineShell = shell;
    return shell;
  }

  buildOutlineShells(root, isTargetMesh = (object) => this.isStylableMesh(object)) {
    if (!root || !this.enabled) return;
    root.traverse((object) => {
      if (!isTargetMesh(object)) return;
      this.ensureOutlineShell(object);
    });
  }

  disposeOutlineShell(shell) {
    if (!shell) return;
    if (shell.parent?.userData?.__betaVoidOutlineShell === shell) {
      delete shell.parent.userData.__betaVoidOutlineShell;
    }
    shell.parent?.remove(shell);
    // geometry is shared with the source mesh; do not dispose it here.
  }

  removeOutlineShells(root) {
    if (!root) return;
    const shells = [];
    root.traverse((object) => {
      const shell = object.userData?.__betaVoidOutlineShell;
      if (shell) shells.push(shell);
    });
    shells.forEach((shell) => this.disposeOutlineShell(shell));
  }

  /* ── Full-toon material override ───────────────────────────── */

  applyMaterialOverrides(root, isTargetMesh = (object) => this.isStylableMesh(object)) {
    if (!root || !this.enabled) return;
    root.traverse((object) => {
      if (!isTargetMesh(object)) return;
      const originalMaterial = object.material;
      const nextMaterial = this.createToonMaterialOverride(originalMaterial);
      if (nextMaterial === originalMaterial) return;
      this.materialOverrideRecords.push({ object, material: originalMaterial });
      object.material = nextMaterial;
    });
  }

  createToonMaterialOverride(originalMaterial) {
    const materials = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
    const toonMaterials = materials.map((material) => this.getToonMaterial(material));
    return Array.isArray(originalMaterial) ? toonMaterials : toonMaterials[0];
  }

  restoreMaterialOverrides() {
    this.materialOverrideRecords.forEach(({ object, material }) => {
      object.material = material;
    });
    this.materialOverrideRecords.length = 0;
  }

  getToonMaterial(material) {
    if (!material) return this.getBodyMaterial();
    if (this.isHighlightMaterial(material)) return this.getHighlightMaterial(material);
    if (this.isEmissiveMaterial(material)) return this.getEmissiveMaterial(material);
    return this.getBodyMaterial();
  }

  getBodyMaterial() {
    const side = this.getMaterialSide();
    const opacity = this.getConfiguredOpacity(1);
    const transparent = opacity < 1;
    const key = `body:${this.settings.bodyColor}:${opacity}:${side}:${this.getToneSteps()}:${this.getToneFloor()}`;
    if (!this.materialCache.has(key)) {
      this.materialCache.set(key, new THREE.MeshToonMaterial({
        color: this.settings.bodyColor,
        gradientMap: this.gradientTex,
        transparent,
        opacity,
        side,
        depthWrite: !transparent,
        fog: true
      }));
    }
    return this.materialCache.get(key);
  }

  getHighlightMaterial(material) {
    const color = material?.color?.isColor ? material.color.getHex() : 0xffffff;
    const opacity = this.getConfiguredOpacity(this.getMaterialOpacity(material));
    const transparent = opacity < 1 || material.transparent === true;
    const side = this.getMaterialSide(material);
    const key = `highlight:${color}:${transparent}:${opacity}:${side}`;
    if (!this.materialCache.has(key)) {
      this.materialCache.set(key, new THREE.MeshBasicMaterial({
        color, transparent, opacity, side,
        depthWrite: !transparent, toneMapped: false, fog: true
      }));
    }
    return this.materialCache.get(key);
  }

  getEmissiveMaterial(material) {
    const color = material?.emissive?.isColor && material.emissive.getHex() !== 0x000000
      ? material.emissive.getHex()
      : material?.color?.isColor ? material.color.getHex() : 0xffffff;
    const opacity = this.getConfiguredOpacity(this.getMaterialOpacity(material));
    const transparent = opacity < 1 || material.transparent === true;
    const side = this.getMaterialSide(material);
    const key = `emissive:${color}:${transparent}:${opacity}:${side}`;
    if (!this.materialCache.has(key)) {
      this.materialCache.set(key, new THREE.MeshBasicMaterial({
        color, transparent, opacity, side,
        depthWrite: !transparent, toneMapped: false, fog: true
      }));
    }
    return this.materialCache.get(key);
  }

  getMaterialOpacity(material) {
    const opacity = Number(material?.opacity);
    return Number.isFinite(opacity) ? THREE.MathUtils.clamp(opacity, 0, 1) : 1;
  }

  getConfiguredOpacity(fallback = 1) {
    const opacity = Number(this.settings.bodyOpacity);
    return Number.isFinite(opacity) ? THREE.MathUtils.clamp(opacity, 0, 1) : fallback;
  }

  isEmissiveMaterial(material) {
    const name = String(material?.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (/(emissive|glow|engine|headlight|auxlight|light)/.test(name)) return true;
    const intensity = Number(material?.emissiveIntensity);
    const hasVisibleEmissive = material?.emissive?.isColor && material.emissive.getHex() !== 0x000000;
    return hasVisibleEmissive
      && Number.isFinite(intensity)
      && intensity >= this.settings.emissiveIntensityThreshold;
  }

  isHighlightMaterial(material) {
    return String(material?.name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .includes("highlight");
  }

  getMaterialSide(material = null) {
    return this.settings.doubleSided === false
      ? material?.side ?? THREE.FrontSide
      : THREE.DoubleSide;
  }

  /* ── Cleanup ───────────────────────────────────────────────── */

  dispose() {
    this.restoreMaterialOverrides();
    this.materialCache.forEach((material) => material.dispose());
    this.materialCache.clear();
    this.gradientTex?.dispose();
    this.outlineMaterial.dispose();
  }
}
