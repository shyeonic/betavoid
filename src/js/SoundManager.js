import { ASSETS } from "./config.js";

class SoundAsset {
  constructor({ id, source, mode, audio = null, buffer = null }) {
    this.id = id;
    this.source = source;
    this.mode = mode;
    this.audio = audio;
    this.buffer = buffer;
  }

  dispose() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.audio = null;
  }
}

class MediaSoundInstance {
  constructor(manager, asset, options) {
    this.manager = manager;
    this.asset = asset;
    this.audio = options.exclusive === false ? asset.audio.cloneNode(false) : asset.audio;
    this.loop = options.loop;
    this.volume = options.volume;
    this.restart = options.restart;
    this.destroyOnEnd = options.destroyOnEnd;
    this.playing = false;
    this.disposed = false;
    this.boundEnded = () => this.handleEnded();
  }

  async play() {
    if (this.disposed) return false;
    this.audio.loop = this.loop;
    this.audio.volume = this.volume;
    this.audio.muted = false;
    this.audio.removeEventListener("ended", this.boundEnded);
    this.audio.addEventListener("ended", this.boundEnded);

    if (this.restart) this.resetToStart();

    await this.audio.play();
    this.playing = true;
    return true;
  }

  stop({ reset = true } = {}) {
    if (this.disposed) return;
    this.audio.pause();
    if (reset) this.resetToStart();
    this.playing = false;
  }

  handleEnded() {
    this.playing = false;
    if (this.destroyOnEnd) this.dispose();
  }

  resetToStart() {
    try {
      this.audio.currentTime = 0;
    } catch {
      this.audio.addEventListener("loadedmetadata", () => {
        this.audio.currentTime = 0;
      }, { once: true });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.audio.removeEventListener("ended", this.boundEnded);
    if (this.audio !== this.asset.audio) {
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.disposed = true;
    this.manager.releaseInstance(this);
  }
}

class BufferSoundInstance {
  constructor(manager, asset, options) {
    this.manager = manager;
    this.asset = asset;
    this.loop = options.loop;
    this.volume = options.volume;
    this.destroyOnEnd = options.destroyOnEnd;
    this.source = null;
    this.gain = null;
    this.started = false;
    this.disposed = false;
  }

  async play() {
    if (this.disposed || this.started) return false;
    const audioContext = await this.manager.ensureAudioContext();
    if (!audioContext) return false;

    this.source = audioContext.createBufferSource();
    this.gain = audioContext.createGain();
    this.source.buffer = this.asset.buffer;
    this.source.loop = this.loop;
    this.gain.gain.value = this.volume;
    this.source.connect(this.gain).connect(audioContext.destination);
    this.source.addEventListener("ended", () => this.handleEnded(), { once: true });
    this.source.start();
    this.started = true;
    return true;
  }

  stop() {
    if (this.disposed || !this.source) return;
    try {
      this.source.stop();
    } catch {
      this.dispose();
    }
  }

  handleEnded() {
    if (this.destroyOnEnd) {
      this.dispose();
    }
  }

  dispose() {
    if (this.disposed) return;
    if (this.source) this.source.disconnect();
    if (this.gain) this.gain.disconnect();
    this.source = null;
    this.gain = null;
    this.disposed = true;
    this.manager.releaseInstance(this);
  }
}

export class SoundManager {
  constructor(resourceManager, { volume = 0.55 } = {}) {
    this.resourceManager = resourceManager;
    this.volume = volume;
    this.assets = new Map();
    this.instances = new Set();
    this.audioContext = null;
    this.bgmInstance = null;
    this.preloadPromise = null;
    this.playPromise = null;
    this.disposed = false;
    this.catalog = new Map([
      ["bgm_main_01", {
        source: ASSETS.sounds.mainBgm,
        mode: "media"
      }],
      ["camera_toggle", {
        source: ASSETS.sounds.cameraToggle,
        mode: "buffer"
      }]
    ]);
    this.state = {
      ready: false,
      playing: false,
      muted: true,
      error: null
    };
  }

  async preload() {
    if (this.disposed) return false;
    if (this.state.ready && this.assets.has("bgm_main_01")) return true;
    if (this.preloadPromise) return this.preloadPromise;

    this.preloadPromise = this.load("bgm_main_01")
      .then(() => {
        if (this.disposed) return false;
        this.state.ready = true;
        this.state.error = null;
        return true;
      })
      .catch((error) => {
        this.state.ready = false;
        this.state.error = error instanceof Error ? error.message : String(error);
        return false;
      })
      .finally(() => {
        this.preloadPromise = null;
      });

    return this.preloadPromise;
  }

  async load(id, override = {}) {
    if (this.disposed) throw new Error("SoundManager has been disposed.");
    if (this.assets.has(id)) return this.assets.get(id);

    const definition = {
      ...this.catalog.get(id),
      ...override
    };
    if (!definition.source || !definition.mode) {
      throw new Error(`Unknown sound asset: ${id}`);
    }

    const asset = definition.mode === "buffer"
      ? await this.loadBufferAsset(id, definition.source)
      : await this.loadMediaAsset(id, definition.source);

    if (this.disposed) {
      asset.dispose();
      throw new Error("SoundManager has been disposed.");
    }

    this.assets.set(id, asset);
    return asset;
  }

  async loadMediaAsset(id, source) {
    const resource = await this.resourceManager.loadAudio(`audio:${id}`, source);
    resource.audio.loop = false;
    resource.audio.volume = this.volume;
    resource.audio.muted = true;
    resource.audio.pause();
    this.resetMediaToStart(resource.audio);
    return new SoundAsset({
      id,
      source: resource.source,
      mode: "media",
      audio: resource.audio
    });
  }

  async loadBufferAsset(id, source) {
    const audioContext = await this.ensureAudioContext();
    if (!audioContext) throw new Error("AudioContext unavailable.");

    const resource = await this.resourceManager.loadArrayBuffer(`audio-buffer:${id}`, source);
    const buffer = await audioContext.decodeAudioData(resource.arrayBuffer.slice(0));
    return new SoundAsset({
      id,
      source: resource.source,
      mode: "buffer",
      buffer
    });
  }

  async ensureAudioContext() {
    if (this.disposed) return null;
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      this.audioContext = new AudioContextClass();
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    return this.audioContext;
  }

  async enterGame() {
    if (this.disposed) return false;
    if (!this.state.ready) return false;
    if (this.bgmInstance?.playing) return true;
    if (this.playPromise) return this.playPromise;

    this.playPromise = this.playBgm()
      .finally(() => {
        this.playPromise = null;
      });

    return this.playPromise;
  }

  async playBgm() {
    if (this.disposed) return false;
    if (this.bgmInstance) this.bgmInstance.dispose();
    this.stopActiveBgm();

    try {
      const instance = await this.play("bgm_main_01", {
        loop: true,
        destroyOnEnd: false,
        volume: this.volume,
        restart: true,
        exclusive: true
      });
      this.bgmInstance = instance;
      window.__voidZeroActiveBgm = instance;
      this.state.playing = true;
      this.state.muted = false;
      this.state.error = null;
      return true;
    } catch (error) {
      this.state.playing = false;
      this.state.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async play(id, options = {}) {
    if (this.disposed) return null;
    const asset = await this.load(id, options.asset);
    const instanceOptions = {
      loop: options.loop ?? false,
      destroyOnEnd: options.destroyOnEnd ?? !options.loop,
      volume: options.volume ?? 1,
      restart: options.restart ?? true,
      exclusive: options.exclusive ?? false
    };

    const instance = asset.mode === "buffer"
      ? new BufferSoundInstance(this, asset, instanceOptions)
      : new MediaSoundInstance(this, asset, instanceOptions);

    this.instances.add(instance);
    const played = await instance.play();
    if (!played) {
      instance.dispose();
      return null;
    }

    return instance;
  }

  pause() {
    if (this.bgmInstance) this.bgmInstance.stop({ reset: false });
    this.state.playing = false;
  }

  stopActiveBgm() {
    const active = window.__voidZeroActiveBgm;
    if (!active || active === this.bgmInstance) return;

    if (typeof active.dispose === "function") {
      active.dispose();
    } else if (typeof active.pause === "function") {
      active.pause();
      active.currentTime = 0;
    }

    window.__voidZeroActiveBgm = null;
  }

  releaseInstance(instance) {
    this.instances.delete(instance);
    if (this.bgmInstance === instance) {
      this.bgmInstance = null;
      this.state.playing = false;
    }
    if (window.__voidZeroActiveBgm === instance) {
      window.__voidZeroActiveBgm = null;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    for (const instance of Array.from(this.instances)) {
      instance.dispose();
    }
    this.instances.clear();

    for (const asset of this.assets.values()) {
      asset.dispose();
    }
    this.assets.clear();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.bgmInstance = null;
    this.preloadPromise = null;
    this.playPromise = null;
    this.state.ready = false;
    this.state.playing = false;
    this.state.muted = true;
  }

  resetMediaToStart(audio) {
    try {
      audio.currentTime = 0;
    } catch {
      audio.addEventListener("loadedmetadata", () => {
        audio.currentTime = 0;
      }, { once: true });
    }
  }
}
