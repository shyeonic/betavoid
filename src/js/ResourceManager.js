import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { ASSETS } from "./config.js";

export class ResourceManager {
  constructor({ onChange } = {}) {
    this.onChange = onChange;
    this.resources = new Map();
    this.loadedResources = new Map();
    this.pendingLoads = new Map();
    this.objectUrls = new Set();
    this.disposed = false;
  }

  get snapshot() {
    const entries = Array.from(this.resources.values());
    const total = entries.length;
    const completed = entries.filter((entry) => entry.status === "ready" || entry.status === "error").length;
    const errors = entries.filter((entry) => entry.status === "error");

    return {
      total,
      completed,
      progress: total === 0 ? 0 : completed / total,
      entries,
      errors
    };
  }

  dispose() {
    this.disposed = true;
    for (const objectUrl of this.objectUrls) {
      URL.revokeObjectURL(objectUrl);
    }
    this.objectUrls.clear();
    this.loadedResources.clear();
    this.pendingLoads.clear();
  }

  begin(id, label, source) {
    if (this.disposed) return;
    this.resources.set(id, {
      id,
      label,
      source,
      status: "loading",
      error: null
    });
    this.emit();
  }

  complete(id, source) {
    if (this.disposed) return;
    const entry = this.resources.get(id);
    if (!entry) return;
    entry.status = "ready";
    entry.source = source ?? entry.source;
    this.emit();
  }

  fail(id, error) {
    if (this.disposed) return;
    const entry = this.resources.get(id);
    if (!entry) return;
    entry.status = "error";
    entry.error = error instanceof Error ? error.message : String(error);
    this.emit();
  }

  emit() {
    if (this.disposed) return;
    if (this.onChange) this.onChange(this.snapshot);
  }

  getShipSources() {
    return [
      ASSETS.ships.local,
      ASSETS.ships.remoteFallback
    ];
  }

  looksLikeObjFile(text) {
    return /(^|\n)\s*(v|vn|vt|f|o|g)\s+/m.test(text);
  }

  createFallbackShipMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xCFF3FF,
      metalness: 0.55,
      roughness: 0.28,
      emissive: 0x00449E,
      emissiveIntensity: 0.2
    });
  }

  normalizeModel(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const scale = 6 / longest;
    object.scale.setScalar(scale);
    object.position.copy(center).multiplyScalar(-scale);

    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
      if (!child.material || (Array.isArray(child.material) && child.material.length === 0)) {
        child.material = this.createFallbackShipMaterial();
      }
    });

    return object;
  }

  normalizeWorldModel(object, targetSize = 1) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const scale = targetSize / longest;
    object.scale.setScalar(scale);
    object.position.copy(center).multiplyScalar(-scale);

    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
      if (!child.material) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          metalness: 0.22,
          roughness: 0.48
        });
      }
    });

    return object;
  }

  async loadObjModel(id, source, options = {}) {
    if (this.disposed) throw new Error("ResourceManager has been disposed.");
    if (this.loadedResources.has(id)) return this.loadedResources.get(id);
    if (this.pendingLoads.has(id)) return this.pendingLoads.get(id);

    const task = this.fetchObjModel(id, source, options);
    this.pendingLoads.set(id, task);
    try {
      return await task;
    } finally {
      this.pendingLoads.delete(id);
    }
  }

  async fetchObjModel(id, source, options = {}) {
    if (this.disposed) throw new Error("ResourceManager has been disposed.");
    const sources = this.resolveObjSources(source, options);
    this.begin(id, options.label || id, sources.obj);

    try {
      const response = await fetch(sources.obj, { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const text = await response.text();
      if (!this.looksLikeObjFile(text)) throw new Error("Invalid OBJ data.");

      const loader = new OBJLoader();
      const materials = sources.mtl ? await this.loadMtlMaterials(sources.mtl) : null;
      if (materials) loader.setMaterials(materials);

      const object = loader.parse(text);
      if (!object.children.length) throw new Error("OBJ contained no renderable children.");
      if (this.disposed) throw new Error("ResourceManager has been disposed.");

      const resource = {
        id,
        source: sources.obj,
        mtlSource: sources.mtl,
        object: this.normalizeWorldModel(object, options.targetSize ?? 1)
      };
      this.loadedResources.set(id, resource);
      this.complete(id, sources.obj);
      return resource;
    } catch (error) {
      this.fail(id, error);
      throw error;
    }
  }

  resolveObjSources(source, options = {}) {
    if (typeof source === "string") {
      return {
        obj: new URL(source).href,
        mtl: options.mtlSource ? new URL(options.mtlSource).href : null
      };
    }

    return {
      obj: new URL(source.obj).href,
      mtl: source.mtl ? new URL(source.mtl).href : null
    };
  }

  async loadMtlMaterials(source) {
    const response = await fetch(source, { cache: "force-cache" });
    if (!response.ok) throw new Error(`MTL HTTP ${response.status}`);

    const text = await response.text();
    const loader = new MTLLoader();
    loader.setResourcePath(new URL(".", source).href);
    const materials = loader.parse(text, new URL(".", source).href);
    materials.preload();
    return materials;
  }

  resolveShipSource(source) {
    if (typeof source === "string") {
      const url = new URL(source).href;
      return {
        url,
        label: url.split("/").pop() || "ship",
        type: /\.glb($|\?)/i.test(url) ? "glb" : "obj"
      };
    }

    const url = new URL(source.glb || source.obj || source.url).href;
    return {
      url,
      label: source.label || url.split("/").pop() || "ship",
      type: source.glb || /\.glb($|\?)/i.test(url) ? "glb" : "obj"
    };
  }

  async loadGlbObject(source) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(source);
    return gltf.scene;
  }

  async loadObjObject(source) {
    const response = await fetch(source, { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    if (!this.looksLikeObjFile(text)) throw new Error("Invalid OBJ data.");

    const loader = new OBJLoader();
    return loader.parse(text);
  }

  async loadShipModel() {
    if (this.disposed) throw new Error("ResourceManager has been disposed.");
    const id = "ship:ship_01";
    const sources = this.getShipSources().map((source) => this.resolveShipSource(source));
    this.begin(id, sources[0]?.label || "ship_01.glb", sources[0]?.url);

    for (const source of sources) {
      try {
        const object = source.type === "glb"
          ? await this.loadGlbObject(source.url)
          : await this.loadObjObject(source.url);
        if (!object.children.length) continue;
        if (this.disposed) throw new Error("ResourceManager has been disposed.");

        this.complete(id, source.url);
        return {
          id,
          source: source.url,
          type: source.type,
          remote: source.url.startsWith("http"),
          object: this.normalizeModel(object)
        };
      } catch {
        continue;
      }
    }

    const error = new Error("player ship model could not be loaded from local GLB or remote OBJ sources.");
    this.fail(id, error);
    throw error;
  }

  async loadAudio(id, source) {
    if (this.disposed) throw new Error("ResourceManager has been disposed.");
    if (this.loadedResources.has(id)) return this.loadedResources.get(id);
    if (this.pendingLoads.has(id)) return this.pendingLoads.get(id);

    const task = this.fetchAudio(id, source);
    this.pendingLoads.set(id, task);
    try {
      return await task;
    } finally {
      this.pendingLoads.delete(id);
    }
  }

  async fetchAudio(id, source) {
    if (this.disposed) throw new Error("ResourceManager has been disposed.");
    const absoluteSource = new URL(source).href;
    this.begin(id, source, absoluteSource);

    try {
      const response = await fetch(absoluteSource, { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      if (this.disposed) throw new Error("ResourceManager has been disposed.");

      const objectUrl = URL.createObjectURL(blob);
      this.objectUrls.add(objectUrl);

      const audio = new Audio();
      audio.preload = "auto";
      audio.src = objectUrl;
      audio.load();
      if (this.disposed) {
        audio.removeAttribute("src");
        audio.load();
        throw new Error("ResourceManager has been disposed.");
      }

      const resource = { id, source: absoluteSource, audio };
      this.loadedResources.set(id, resource);
      this.complete(id, absoluteSource);
      return resource;
    } catch (error) {
      this.fail(id, error);
      throw error;
    }
  }

  async loadArrayBuffer(id, source) {
    if (this.disposed) throw new Error("ResourceManager has been disposed.");
    if (this.loadedResources.has(id)) return this.loadedResources.get(id);
    if (this.pendingLoads.has(id)) return this.pendingLoads.get(id);

    const task = this.fetchArrayBuffer(id, source);
    this.pendingLoads.set(id, task);
    try {
      return await task;
    } finally {
      this.pendingLoads.delete(id);
    }
  }

  async fetchArrayBuffer(id, source) {
    if (this.disposed) throw new Error("ResourceManager has been disposed.");
    const absoluteSource = new URL(source).href;
    this.begin(id, source, absoluteSource);

    try {
      const response = await fetch(absoluteSource, { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const arrayBuffer = await response.arrayBuffer();
      if (this.disposed) throw new Error("ResourceManager has been disposed.");

      const resource = { id, source: absoluteSource, arrayBuffer };
      this.loadedResources.set(id, resource);
      this.complete(id, absoluteSource);
      return resource;
    } catch (error) {
      this.fail(id, error);
      throw error;
    }
  }
}
