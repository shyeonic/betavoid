export const ENVIRONMENT_SETTINGS_KEY = "environmentSettings";

export const ENVIRONMENT_MODES = {
  light: "light",
  dark: "dark"
};

export const BLOOM_QUALITY_MODES = {
  none: "none",
  low: "low",
  medium: "medium",
  high: "high"
};

export const BLOOM_RESOLUTION_SCALES = {
  [BLOOM_QUALITY_MODES.low]: 0.5,
  [BLOOM_QUALITY_MODES.medium]: 0.75,
  [BLOOM_QUALITY_MODES.high]: 1
};

export const RENDER_RESOLUTION_SCALES = [0.5, 0.75, 1];

export const DEFAULT_PERFORMANCE_SETTINGS = {
  materialMaps: true,
  renderResolutionScale: 1,
  bloomQuality: BLOOM_QUALITY_MODES.medium,
  lightingEffects: true,
  antialias: false
};

export const SPACE_ENVIRONMENT_PRESETS = {
  light: {
    id: ENVIRONMENT_MODES.light,
    renderer: {
      toneMapping: "linear",
      toneMappingExposure: 1.0
    },
    objectBloom: {
      enabled: true,
      layer: 1,
      strength: 0.2,
      radius: 0.05,
      threshold: 0.18,
      pixelRatioCap: 1,
      resolutionScale: 0.6
    },
    scene: {
      background: 0xf3fbff,
      fog: { type: "exp2", color: 0xe8f7ff, density: 0.00006 }
    },
    lights: {
      ambient: { color: 0xf2fbff, intensity: 0.9 },
      key: { color: 0xffffff, intensity: 6, position: [7, 8, 6] },
      rim: { color: 0x8fdcff, intensity: 0.55, position: [-8, 4, -8] },
      hemisphere: { skyColor: 0xf7fcff, groundColor: 0x8bb8c8, intensity: 0.45 }
    },
    worldMap: {
      bounds: {
        chunk: { color: 0xe7f2f9, opacity: 1 },
        sector: {
          opacity: 0.5,
          colors: {
            "SEC-001": 0xffbc66,
            "SEC-002": 0x63d2ff,
            "SEC-003": 0x82e3bd,
            "SEC-004": 0xa6ebff,
            "SEC-005": 0xb896ff,
            "SEC-006": 0xff6b6b,
            "SEC-007": 0xffd166,
            "SEC-008": 0x9ee7ff,
            "SEC-009": 0x7ee081,
            "SEC-010": 0xd9d9d9
          },
          fallbackColor: 0xffffff
        }
      }
    },
    targeting: {
      frame: {
        outerColor: "#0000ff",
        outerOpacity: 0.15,
        innerColor: "#0000ff",
        innerOpacity: 0.45
      }
    },
    starField: {
      layers: [
        { count: 1800, radius: 8500, size: 32.8, opacity: 0.98 },
        { count: 900, radius: 24000, size: 51.2, opacity: 0.74 },
        { count: 420, radius: 52000, size: 73.6, opacity: 0.5 }
      ]
    }
  },
  dark: {
    id: ENVIRONMENT_MODES.dark,
    renderer: {
      toneMapping: "acesFilmic",
      toneMappingExposure: 0.82
    },
    objectBloom: {
      enabled: true,
      layer: 1,
      strength: 0.2,
      radius: 0.05,
      threshold: 0.18,
      pixelRatioCap: 1,
      resolutionScale: 0.6
    },
    scene: {
      background: 0x030811,
      fog: { type: "exp2", color: 0x05101b, density: 0.00004 }
    },
    lights: {
      ambient: { color: 0x9fb9d8, intensity: 0.28 },
      key: { color: 0xd9f1ff, intensity: 0.36, position: [7, 8, 6] },
      rim: { color: 0x5cc8ff, intensity: 0.32, position: [-8, 4, -8] },
      hemisphere: { skyColor: 0x93b6d5, groundColor: 0x08131c, intensity: 0.18 }
    },
    worldMap: {
      bounds: {
        chunk: { color: 0x404040, opacity: 1 },
        sector: {
          opacity: 0.5,
          colors: {
            "SEC-001": 0xffbc66,
            "SEC-002": 0x63d2ff,
            "SEC-003": 0x82e3bd,
            "SEC-004": 0xa6ebff,
            "SEC-005": 0xb896ff,
            "SEC-006": 0xff6b6b,
            "SEC-007": 0xffd166,
            "SEC-008": 0x9ee7ff,
            "SEC-009": 0x7ee081,
            "SEC-010": 0xd9d9d9
          },
          fallbackColor: 0xffffff
        }
      }
    },
    targeting: {
      frame: {
        outerColor: "#00ff66",
        outerOpacity: 0.45,
        innerColor: "#00ff66",
        innerOpacity: 0.75
      }
    },
    starField: {
      layers: [
        { count: 1800, radius: 8500, size: 32.8, opacity: 0.98 },
        { count: 900, radius: 24000, size: 51.2, opacity: 0.74 },
        { count: 420, radius: 52000, size: 73.6, opacity: 0.5 }
      ]
    }
  }
};

export function normalizeEnvironmentMode(mode) {
  return mode === ENVIRONMENT_MODES.dark ? ENVIRONMENT_MODES.dark : ENVIRONMENT_MODES.light;
}

export function normalizeBloomQualityMode(mode) {
  return Object.values(BLOOM_QUALITY_MODES).includes(mode)
    ? mode
    : DEFAULT_PERFORMANCE_SETTINGS.bloomQuality;
}

export function getBloomResolutionScale(mode) {
  return BLOOM_RESOLUTION_SCALES[normalizeBloomQualityMode(mode)] ?? 0;
}

export function normalizeRenderResolutionScale(scale) {
  const value = Number(scale);
  return RENDER_RESOLUTION_SCALES.includes(value)
    ? value
    : DEFAULT_PERFORMANCE_SETTINGS.renderResolutionScale;
}

export function normalizePerformanceSettings(settings = {}, legacyRenderQualityMode = null) {
  const source = settings && typeof settings === "object" ? settings : {};
  const legacyBloomDisabled = legacyRenderQualityMode === "performance" || source.bloom === false;
  const bloomQuality = legacyBloomDisabled
    ? BLOOM_QUALITY_MODES.none
    : normalizeBloomQualityMode(source.bloomQuality);
  return {
    materialMaps: source.materialMaps !== false,
    renderResolutionScale: normalizeRenderResolutionScale(source.renderResolutionScale),
    bloomQuality,
    lightingEffects: source.lightingEffects !== false,
    antialias: source.antialias === true
  };
}
