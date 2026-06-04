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
  constructor({ renderer, scene = null }) {
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
    this._scene = null;

    this._root = new THREE.Group();
    this._root.name = "hyperdrive-warp-scene-effect";
    this._root.visible = false;
    this._root.userData.ignoreRaycast = true;

    this._postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._vignetteScene = new THREE.Scene();

    this._buildStreaks();
    this._buildVignettePass();
    if (scene) this.attachToScene(scene);
  }

  _buildStreaks() {
    const positions = new Float32Array(STREAK_COUNT * 6);
    const alphas = new Float32Array(STREAK_COUNT * 2);
    const data = [];

    for (let i = 0; i < STREAK_COUNT; i += 1) {
      this._resetStreak(data, alphas, i, false);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uWarp: { value: 0 },
        uColorA: { value: new THREE.Color(0x63d2ff) },
        uColorB: { value: new THREE.Color(0xd8ecff) }
      },
      vertexShader: /* glsl */`
        attribute float alpha;
        varying float vAlpha;
        uniform float uWarp;

        void main() {
          vAlpha = alpha * (0.24 + clamp(uWarp / 10.0, 0.0, 1.0) * 0.55);
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
      depthTest: true
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.name = "warp-streaks";
    lines.frustumCulled = false;
    lines.userData.ignoreRaycast = true;
    lines.raycast = () => {};
    this._root.add(lines);

    this._streakData = data;
    this._positions = positions;
    this._alphas = alphas;
    this._lines = lines;
    this._streakGeo = geometry;
    this._streakMat = material;
  }

  _buildVignettePass() {
    const geometry = new THREE.PlaneGeometry(2, 2);
    this._vignetteMat = new THREE.ShaderMaterial({
      uniforms: {
        uWarp: { value: 0 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uVignetteBase: { value: 0.28 },
        uVignetteWarp: { value: 0.30 },
        uVignetteRadius: { value: 0.43 },
        uVignetteSoftness: { value: 0.54 },
        uVignetteColor: { value: new THREE.Color(0x030811) },
        uVignetteFrame: { value: 0.36 },
        uVignetteFrameWidth: { value: 0.18 },
        uGrain: { value: 0.016 }
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uWarp;
        uniform float uTime;
        uniform vec2 uResolution;
        uniform float uVignetteBase;
        uniform float uVignetteWarp;
        uniform float uVignetteRadius;
        uniform float uVignetteSoftness;
        uniform vec3 uVignetteColor;
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
          float vEnd = vStart + max(0.08, uVignetteSoftness - w * 0.07);
          float radialMask = smoothstep(vStart, vEnd, vDist);

          float fDist = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          float frameMask = (1.0 - smoothstep(0.0, uVignetteFrameWidth + w * 0.035, fDist)) * uVignetteFrame;
          float edgeMask = max(radialMask, frameMask);
          float pulse = 1.0 + sin(uTime * (0.8 + w * 1.7) + vDist * 13.0) * 0.035 * w;
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
    this._vignetteScene.add(new THREE.Mesh(geometry, this._vignetteMat));
  }

  _resetStreak(data, alphas, i, nearFront) {
    const angle = Math.random() * Math.PI * 2;
    const radius = MIN_RADIUS + Math.pow(Math.random(), 0.72) * (TUNNEL_RADIUS - MIN_RADIUS);
    data[i] = {
      angle,
      radius,
      z: nearFront ? FRONT_Z - Math.random() * 160 : REAR_Z + Math.random() * TUNNEL_LENGTH,
      speed: 0.9 + Math.random() * 0.45,
      length: 18 + Math.random() * 18,
      swirl: (Math.random() - 0.5) * 0.00015,
      alpha: 0.34 + Math.random() * 0.58,
      phase: Math.random() * Math.PI * 2,
      ripple: 0.72 + Math.random() * 0.56
    };
    alphas[i * 2] = data[i].alpha;
    alphas[i * 2 + 1] = 0.0;
  }

  _tickStreaks(dt) {
    const { _streakData: data, _positions: pos, _alphas: alphas } = this;
    const wf = this._warpFactor;
    const speed = 0.35 + wf * 4.8;
    const lw = Math.min(wf / MAX_WARP, 1.0);
    const ripple = lw * lw;
    const time = this._elapsed;

    for (let i = 0; i < STREAK_COUNT; i += 1) {
      const d = data[i];
      d.z -= speed * d.speed * (28.0 + Math.max(wf, 0.6) * 2.0) * dt;
      if (d.z < REAR_Z) this._resetStreak(data, alphas, i, true);

      const w = Math.max(wf, 0.01);
      const headPhase = d.phase + d.z * 0.0058 - time * (2.8 + 5.8 * lw);
      const crossPhase = d.phase * 0.63 + d.angle * 2.4 + d.z * 0.0021 + time * (1.1 + 2.3 * lw);
      const tunnelPulse = Math.sin(time * (0.9 + 1.4 * lw) + d.angle * 3.0 + d.z * 0.0016);
      const radialRipple = (
        Math.sin(headPhase) * 11.0 +
        Math.sin(crossPhase) * 5.4 +
        tunnelPulse * 3.1
      ) * ripple * d.ripple;
      const angularRipple = (
        Math.sin(headPhase + Math.PI * 0.5) * 0.026 +
        Math.sin(crossPhase) * 0.016
      ) * ripple;
      const swirlAngle = d.angle + d.swirl * d.z + angularRipple;
      const laneR = d.radius + Math.sin(d.phase + d.z * 0.0025) * (0.8 + 2.5 * lw) + radialRipple;
      const x = Math.cos(swirlAngle) * laneR;
      const y = Math.sin(swirlAngle) * laneR;
      const trailLen = d.length + w * 16.0 + w * w * 1.2;
      const zTail = Math.min(FRONT_Z + 80, d.z + trailLen);
      const tailPhase = d.phase + zTail * 0.0058 - time * (2.8 + 5.8 * lw);
      const tailCrossPhase = d.phase * 0.63 + d.angle * 2.4 + zTail * 0.0021 + time * (1.1 + 2.3 * lw);
      const tailRipple = (
        Math.sin(tailPhase) * 11.0 +
        Math.sin(tailCrossPhase) * 5.4 +
        tunnelPulse * 3.1
      ) * ripple * d.ripple;
      const tailAngle = d.angle + d.swirl * zTail + (
        Math.sin(tailPhase + Math.PI * 0.5) * 0.026 +
        Math.sin(tailCrossPhase) * 0.016
      ) * ripple;
      const tailR = d.radius + Math.sin(d.phase + zTail * 0.0025) * (0.8 + 2.5 * lw) + tailRipple;
      const tailX = Math.cos(tailAngle) * tailR;
      const tailY = Math.sin(tailAngle) * tailR;
      const alphaPulse = 1.0 + Math.sin(headPhase - time * 0.6) * 0.22 * ripple;
      const base = i * 6;
      pos[base] = x;
      pos[base + 1] = y;
      pos[base + 2] = d.z;
      pos[base + 3] = tailX;
      pos[base + 4] = tailY;
      pos[base + 5] = zTail;
      alphas[i * 2] = THREE.MathUtils.clamp(d.alpha * alphaPulse, 0.0, 1.0);
    }

    this._streakGeo.attributes.position.needsUpdate = true;
    this._streakGeo.attributes.alpha.needsUpdate = true;
    this._streakMat.uniforms.uWarp.value = wf;
  }

  attachToScene(scene) {
    if (!scene || this._scene === scene) return;
    this.detachFromScene();
    this._scene = scene;
    scene.add(this._root);
  }

  detachFromScene() {
    if (!this._scene) return;
    this._scene.remove(this._root);
    this._scene = null;
  }

  setEnvironmentPreset(preset) {
    const isLight = preset.id === "light";
    this._environmentMode = preset.id;

    this._streakMat.uniforms.uColorA.value.setHex(isLight ? 0x002f9f : 0x3c7e99);
    this._streakMat.uniforms.uColorB.value.setHex(isLight ? 0x004ed8 : 0x9eadba);
    this._streakMat.blending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    this._streakMat.needsUpdate = true;

    this._vignetteMat.uniforms.uVignetteBase.value = isLight ? 0.30 : 0.28;
    this._vignetteMat.uniforms.uVignetteWarp.value = isLight ? 0.75 : 0.62;
    this._vignetteMat.uniforms.uVignetteRadius.value = isLight ? 0.46 : 0.42;
    this._vignetteMat.uniforms.uVignetteFrame.value = isLight ? 1.0 : 0.86;
    this._vignetteMat.uniforms.uVignetteFrameWidth.value = isLight ? 0.25 : 0.21;
    this._vignetteMat.uniforms.uGrain.value = isLight ? 0.006 : 0.022;
    this._vignetteMat.uniforms.uVignetteColor.value.setHex(preset.scene.background);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this._vignetteMat.uniforms.uResolution.value.set(width, height);
  }

  update(dt, warpVisualState) {
    this._active = warpVisualState.active;
    this._warpFactor = warpVisualState.intensity * MAX_WARP;
    this._root.visible = this._active && this._warpFactor > 0.01;

    if (!this._root.visible) return;

    this._elapsed += dt;

    if (warpVisualState.shipPosition) {
      this._shipPosition.copy(warpVisualState.shipPosition);
    }

    if (warpVisualState.shipQuaternion) {
      this._headingQuat.copy(warpVisualState.shipQuaternion).normalize();
    } else if (warpVisualState.heading) {
      const h = warpVisualState.heading;
      this._scratchHeading.set(h.x, h.y, h.z).normalize();
      if (this._scratchHeading.lengthSq() > 0.001) {
        this._headingQuat.setFromUnitVectors(_WORLD_FORWARD, this._scratchHeading);
      }
    }

    this._root.position.copy(this._shipPosition);
    this._root.quaternion.copy(this._headingQuat);
    this._root.scale.setScalar(1.0 + Math.sin(this._elapsed * 1.7) * 0.016 * Math.min(this._warpFactor / MAX_WARP, 1.0));
    this._tickStreaks(dt);
  }

  render() {
    if (!this._active || this._warpFactor <= 0) return;

    const r = this.renderer;
    const savedClearAlpha = r.getClearAlpha();
    const savedAutoClear = r.autoClear;
    r.getClearColor(this._savedClearColor);

    r.setClearColor(this._savedClearColor, savedClearAlpha);
    r.autoClear = false;
    r.setRenderTarget(null);

    this._vignetteMat.uniforms.uWarp.value = this._warpFactor;
    this._vignetteMat.uniforms.uTime.value = this._elapsed;
    r.render(this._vignetteScene, this._postCamera);

    r.autoClear = savedAutoClear;
  }

  dispose() {
    this.detachFromScene();
    this._streakGeo.dispose();
    this._streakMat.dispose();
    this._vignetteMat.dispose();
    this._vignetteScene.traverse((object) => {
      if (object.isMesh) object.geometry.dispose();
    });
  }
}
