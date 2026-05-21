import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
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
      child.material = new THREE.MeshStandardMaterial({
        color: 0xCFF3FF,
        metalness: 0.55,
        roughness: 0.28,
        emissive: 0x00449E,
        emissiveIntensity: 0.2
      });
    });

    return object;
  }

  async loadShipModel() {
    if (this.disposed) throw new Error("ResourceManager has been disposed.");
    const id = "ship:ship_01";
    const loader = new OBJLoader();
    const sources = this.getShipSources();
    this.begin(id, "ship_01.obj", sources[0]);

    for (const source of sources) {
      try {
        const response = await fetch(source, { cache: "force-cache" });
        if (!response.ok) continue;

        const text = await response.text();
        if (!this.looksLikeObjFile(text)) continue;

        const object = loader.parse(text);
        if (!object.children.length) continue;
        if (this.disposed) throw new Error("ResourceManager has been disposed.");

        this.complete(id, source);
        return {
          id,
          source,
          remote: source.startsWith("http"),
          object: this.normalizeModel(object)
        };
      } catch {
        continue;
      }
    }

    const error = new Error("ship_01.obj could not be loaded from local or remote sources.");
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
