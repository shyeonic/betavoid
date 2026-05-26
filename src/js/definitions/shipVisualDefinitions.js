export const SHIP_VISUAL_IDS = {
  playerShip: "ship_01"
};

export const SHIP_VFX_LIGHT_IDS = {
  engine001: "vfx_light_engine_001",
  head001: "vfx_light_head_001",
  aux003: "vfx_light_aux_003",
  aux004: "vfx_light_aux_004",
  aux005: "vfx_light_aux_005",
  aux006: "vfx_light_aux_006"
};

const AUX_LIGHT_SETTINGS = {
  color: "#9b9bff",
  emissiveIntensity: 3,
  lightRangeScale: 2,
  minLightRange: 0.52,
  maxLightRange: 1.45,
  glowSpriteSpreadScale: 0.8,
  glowSpriteOpacity: 0.28,
  pointLightEnabled: false,
  pointIntensity: 0.2,
  pointRangeScale: 0.2
};

export const SHIP_VISUAL_DEFINITIONS = {
  [SHIP_VISUAL_IDS.playerShip]: {
    id: SHIP_VISUAL_IDS.playerShip,
    label: "ship_01",
    materials: {
      reflectionIntensity: 0.32,
      emissiveSurface: {
        materialName: "EmissiveMTL_light",
        fallbackColor: 0xffffff
      },
      highlights: {
        highlight_01: {
          id: "highlight_01",
          label: "Highlight_01",
          materialName: "Highlight_01",
          defaultColor: "#ff97c2"
        }
      }
    },
    vfx: {
      defaultLightType: SHIP_VFX_LIGHT_IDS.head001,
      engineOutput: {
        controlledLightType: SHIP_VFX_LIGHT_IDS.engine001,
        value: 100,
        min: {
          emissiveIntensity: 0.2,
          glowSpriteOpacity: 0.04,
          pointIntensity: 0.05
        }
      },
      lightParts: [
        {
          id: SHIP_VFX_LIGHT_IDS.engine001,
          label: "EmissivePlate_ship_01.001",
          objectMatches: ["EmissivePlate_ship_01.001"],
          settings: {
            color: "#9b9bff",
            emissiveIntensity: 12,
            lightRangeScale: 2,
            minLightRange: 0.18,
            maxLightRange: 0.95,
            glowSpriteSpreadScale: 1.5,
            glowSpriteOpacity: 0.58,
            pointLightEnabled: true,
            pointIntensity: 0.72,
            pointRangeScale: 0.86
          }
        },
        {
          id: SHIP_VFX_LIGHT_IDS.head001,
          label: "EmissivePlate_ship_01.002",
          objectMatches: ["EmissivePlate_ship_01.002"],
          settings: {
            color: "#ff0000",
            emissiveIntensity: 12,
            lightRangeScale: 2,
            minLightRange: 0.52,
            maxLightRange: 1.45,
            glowSpriteSpreadScale: 1.2,
            glowSpriteOpacity: 0.38,
            pointLightEnabled: false,
            pointIntensity: 0.52,
            pointRangeScale: 0.82
          }
        },
        {
          id: SHIP_VFX_LIGHT_IDS.aux003,
          label: "EmissivePlate_ship_01.003",
          objectMatches: ["EmissivePlate_ship_01.003"],
          settings: { ...AUX_LIGHT_SETTINGS }
        },
        {
          id: SHIP_VFX_LIGHT_IDS.aux004,
          label: "EmissivePlate_ship_01.004",
          objectMatches: ["EmissivePlate_ship_01.004"],
          settings: { ...AUX_LIGHT_SETTINGS }
        },
        {
          id: SHIP_VFX_LIGHT_IDS.aux005,
          label: "EmissivePlate_ship_01.005",
          objectMatches: ["EmissivePlate_ship_01.005"],
          settings: { ...AUX_LIGHT_SETTINGS }
        },
        {
          id: SHIP_VFX_LIGHT_IDS.aux006,
          label: "EmissivePlate_ship_01.006",
          objectMatches: ["EmissivePlate_ship_01.006"],
          settings: { ...AUX_LIGHT_SETTINGS }
        }
      ]
    }
  }
};

export function getShipVisualDefinition(shipId = SHIP_VISUAL_IDS.playerShip) {
  return SHIP_VISUAL_DEFINITIONS[shipId] || SHIP_VISUAL_DEFINITIONS[SHIP_VISUAL_IDS.playerShip];
}
