import * as THREE from "three";

const STREAK_COUNT = 160;
const TUNNEL_RADIUS = 470;
const MIN_RADIUS = 42;
const FRONT_Z = 1850;
const REAR_Z = -560;
const TUNNEL_LENGTH = FRONT_Z - REAR_Z;
const MAX_WARP = 10;

const _WORLD_FORWARD = new THREE.Vector3(0, 0, 1);

export class HyperdriveWarpLayer {
  constructor({ renderer }) {
    this.renderer = renderer;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this._active = false;
    this._warpFactor = 0;
    this._elapsed = 0;
    this._environmentMode = "dark";
    this._shipPosition = new THREE.Vector3();
    this._headingQuat = new THREE.Quaternion();
    this._scratchHeading = new THREE.Vector3();
    this._savedClearColor = new THREE.Color();

    this._streakScene = new THREE.Scene();
    this._postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._compositeScene = new THREE.Scene();
    this._vignetteScene = new THREE.Scene();

    this._streakTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false
    });

    this._buildStreaks();
    this._buildCompositePass();
    this._buildVignettePass();
  }

  // ─── builders ─────────────────────────────────────────────────────────────

  _buildStreaks() {
    const positions = new Float32Array(STREAK_COUNT * 6);
    const alphas = new Float32Array(STREAK_COUNT * 2);
    const data = [];

    for (let i = 0; i < STREAK_COUNT; i++) {
      this._resetStreak(data, alphas, i, false);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uWarp:   { value: 0 },
        uColorA: { value: new THREE.Color(0x63d2ff) },
        uColorB: { value: new THREE.Color(0xd8ecff) }
      },
      vertexShader: /* glsl */`
        attribute float alpha;
        varying float vAlpha;
        uniform float uWarp;
        void main() {
          vAlpha = alpha * (0.38 + clamp(uWarp / 10.0, 0.0, 1.0) * 1.05);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying float vAlpha;
        uniform float uWarp;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        void main() {
          float w = clamp(uWarp / 10.0, 0.0, 1.0);
          vec3 color = mix(uColorA, uColorB, 0.20 + 0.34 * w);
          gl_FragColor = vec4(color, vAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.name = "warp-streaks";
    lines.frustumCulled = false;
    this._streakScene.add(lines);

    this._streakData = data;
    this._positions = positions;
    this._alphas = alphas;
    this._lines = lines;
    this._streakGeo = geometry;
    this._streakMat = material;
  }

  _buildCompositePass() {
    this._compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse:    { value: null },
        uWarp:       { value: 0 },
        uTime:       { value: 0 },
        uResolution: { value: new THREE.Vector2(this.width, this.height) }
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uWarp;
        uniform float uTime;
        uniform vec2 uResolution;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
          vec2 center = vUv - 0.5;
          vec2 aspect = vec2(max(uResolution.x, 1.0) / max(uResolution.y, 1.0), 1.0);
          vec2 ws = center * aspect;
          float dist = length(ws);
          vec2 dir = normalize(ws + 0.0001);
          float w = clamp(uWarp / 10.0, 0.0, 1.0);

          float radial = smoothstep(0.04, 0.78, dist);
          float waveA  = sin(dist * 34.0 - uTime * (5.0 + 13.0 * w));
          float waveB  = sin(dist * 17.0 + uTime * (2.0 +  6.0 * w));
          float fn = noise(ws * 7.0 + vec2(uTime * 0.12, -uTime * 0.08)) - 0.5;

          vec2 lens  = dir * radial * w * (0.020 * waveA + 0.012 * waveB + 0.018 * dist * dist);
          vec2 shear = vec2(ws.y, -ws.x) * w * 0.014 * sin(uTime * 0.7 + dist * 6.0);
          vec2 turb  = vec2(fn, noise(ws * 9.0 - vec2(uTime * 0.14)) - 0.5) * w * 0.016;
          vec2 uv = clamp(vUv + (lens + shear + turb) / aspect, 0.0, 1.0);

          gl_FragColor = texture2D(tDiffuse, uv);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this._compositeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._compositeMat));
  }

  _buildVignettePass() {
    this._vignetteMat = new THREE.ShaderMaterial({
      uniforms: {
        uWarp:             { value: 0 },
        uTime:             { value: 0 },
        uResolution:       { value: new THREE.Vector2(this.width, this.height) },
        uVignetteBase:     { value: 0.28 },
        uVignetteWarp:     { value: 0.30 },
        uVignetteRadius:   { value: 0.43 },
        uVignetteSoftness: { value: 0.54 },
        uVignetteColor:    { value: new THREE.Color(0x030811) },
        uVignetteFrame:    { value: 0.36 },
        uVignetteFrameWidth: { value: 0.18 },
        uGrain:            { value: 0.016 }
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform float uWarp;
        uniform float uTime;
        uniform vec2  uResolution;
        uniform float uVignetteBase;
        uniform float uVignetteWarp;
        uniform float uVignetteRadius;
        uniform float uVignetteSoftness;
        uniform vec3  uVignetteColor;
        uniform float uVignetteFrame;
        uniform float uVignetteFrameWidth;
        uniform float uGrain;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          vec2 center = vUv - 0.5;
          vec2 aspect = vec2(max(uResolution.x, 1.0) / max(uResolution.y, 1.0), 1.0);
          vec2 ws = center * aspect;
          float w = clamp(uWarp / 10.0, 0.0, 1.0);

          float vp = 2.35;
          float vDist = pow(pow(abs(ws.x), vp) + pow(abs(ws.y), vp), 1.0 / vp);
          float vStart = max(0.05, uVignetteRadius - w * 0.035);
          float vEnd   = vStart + max(0.08, uVignetteSoftness - w * 0.07);
          float radialMask = smoothstep(vStart, vEnd, vDist);

          float fDist = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          float frameMask = (1.0 - smoothstep(0.0, uVignetteFrameWidth + w * 0.035, fDist)) * uVignetteFrame;
          float edgeMask = max(radialMask, frameMask);
          float pulse  = 1.0 + sin(uTime * (0.8 + w * 1.7) + vDist * 13.0) * 0.035 * w;
          float amount = clamp(edgeMask * pulse * (uVignetteBase + uVignetteWarp * w), 0.0, 1.0);

          float grain = (hash(vUv * uResolution + uTime) - 0.5) * uGrain * (0.25 + w);
          gl_FragColor = vec4(uVignetteColor + grain, amount);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false
    });
    this._vignetteScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._vignetteMat));
  }

  // ─── streak helpers ───────────────────────────────────────────────────────

  _resetStreak(data, alphas, i, nearFront) {
    const angle  = Math.random() * Math.PI * 2;
    const radius = MIN_RADIUS + Math.pow(Math.random(), 0.72) * (TUNNEL_RADIUS - MIN_RADIUS);
    data[i] = {
      angle,
      radius,
      z:      nearFront ? FRONT_Z - Math.random() * 160 : REAR_Z + Math.random() * TUNNEL_LENGTH,
      speed:  0.9 + Math.random() * 0.45,
      length: 18 + Math.random() * 18,
      swirl:  (Math.random() - 0.5) * 0.00015,
      alpha:  0.34 + Math.random() * 0.58,
      phase:  Math.random() * Math.PI * 2
    };
    alphas[i * 2]     = data[i].alpha;
    alphas[i * 2 + 1] = 0.0;
  }

  _tickStreaks(dt) {
    const { _streakData: data, _positions: pos, _alphas: alphas } = this;
    const wf    = this._warpFactor;
    const speed = 0.35 + wf * 4.8;
    const lw    = Math.min(wf / MAX_WARP, 1.0);

    for (let i = 0; i < STREAK_COUNT; i++) {
      const d = data[i];
      d.z -= speed * d.speed * (28.0 + Math.max(wf, 0.6) * 2.0) * dt;
      if (d.z < REAR_Z) this._resetStreak(data, alphas, i, true);

      const w          = Math.max(wf, 0.01);
      const swirlAngle = d.angle + d.swirl * d.z;
      const laneR      = d.radius + Math.sin(d.phase + d.z * 0.0025) * (0.8 + 2.5 * lw);
      const x = Math.cos(swirlAngle) * laneR;
      const y = Math.sin(swirlAngle) * laneR;
      const trailLen = d.length + w * 16.0 + w * w * 1.2;
      const base = i * 6;
      pos[base]     = x; pos[base + 1] = y; pos[base + 2] = d.z;
      pos[base + 3] = x; pos[base + 4] = y; pos[base + 5] = Math.min(FRONT_Z + 80, d.z + trailLen);
    }

    this._streakGeo.attributes.position.needsUpdate = true;
    this._streakMat.uniforms.uWarp.value = wf;
  }

  // ─── public API ───────────────────────────────────────────────────────────

  setEnvironmentPreset(preset) {
    const isLight = preset.id === "light";
    this._environmentMode = preset.id;

    this._streakMat.uniforms.uColorA.value.setHex(isLight ? 0x002f9f : 0x63d2ff);
    this._streakMat.uniforms.uColorB.value.setHex(isLight ? 0x004ed8 : 0xd8ecff);
    this._streakMat.blending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    this._streakMat.needsUpdate = true;

    this._compositeMat.blending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    this._compositeMat.needsUpdate = true;

    this._vignetteMat.uniforms.uVignetteBase.value      = isLight ? 0.30 : 0.28;
    this._vignetteMat.uniforms.uVignetteWarp.value      = isLight ? 0.75 : 0.62;
    this._vignetteMat.uniforms.uVignetteRadius.value    = isLight ? 0.46 : 0.42;
    this._vignetteMat.uniforms.uVignetteFrame.value     = isLight ? 1.0  : 0.86;
    this._vignetteMat.uniforms.uVignetteFrameWidth.value = isLight ? 0.25 : 0.21;
    this._vignetteMat.uniforms.uGrain.value             = isLight ? 0.006 : 0.022;
    this._vignetteMat.uniforms.uVignetteColor.value.setHex(preset.scene.background);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this._streakTarget.setSize(width, height);
    this._compositeMat.uniforms.uResolution.value.set(width, height);
    this._vignetteMat.uniforms.uResolution.value.set(width, height);
  }

  update(dt, warpVisualState) {
    this._active = warpVisualState.active;
    this._warpFactor = warpVisualState.intensity * MAX_WARP;

    if (!this._active) return;

    this._elapsed += dt;

    if (warpVisualState.shipPosition) {
      this._shipPosition.copy(warpVisualState.shipPosition);
    }

    if (warpVisualState.heading) {
      const h = warpVisualState.heading;
      this._scratchHeading.set(h.x, h.y, h.z).normalize();
      if (this._scratchHeading.lengthSq() > 0.001) {
        this._headingQuat.setFromUnitVectors(_WORLD_FORWARD, this._scratchHeading);
      }
    }

    this._tickStreaks(dt);
  }

  render(camera) {
    if (!this._active || this._warpFactor <= 0) return;

    this._lines.position.copy(this._shipPosition);
    this._lines.quaternion.copy(this._headingQuat);

    const r = this.renderer;
    const savedClearAlpha = r.getClearAlpha();
    r.getClearColor(this._savedClearColor);
    const savedAutoClear = r.autoClear;

    // Render streaks into streakTarget (transparent clear)
    r.setClearColor(0x000000, 0);
    r.autoClear = true;
    r.setRenderTarget(this._streakTarget);
    r.render(this._streakScene, camera);

    // Overlay passes onto screen — no auto-clear so game scene stays
    r.setClearColor(this._savedClearColor, savedClearAlpha);
    r.autoClear = false;
    r.setRenderTarget(null);

    this._compositeMat.uniforms.tDiffuse.value = this._streakTarget.texture;
    this._compositeMat.uniforms.uWarp.value    = this._warpFactor;
    this._compositeMat.uniforms.uTime.value    = this._elapsed;
    r.render(this._compositeScene, this._postCamera);

    this._vignetteMat.uniforms.uWarp.value  = this._warpFactor;
    this._vignetteMat.uniforms.uTime.value  = this._elapsed;
    r.render(this._vignetteScene, this._postCamera);

    r.autoClear = savedAutoClear;
  }

  dispose() {
    this._streakTarget.dispose();
    this._streakGeo.dispose();
    this._streakMat.dispose();
    this._compositeMat.dispose();
    this._vignetteMat.dispose();
    this._compositeScene.traverse(obj => { if (obj.isMesh) obj.geometry.dispose(); });
    this._vignetteScene.traverse(obj => { if (obj.isMesh) obj.geometry.dispose(); });
  }
}
