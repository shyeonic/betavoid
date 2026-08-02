import { BETA_VOID_API_BASE_URL } from "./firebaseConfig.js";

const PRESENCE_PROTOCOL = "beta-void.v1";
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];

export class OnlinePresenceClient {
  constructor({
    identity,
    baseUrl = BETA_VOID_API_BASE_URL,
    WebSocketImpl = globalThis.WebSocket,
    onMessage = null,
    onStateChange = null
  } = {}) {
    if (!identity) throw new Error("OnlinePresenceClient requires an identity manager.");
    if (!WebSocketImpl) throw new Error("WebSocket is unavailable.");
    this.identity = identity;
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.WebSocketImpl = WebSocketImpl;
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;
    this.socket = null;
    this.zoneId = null;
    this.desiredZoneId = null;
    this.worldId = "primary";
    this.connectionGeneration = 0;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.latestPose = null;
    this.latestRoute = null;
    this.state = "disconnected";
    this.disposed = false;
  }

  ensureZone(zoneId, { worldId = "primary" } = {}) {
    const normalizedZone = String(zoneId || "").trim();
    const normalizedWorld = String(worldId || "primary").trim();
    if (!normalizedZone) {
      this.disconnect();
      return;
    }
    if (
      this.desiredZoneId === normalizedZone
      && this.worldId === normalizedWorld
    ) {
      return;
    }

    this.desiredZoneId = normalizedZone;
    this.worldId = normalizedWorld;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.closeSocket();
    void this.connect(this.connectionGeneration);
  }

  async connect(generation = this.connectionGeneration) {
    if (this.disposed || !this.desiredZoneId || generation !== this.connectionGeneration) return;
    this.setState("connecting");

    try {
      const token = await this.identity.getIdToken(this.reconnectAttempt > 0);
      if (!token || generation !== this.connectionGeneration || this.disposed) {
        throw new Error("Presence authentication is unavailable.");
      }

      const url = new URL("/v1/presence/connect", this.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("world_id", this.worldId);
      url.searchParams.set("zone_id", this.desiredZoneId);
      const socket = new this.WebSocketImpl(url.href, [
        PRESENCE_PROTOCOL,
        `firebase.${token}`
      ]);
      this.socket = socket;

      socket.addEventListener("open", () => {
        if (socket !== this.socket || generation !== this.connectionGeneration) {
          socket.close(1000, "Superseded.");
          return;
        }
        this.zoneId = this.desiredZoneId;
        this.reconnectAttempt = 0;
        this.setState("connected");
        this.flushLatestState();
      });
      socket.addEventListener("message", (event) => {
        if (socket !== this.socket) return;
        try {
          const payload = JSON.parse(String(event.data || ""));
          this.onMessage?.(payload);
        } catch (error) {
          console.warn("[presence] invalid server message.", error);
        }
      });
      socket.addEventListener("close", () => {
        if (socket !== this.socket) return;
        this.socket = null;
        this.zoneId = null;
        this.setState("disconnected");
        this.scheduleReconnect(generation);
      });
      socket.addEventListener("error", () => {
        if (socket === this.socket) this.setState("error");
      });
    } catch (error) {
      if (generation !== this.connectionGeneration || this.disposed) return;
      console.warn("[presence] connection failed.", error);
      this.setState("error");
      this.scheduleReconnect(generation);
    }
  }

  publishPose(pose) {
    this.latestPose = { type: "pose", ...pose };
    this.latestRoute = null;
    this.send(this.latestPose);
  }

  publishRoute(route) {
    this.latestRoute = { type: "route", ...route };
    this.send(this.latestRoute);
  }

  clearLatestState() {
    this.latestPose = null;
    this.latestRoute = null;
  }

  flushLatestState() {
    if (this.latestRoute) this.send(this.latestRoute);
    else if (this.latestPose) this.send(this.latestPose);
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  scheduleReconnect(generation) {
    if (this.disposed || !this.desiredZoneId || generation !== this.connectionGeneration) return;
    this.clearReconnectTimer();
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(generation);
    }, delay);
  }

  disconnect() {
    this.desiredZoneId = null;
    this.zoneId = null;
    this.latestPose = null;
    this.latestRoute = null;
    this.connectionGeneration += 1;
    this.clearReconnectTimer();
    this.closeSocket();
    this.setState("disconnected");
  }

  closeSocket() {
    const socket = this.socket;
    this.socket = null;
    this.connectionGeneration += 1;
    if (socket && socket.readyState < this.WebSocketImpl.CLOSING) {
      socket.close(1000, "Presence zone changed.");
    }
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }

  dispose() {
    this.disposed = true;
    this.disconnect();
    this.onMessage = null;
    this.onStateChange = null;
  }
}
