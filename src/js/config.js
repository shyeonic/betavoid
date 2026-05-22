export const CONFIG = {
  minSpeed: -20,
  maxSpeed: 100,
  reverseGaugePercent: 10,
  throttleAdjustRate: 36,
  accelerationRate: 24,
  decelerationRate: 32,
  pitchRate: 1.45,
  yawRate: 1.55,
  rollRate: 1.8,
  strafeRate: 45,
  verticalRate: 45,
  autopilotTurnRate: 1.45,
  arrivalRadius: 10,
  cameraDistance: 10,
  cameraFollowHeight: 2,
  cameraScreenYOffset: 0.3,
  cameraOrbitHeight: 0,
  cameraMinDistance: 6,
  cameraMaxDistance: 60,
  cameraOrbitSensitivity: 0.005,
  cameraZoomSensitivity: 0.018,
  cameraReturnDuration: 0.72,
  cameraRollRate: 9,
  cameraFxDistance: 2.15,
  cameraFxInRate: 7.5,
  cameraFxOutRate: 4.2,
  cameraActionInRate: 8.5,
  cameraActionOutRate: 5.2,
  cameraYawOffset: 0.72,
  cameraPitchOffset: 0.52,
  cameraStrafeOffset: 0.58,
  cameraVerticalOffset: 0.48,
  cameraRollSideOffset: 0.36,
  cameraRollDropOffset: 0.18
};

export const CONTROL_SETTINGS = {
  arrowPitchNormal: false
};

export const DEFAULT_KEY_BINDINGS = {
  throttleUp: "PageUp",
  throttleDown: "PageDown",
  maxSpeed: "Home",
  stopSpeed: "End",
  pitchUp: "ArrowUp",
  pitchDown: "ArrowDown",
  yawLeft: "ArrowLeft",
  yawRight: "ArrowRight",
  rollLeft: "KeyQ",
  rollRight: "KeyE",
  strafeLeft: "KeyA",
  strafeRight: "KeyD",
  ascend: "KeyW",
  descend: "KeyS",
  cameraToggle: "KeyC"
};

export const KEY_BINDING_GROUPS = [
  {
    title: "Flight",
    actions: [
      { id: "pitchUp", label: "Pitch Up" },
      { id: "pitchDown", label: "Pitch Down" },
      { id: "yawLeft", label: "Yaw Left" },
      { id: "yawRight", label: "Yaw Right" },
      { id: "rollLeft", label: "Roll Left" },
      { id: "rollRight", label: "Roll Right" }
    ]
  },
  {
    title: "Movement",
    actions: [
      { id: "strafeLeft", label: "Strafe Left" },
      { id: "strafeRight", label: "Strafe Right" },
      { id: "ascend", label: "Ascend" },
      { id: "descend", label: "Descend" }
    ]
  },
  {
    title: "Systems",
    actions: [
      { id: "throttleUp", label: "Throttle Up" },
      { id: "throttleDown", label: "Throttle Down" },
      { id: "maxSpeed", label: "Max Speed" },
      { id: "stopSpeed", label: "Stop" },
      { id: "cameraToggle", label: "Camera Mode" }
    ]
  }
];

export const ASSETS = {
  sounds: {
    mainBgm: new URL("../rss/sounds/bgm_main_01.ogg", import.meta.url).href,
    sectorBgm: new URL("../rss/sounds/bgm_sector_01.ogg", import.meta.url).href,
    dangerBgm: new URL("../rss/sounds/bgm_danger_01.ogg", import.meta.url).href,
    cameraToggle: new URL("../rss/sounds/sfx_data_01.ogg", import.meta.url).href
  },
  ships: {
    local: new URL("../rss/ships/ship_01.obj", import.meta.url).href,
    remoteFallback: "https://raw.githubusercontent.com/shyeonic/storage/8a7253eb0ff11db007c2c1d7056d840d56e73e7f/ship_01.obj"
  },
  worldModels: {
    gas_01: {
      obj: new URL("../rss/ore_planets/gas_01.obj", import.meta.url).href,
      mtl: new URL("../rss/ore_planets/gas_01.mtl", import.meta.url).href
    },
    ore_01: {
      obj: new URL("../rss/ore_planets/ore_01.obj", import.meta.url).href,
      mtl: new URL("../rss/ore_planets/ore_01.mtl", import.meta.url).href
    },
    water_01: {
      obj: new URL("../rss/ore_planets/water_01.obj", import.meta.url).href,
      mtl: new URL("../rss/ore_planets/water_01.mtl", import.meta.url).href
    },
    hq_01: {
      obj: new URL("../rss/buildings/hq_01.obj", import.meta.url).href,
      mtl: new URL("../rss/buildings/hq_01.mtl", import.meta.url).href
    }
  }
};
