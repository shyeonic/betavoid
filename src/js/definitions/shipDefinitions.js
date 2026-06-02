import { SHIP_VISUAL_DEFINITIONS } from "./shipVisualDefinitions.js";

export const DEFAULT_SHIP_ID = "ship_01";

export const SHIP_DEFINITIONS = {
  ship_01: {
    id: "ship_01",
    labelKey: "ui.settings.gameplay.ship01",
    fallbackLabel: "Ship I",
    specs: {
      maxSpeed: 100,
      minSpeed: -20,
      accelerationRate: 24,
      decelerationRate: 32,
      throttleAdjustRate: 36,
      arrivalRadius: 10,
      deactivationCoastDuration: 600,
      pitchRate: 1.45,
      yawRate: 1.55,
      rollRate: 1.8,
      strafeRate: 45,
      verticalRate: 45
    },
    visual: SHIP_VISUAL_DEFINITIONS.ship_01
  },

  ship_02: {
    id: "ship_02",
    labelKey: "ui.settings.gameplay.ship02",
    fallbackLabel: "Ship II",
    specs: {
      maxSpeed: 100,
      minSpeed: -20,
      accelerationRate: 24,
      decelerationRate: 32,
      throttleAdjustRate: 36,
      arrivalRadius: 10,
      deactivationCoastDuration: 600,
      pitchRate: 1.45,
      yawRate: 1.55,
      rollRate: 1.8,
      strafeRate: 45,
      verticalRate: 45
    },
    visual: SHIP_VISUAL_DEFINITIONS.ship_02
  }
};

export function getShipDefinition(shipId) {
  return SHIP_DEFINITIONS[shipId] ?? SHIP_DEFINITIONS[DEFAULT_SHIP_ID];
}

export function getShipSpecs(shipId) {
  return getShipDefinition(shipId).specs;
}
