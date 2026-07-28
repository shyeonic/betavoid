const PROTOCOL = "beta-void.v1";
const MAX_MESSAGE_BYTES = 8 * 1024;
const MIN_POSE_INTERVAL_MS = 250;
const MAX_ROUTE_DELAY_MS = 10 * 60 * 1000;
const MAX_ROUTE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export class PresenceShard {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required.", { status: 426 });
    }

    const characterId = safeId(request.headers.get("X-Beta-Void-Character"), "character");
    const displayName = safeText(
      decodeURIComponent(request.headers.get("X-Beta-Void-Display-Name") || "Pilot"),
      32
    );
    const shipId = safeId(request.headers.get("X-Beta-Void-Ship") || "ship_01", "ship");
    const zoneId = safeId(request.headers.get("X-Beta-Void-Zone"), "zone");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const now = Date.now();
    const attachment = {
      character_id: characterId,
      display_name: displayName,
      ship_id: shipId,
      zone_id: zoneId,
      connected_at: now,
      updated_at: now,
      last_message_at: 0,
      pose: null,
      route: null
    };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);

    const peers = this.currentPeers(characterId);
    server.send(JSON.stringify({
      type: "hello",
      protocol: PROTOCOL,
      zone_id: zoneId,
      server_at: now,
      peers
    }));
    this.broadcast({
      type: "peer_joined",
      server_at: now,
      peer: publicPeer(attachment)
    }, server, characterId);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": PROTOCOL }
    });
  }

  async webSocketMessage(socket, message) {
    if (typeof message !== "string" || byteLength(message) > MAX_MESSAGE_BYTES) {
      socket.close(1009, "Message too large.");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      socket.close(1003, "JSON required.");
      return;
    }

    const attachment = socket.deserializeAttachment();
    if (!attachment?.character_id) {
      socket.close(1011, "Presence identity unavailable.");
      return;
    }

    try {
      const now = Date.now();
      if (payload?.type === "pose") {
        if (now - Number(attachment.last_message_at || 0) < MIN_POSE_INTERVAL_MS) return;
        const pose = normalizePose(payload, now);
        if (Number(attachment.pose?.seq) >= pose.seq) return;
        const next = {
          ...attachment,
          ship_id: pose.ship_id,
          updated_at: now,
          last_message_at: now,
          pose,
          route: null
        };
        socket.serializeAttachment(next);
        this.broadcast({
          type: "peer_pose",
          server_at: now,
          peer: publicPeer(next)
        }, socket, attachment.character_id);
        return;
      }

      if (payload?.type === "route") {
        const route = normalizeRoute(payload, now);
        const next = {
          ...attachment,
          ship_id: route.ship_id,
          updated_at: now,
          last_message_at: now,
          route
        };
        socket.serializeAttachment(next);
        this.broadcast({
          type: "peer_route",
          server_at: now,
          peer: publicPeer(next)
        }, socket, attachment.character_id);
      }
    } catch {
      socket.close(1008, "Invalid presence message.");
    }
  }

  async webSocketClose(socket) {
    const attachment = socket.deserializeAttachment();
    if (!attachment?.character_id || this.hasOtherConnection(attachment.character_id, socket)) return;
    this.broadcast({
      type: "peer_left",
      server_at: Date.now(),
      character_id: attachment.character_id
    }, socket);
  }

  async webSocketError(socket) {
    const attachment = socket.deserializeAttachment();
    if (!attachment?.character_id || this.hasOtherConnection(attachment.character_id, socket)) return;
    this.broadcast({
      type: "peer_left",
      server_at: Date.now(),
      character_id: attachment.character_id
    }, socket);
  }

  currentPeers(excludedCharacterId) {
    const peers = new Map();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (!attachment?.character_id || attachment.character_id === excludedCharacterId) continue;
      const previous = peers.get(attachment.character_id);
      if (!previous || Number(previous.updated_at) < Number(attachment.updated_at)) {
        peers.set(attachment.character_id, publicPeer(attachment));
      }
    }
    return [...peers.values()];
  }

  hasOtherConnection(characterId, excludedSocket) {
    return this.ctx.getWebSockets().some((socket) => (
      socket !== excludedSocket
      && socket.deserializeAttachment()?.character_id === characterId
    ));
  }

  broadcast(payload, excludedSocket = null, excludedCharacterId = null) {
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excludedSocket) continue;
      if (excludedCharacterId && socket.deserializeAttachment()?.character_id === excludedCharacterId) continue;
      try {
        socket.send(message);
      } catch {
        // Close/error callbacks reconcile the remaining peer list.
      }
    }
  }
}

function normalizePose(value, now) {
  const seq = Number(value?.seq);
  if (!Number.isInteger(seq) || seq < 0) throw new Error("Invalid pose sequence.");
  return {
    seq,
    ship_id: safeId(value?.ship_id || "ship_01", "ship"),
    position: normalizeVector(value?.position, 1e9),
    rotation: normalizeQuaternion(value?.rotation),
    velocity: normalizeVector(value?.velocity, 1e7),
    speed: finiteNumber(value?.speed, -1e6, 1e6),
    server_at: now
  };
}

function normalizeRoute(value, now) {
  const delayMs = finiteNumber(value?.depart_delay_ms, 0, MAX_ROUTE_DELAY_MS);
  const durationMs = finiteNumber(value?.duration_ms, 0, MAX_ROUTE_DURATION_MS);
  const routeType = value?.route_type === "hyperdrive" ? "hyperdrive" : "standard";
  return {
    action_id: safeId(value?.action_id, "route action"),
    route_type: routeType,
    ship_id: safeId(value?.ship_id || "ship_01", "ship"),
    from_position: normalizeVector(value?.from_position, 1e9),
    target: normalizeVector(value?.target, 1e9),
    depart_at: now + delayMs,
    arrive_at: now + delayMs + durationMs,
    server_at: now
  };
}

function publicPeer(attachment) {
  return {
    character_id: attachment.character_id,
    display_name: attachment.display_name,
    ship_id: attachment.ship_id,
    zone_id: attachment.zone_id,
    updated_at: attachment.updated_at,
    pose: attachment.pose,
    route: attachment.route
  };
}

function normalizeVector(value, maxAbs) {
  return {
    x: finiteNumber(value?.x, -maxAbs, maxAbs),
    y: finiteNumber(value?.y, -maxAbs, maxAbs),
    z: finiteNumber(value?.z, -maxAbs, maxAbs)
  };
}

function normalizeQuaternion(value) {
  const quaternion = {
    x: finiteNumber(value?.x, -1, 1),
    y: finiteNumber(value?.y, -1, 1),
    z: finiteNumber(value?.z, -1, 1),
    w: finiteNumber(value?.w ?? 1, -1, 1)
  };
  const magnitude = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) || 1;
  quaternion.x /= magnitude;
  quaternion.y /= magnitude;
  quaternion.z /= magnitude;
  quaternion.w /= magnitude;
  return quaternion;
}

function finiteNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, number));
}

function safeId(value, label) {
  const text = safeText(value, 160);
  if (!/^[A-Za-z0-9_.:-]+$/.test(text)) throw new Error(`Invalid ${label}.`);
  return text;
}

function safeText(value, maxLength) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text || text.length > maxLength || /[\u0000-\u001f]/.test(text)) {
    throw new Error("Invalid presence value.");
  }
  return text;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}
