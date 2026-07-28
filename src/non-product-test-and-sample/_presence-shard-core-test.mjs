import assert from "node:assert/strict";
import { PresenceShard } from "../workers/beta-void-api/src/presence-shard.js";

class FakeContext {
  constructor(sockets) {
    this.sockets = sockets;
  }

  getWebSockets() {
    return this.sockets;
  }
}

class FakeSocket {
  constructor(attachment) {
    this.attachment = attachment;
    this.sent = [];
    this.closed = null;
  }

  deserializeAttachment() {
    return this.attachment;
  }

  serializeAttachment(value) {
    this.attachment = value;
  }

  send(message) {
    this.sent.push(message);
  }

  close(code, reason) {
    this.closed = { code, reason };
  }
}

const alpha = new FakeSocket({
  character_id: "firebase-alpha",
  display_name: "Alpha",
  ship_id: "ship_01",
  zone_id: "SEC-001",
  connected_at: 1,
  updated_at: 1,
  last_message_at: 0,
  pose: null,
  route: null
});
const beta = new FakeSocket({
  character_id: "firebase-beta",
  display_name: "Beta",
  ship_id: "ship_01",
  zone_id: "SEC-001",
  connected_at: 1,
  updated_at: 1,
  last_message_at: 0,
  pose: null,
  route: null
});
const context = new FakeContext([alpha, beta]);
const shard = new PresenceShard(context, {});

await shard.webSocketMessage(alpha, JSON.stringify({
  type: "pose",
  seq: 1,
  ship_id: "ship_01",
  position: { x: 10, y: 20, z: 30 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  velocity: { x: 2, y: 0, z: 0 },
  speed: 2
}));

assert.equal(alpha.deserializeAttachment().pose.seq, 1);
assert.equal(alpha.deserializeAttachment().route, null);
assert.equal(JSON.parse(beta.sent.at(-1)).type, "peer_pose");
assert.equal(JSON.parse(beta.sent.at(-1)).peer.character_id, "firebase-alpha");

alpha.deserializeAttachment().last_message_at = 0;
await shard.webSocketMessage(alpha, JSON.stringify({
  type: "route",
  action_id: "NAV-001",
  route_type: "standard",
  ship_id: "ship_01",
  from_position: { x: 10, y: 20, z: 30 },
  target: { x: 100, y: 20, z: 30 },
  depart_delay_ms: 1000,
  duration_ms: 5000
}));

const route = alpha.deserializeAttachment().route;
assert.equal(route.action_id, "NAV-001");
assert.equal(route.arrive_at - route.depart_at, 5000);
assert.equal(JSON.parse(beta.sent.at(-1)).type, "peer_route");

const peers = shard.currentPeers("firebase-alpha");
assert.equal(peers.length, 1);
assert.equal(peers[0].character_id, "firebase-beta");

await shard.webSocketClose(alpha);
assert.equal(JSON.parse(beta.sent.at(-1)).type, "peer_left");
console.log("presence shard core test passed");
