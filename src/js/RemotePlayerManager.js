import * as THREE from "three";
import { deriveMovementState } from "./navigationKinematics.js";

const MANUAL_EXTRAPOLATION_LIMIT_SEC = 2;
const POSITION_SMOOTHING_RATE = 8;
const ROTATION_SMOOTHING_RATE = 10;

export class RemotePlayerManager {
  constructor({
    scene,
    resourceManager,
    shipDefinitions,
    defaultShipId = "ship_01",
    toRenderVector,
    registerStylizedRenderTarget = null,
    unregisterStylizedRenderTarget = null
  } = {}) {
    this.scene = scene;
    this.resourceManager = resourceManager;
    this.shipDefinitions = shipDefinitions || {};
    this.defaultShipId = defaultShipId;
    this.toRenderVector = toRenderVector;
    this.registerStylizedRenderTarget = registerStylizedRenderTarget;
    this.unregisterStylizedRenderTarget = unregisterStylizedRenderTarget;
    this.peers = new Map();
    this.fieldPeerIds = new Set();
    this.presencePeerIds = new Set();
    this.disposed = false;
    this.scratch = {
      dataPosition: new THREE.Vector3(),
      targetPosition: new THREE.Vector3(),
      targetQuaternion: new THREE.Quaternion(),
      routeDirection: new THREE.Vector3(),
      lookMatrix: new THREE.Matrix4(),
      origin: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0)
    };
  }

  handlePresenceMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "hello") {
      if (Array.isArray(message.field_peers)) {
        this.replaceFieldPeers(message.field_peers);
      }
      this.replacePresencePeers(message.peers || []);
      return;
    }
    if (message.type === "peer_left") {
      this.removePeerSource(message.character_id, "presence");
      return;
    }
    if (
      message.type === "peer_joined"
      || message.type === "peer_pose"
      || message.type === "peer_route"
    ) {
      this.upsertPeer(message.peer, "presence");
    }
  }

  replacePeers(peers) {
    this.replacePresencePeers(peers);
  }

  replacePresencePeers(peers) {
    this.replacePeerSource(peers, "presence");
  }

  replaceFieldPeers(peers) {
    this.replacePeerSource(peers, "field");
  }

  replacePeerSource(peers, source) {
    const incomingIds = new Set(peers.map((peer) => peer?.character_id).filter(Boolean));
    const sourceIds = source === "field" ? this.fieldPeerIds : this.presencePeerIds;
    for (const characterId of [...sourceIds]) {
      if (!incomingIds.has(characterId)) this.removePeerSource(characterId, source);
    }
    peers.forEach((peer) => this.upsertPeer(peer, source));
  }

  upsertPeer(peer, source = "presence") {
    const characterId = String(peer?.character_id || "");
    if (!characterId) return;
    const previous = this.peers.get(characterId);
    const sourceKey = source === "field" ? "fieldPeer" : "presencePeer";
    if (
      previous?.[sourceKey]
      && Number(peer.updated_at) < Number(previous[sourceKey].updated_at)
    ) {
      return;
    }

    const state = previous || this.createPeerState(characterId);
    state[sourceKey] = {
      ...(state[sourceKey] || {}),
      ...peer,
      pose: peer.pose ?? state[sourceKey]?.pose ?? null,
      route: peer.route === null ? null : (peer.route ?? state[sourceKey]?.route ?? null)
    };
    state.peer = this.selectEffectivePeer(state);
    this.peers.set(characterId, state);
    (source === "field" ? this.fieldPeerIds : this.presencePeerIds).add(characterId);

    const shipId = this.resolveShipId(state.peer.ship_id);
    if (state.shipId !== shipId) {
      state.shipId = shipId;
      void this.loadPeerModel(state);
    }
    this.ensurePeerRoot(state);
  }

  createPeerState(characterId) {
    return {
      characterId,
      peer: null,
      fieldPeer: null,
      presencePeer: null,
      root: null,
      model: null,
      label: null,
      shipId: null,
      loadRevision: 0,
      initialized: false
    };
  }

  selectEffectivePeer(state) {
    const authority = state.fieldPeer;
    const presence = state.presencePeer;
    if (!authority) return presence;
    if (!presence || authority.route?.authority) return authority;

    const presenceIsNewer = Number(presence.updated_at) > Number(authority.updated_at);
    return {
      ...presence,
      ...authority,
      pose: presenceIsNewer && presence.pose ? presence.pose : authority.pose,
      route: authority.route
    };
  }

  ensurePeerRoot(state) {
    if (state.root || (!state.peer?.pose && !state.peer?.route)) return;
    const root = new THREE.Group();
    root.name = `remote-player:${state.characterId}`;
    root.visible = false;
    state.root = root;
    state.label = createPlayerLabel(state.peer.display_name || "Pilot");
    root.add(state.label);
    this.scene.add(root);
  }

  async loadPeerModel(state) {
    const revision = ++state.loadRevision;
    try {
      const modelId = this.getShipModelId(state.shipId);
      const result = await this.resourceManager.loadShipModel(modelId, { silent: true });
      if (this.disposed || revision !== state.loadRevision || !this.peers.has(state.characterId)) return;
      this.ensurePeerRoot(state);
      if (!state.root) return;
      if (state.model) state.root.remove(state.model);
      const model = result.object.clone(true);
      model.name = `remote-ship:${state.shipId}`;
      model.rotation.y = Math.PI;
      state.model = model;
      state.root.add(model);
      this.registerStylizedRenderTarget?.(state.root);
    } catch (error) {
      console.warn(`[presence] remote ship ${state.shipId} unavailable.`, error);
    }
  }

  update(dt, now = Date.now()) {
    if (this.disposed) return;
    const positionAlpha = 1 - Math.exp(-Math.max(0, dt) * POSITION_SMOOTHING_RATE);
    const rotationAlpha = 1 - Math.exp(-Math.max(0, dt) * ROTATION_SMOOTHING_RATE);

    for (const state of this.peers.values()) {
      if (!state.root) continue;
      const target = this.derivePeerTarget(state.peer, now);
      if (!target) {
        state.root.visible = false;
        continue;
      }

      state.root.visible = true;
      if (!state.initialized) {
        state.root.position.copy(target.position);
        state.root.quaternion.copy(target.quaternion);
        state.initialized = true;
      } else {
        state.root.position.lerp(target.position, positionAlpha);
        state.root.quaternion.slerp(target.quaternion, rotationAlpha).normalize();
      }
    }
  }

  derivePeerTarget(peer, now) {
    if (peer?.route) return this.deriveRouteTarget(peer.route, peer.pose, now);
    if (!peer?.pose) return null;

    const pose = peer.pose;
    const elapsedSec = Math.min(
      MANUAL_EXTRAPOLATION_LIMIT_SEC,
      Math.max(0, (now - Number(pose.server_at || now)) / 1000)
    );
    this.scratch.dataPosition.set(
      Number(pose.position?.x) || 0,
      Number(pose.position?.y) || 0,
      Number(pose.position?.z) || 0
    );
    this.scratch.dataPosition.x += (Number(pose.velocity?.x) || 0) * elapsedSec;
    this.scratch.dataPosition.y += (Number(pose.velocity?.y) || 0) * elapsedSec;
    this.scratch.dataPosition.z += (Number(pose.velocity?.z) || 0) * elapsedSec;
    const position = this.toRenderVector(this.scratch.dataPosition);
    const quaternion = this.scratch.targetQuaternion.set(
      Number(pose.rotation?.x) || 0,
      Number(pose.rotation?.y) || 0,
      Number(pose.rotation?.z) || 0,
      Number.isFinite(Number(pose.rotation?.w)) ? Number(pose.rotation.w) : 1
    ).normalize();
    return { position, quaternion };
  }

  deriveRouteTarget(route, fallbackPose, now) {
    if (route.authority) {
      const derived = deriveMovementState(route, now);
      this.scratch.dataPosition.set(
        Number(derived.position?.x) || 0,
        Number(derived.position?.y) || 0,
        Number(derived.position?.z) || 0
      );
      const position = this.toRenderVector(this.scratch.dataPosition);
      const quaternion = this.scratch.targetQuaternion;
      const heading = route.heading;
      if (derived.phase !== "stopping" && heading) {
        this.scratch.routeDirection.set(
          Number(heading.x) || 0,
          Number(heading.y) || 0,
          Number(heading.z) || 0
        );
        if (this.scratch.routeDirection.lengthSq() > 1e-9) {
          this.scratch.lookMatrix.lookAt(
            this.scratch.routeDirection.normalize(),
            this.scratch.origin,
            this.scratch.up
          );
          quaternion.setFromRotationMatrix(this.scratch.lookMatrix).normalize();
        } else {
          quaternion.identity();
        }
      } else if (fallbackPose?.rotation) {
        quaternion.set(
          Number(fallbackPose.rotation.x) || 0,
          Number(fallbackPose.rotation.y) || 0,
          Number(fallbackPose.rotation.z) || 0,
          Number.isFinite(Number(fallbackPose.rotation.w)) ? Number(fallbackPose.rotation.w) : 1
        ).normalize();
      } else {
        quaternion.identity();
      }
      return { position, quaternion };
    }

    const from = route.from_position || fallbackPose?.position;
    const target = route.target;
    if (!from || !target) return fallbackPose ? this.derivePeerTarget({ pose: fallbackPose }, now) : null;

    const departAt = Number(route.depart_at) || now;
    const arriveAt = Math.max(departAt, Number(route.arrive_at) || departAt);
    const duration = Math.max(1, arriveAt - departAt);
    const progress = THREE.MathUtils.clamp((now - departAt) / duration, 0, 1);
    const eased = route.route_type === "hyperdrive"
      ? easeInOutCubic(progress)
      : smoothstep(progress);
    this.scratch.dataPosition.set(
      THREE.MathUtils.lerp(Number(from.x) || 0, Number(target.x) || 0, eased),
      THREE.MathUtils.lerp(Number(from.y) || 0, Number(target.y) || 0, eased),
      THREE.MathUtils.lerp(Number(from.z) || 0, Number(target.z) || 0, eased)
    );
    const position = this.toRenderVector(this.scratch.dataPosition);

    this.scratch.routeDirection.set(
      (Number(target.x) || 0) - (Number(from.x) || 0),
      (Number(target.y) || 0) - (Number(from.y) || 0),
      (Number(target.z) || 0) - (Number(from.z) || 0)
    );
    const quaternion = this.scratch.targetQuaternion;
    if (this.scratch.routeDirection.lengthSq() > 1e-9) {
      this.scratch.lookMatrix.lookAt(
        this.scratch.routeDirection.normalize(),
        this.scratch.origin,
        this.scratch.up
      );
      quaternion.setFromRotationMatrix(this.scratch.lookMatrix).normalize();
    } else if (fallbackPose?.rotation) {
      quaternion.set(
        Number(fallbackPose.rotation.x) || 0,
        Number(fallbackPose.rotation.y) || 0,
        Number(fallbackPose.rotation.z) || 0,
        Number.isFinite(Number(fallbackPose.rotation.w)) ? Number(fallbackPose.rotation.w) : 1
      ).normalize();
    } else {
      quaternion.identity();
    }
    return { position, quaternion };
  }

  removePeer(characterId) {
    const state = this.peers.get(characterId);
    if (!state) return;
    state.loadRevision += 1;
    if (state.root) {
      this.unregisterStylizedRenderTarget?.(state.root);
      this.scene.remove(state.root);
    }
    disposePlayerLabel(state.label);
    this.peers.delete(characterId);
    this.fieldPeerIds.delete(characterId);
    this.presencePeerIds.delete(characterId);
  }

  removePeerSource(characterId, source) {
    const state = this.peers.get(characterId);
    const sourceIds = source === "field" ? this.fieldPeerIds : this.presencePeerIds;
    sourceIds.delete(characterId);
    if (!state) return;
    if (source === "field") state.fieldPeer = null;
    else state.presencePeer = null;
    state.peer = this.selectEffectivePeer(state);
    if (!state.peer) {
      this.removePeer(characterId);
      return;
    }
    const shipId = this.resolveShipId(state.peer.ship_id);
    if (state.shipId !== shipId) {
      state.shipId = shipId;
      void this.loadPeerModel(state);
    }
  }

  clear() {
    [...this.peers.keys()].forEach((characterId) => this.removePeer(characterId));
  }

  getPeerCount() {
    return this.peers.size;
  }

  getPeerSnapshot(characterId) {
    const state = this.peers.get(characterId);
    if (!state) return null;
    return {
      characterId,
      shipId: state.shipId,
      visible: Boolean(state.root?.visible),
      position: state.root
        ? { x: state.root.position.x, y: state.root.position.y, z: state.root.position.z }
        : null,
      route: state.peer?.route || null
    };
  }

  resolveShipId(shipId) {
    return this.shipDefinitions[shipId] ? shipId : this.defaultShipId;
  }

  getShipModelId(shipId) {
    const visual = this.shipDefinitions[shipId]?.visual || {};
    return visual.model_id || visual.modelId || shipId;
  }

  dispose() {
    this.disposed = true;
    this.clear();
  }
}

function createPlayerLabel(displayName) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(8, 16, 24, 0.78)";
  context.fillRect(2, 10, 252, 44);
  context.strokeStyle = "rgba(128, 222, 255, 0.85)";
  context.lineWidth = 2;
  context.strokeRect(2, 10, 252, 44);
  context.fillStyle = "#f3fbff";
  context.font = "600 22px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(displayName || "Pilot").slice(0, 28), 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = "remote-player-label";
  sprite.position.set(0, 7.5, 0);
  sprite.scale.set(13, 3.25, 1);
  sprite.userData.labelTexture = texture;
  return sprite;
}

function disposePlayerLabel(label) {
  if (!label) return;
  label.userData?.labelTexture?.dispose?.();
  label.material?.dispose?.();
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
