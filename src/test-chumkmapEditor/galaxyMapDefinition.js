/**
 * GalaxyMapDefinition
 *
 * Loads a .gmz binary world-layout file produced by the Galaxy Map Editor
 * and provides O(1) chunk existence queries for the game.
 *
 * .gmz format:
 *   Bytes 0-3:   magic "GMZ1"
 *   Bytes 4-5:   gx   (uint16 LE) — total grid X
 *   Bytes 6-7:   gy   (uint16 LE)
 *   Bytes 8-9:   gz   (uint16 LE)
 *   Bytes 10-11: innerGx (uint16 LE) — noise-target region
 *   Bytes 12-13: innerGy (uint16 LE)
 *   Bytes 14-15: innerGz (uint16 LE)
 *   Byte  16:    n  (uint8) — border width on each side
 *   Bytes 17-23: reserved
 *   Bytes 24+:   gzip( bitset )
 *                  bitset index = x*gy*gz + y*gz + z
 *                  bit = bits[idx >> 3] & (1 << (idx & 7))
 */
export class GalaxyMapDefinition {
  constructor() {
    this.gx = 0;
    this.gy = 0;
    this.gz = 0;
    this.innerGx = 0;
    this.innerGy = 0;
    this.innerGz = 0;
    this.n = 0;
    this._bits = null; // Uint8Array — in-memory bitset after load
  }

  get loaded() { return this._bits !== null; }

  // ── Load ────────────────────────────────────────────

  /** Fetch and parse a .gmz file by URL. */
  async loadFromUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    await this._parse(await res.arrayBuffer());
  }

  /** Parse from an ArrayBuffer (e.g. from a File input or IDB blob). */
  async loadFromBuffer(arrayBuffer) {
    await this._parse(arrayBuffer);
  }

  async _parse(buffer) {
    const HEADER = 24;
    if (buffer.byteLength < HEADER) throw new Error('Invalid .gmz: too small');

    const dv = new DataView(buffer);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'GMZ1') throw new Error(`Invalid .gmz magic: expected "GMZ1", got "${magic}"`);

    this.gx      = dv.getUint16(4,  true);
    this.gy      = dv.getUint16(6,  true);
    this.gz      = dv.getUint16(8,  true);
    this.innerGx = dv.getUint16(10, true);
    this.innerGy = dv.getUint16(12, true);
    this.innerGz = dv.getUint16(14, true);
    this.n       = dv.getUint8(16);

    const payload  = new Uint8Array(buffer, HEADER);
    this._bits     = await _decompress(payload);

    const expected = Math.ceil(this.gx * this.gy * this.gz / 8);
    if (this._bits.length !== expected) {
      throw new Error(`Bitset size mismatch: expected ${expected}, got ${this._bits.length}`);
    }
  }

  // ── Queries ─────────────────────────────────────────

  /**
   * O(1) — returns true if chunk (x, y, z) exists in the world layout.
   * x/y/z are chunk-grid coordinates (0-based integers).
   */
  chunkExists(x, y, z) {
    if (!this._bits) return false;
    if (x < 0 || x >= this.gx || y < 0 || y >= this.gy || z < 0 || z >= this.gz) return false;
    const idx = x * this.gy * this.gz + y * this.gz + z;
    return (this._bits[idx >> 3] & (1 << (idx & 7))) !== 0;
  }

  /**
   * Convert a world-space position to chunk-grid coordinates.
   * @param {number} chunkSize — world units per chunk side
   */
  chunkCoordsAt(worldX, worldY, worldZ, chunkSize) {
    return {
      x: Math.floor(worldX / chunkSize),
      y: Math.floor(worldY / chunkSize),
      z: Math.floor(worldZ / chunkSize)
    };
  }

  /**
   * chunkExists by world-space position.
   * @param {number} chunkSize — world units per chunk side
   */
  existsAtWorldPos(worldX, worldY, worldZ, chunkSize) {
    const c = this.chunkCoordsAt(worldX, worldY, worldZ, chunkSize);
    return this.chunkExists(c.x, c.y, c.z);
  }

  /**
   * Returns true if (x, y, z) is inside the inner noise-generated region
   * (not the border trim zone).
   */
  isInnerChunk(x, y, z) {
    const { n, innerGx, innerGy, innerGz } = this;
    return x >= n && x < n + innerGx
        && y >= n && y < n + innerGy
        && z >= n && z < n + innerGz;
  }

  /**
   * Iterate all active chunk positions. Use sparingly (up to ~100k entries).
   * @yields {{ x: number, y: number, z: number }}
   */
  *activeChunks() {
    if (!this._bits) return;
    const { gx, gy, gz } = this;
    const total = gx * gy * gz;
    const ygz = gy * gz;
    for (let idx = 0; idx < total; idx++) {
      if (this._bits[idx >> 3] & (1 << (idx & 7))) {
        yield {
          x: Math.floor(idx / ygz),
          y: Math.floor((idx % ygz) / gz),
          z: idx % gz
        };
      }
    }
  }

  /** Total number of active chunks (counts set bits). */
  get chunkCount() {
    if (!this._bits) return 0;
    let count = 0;
    for (let b of this._bits) {
      // Brian Kernighan bit-count
      while (b) { count++; b &= b - 1; }
    }
    return count;
  }

  /** Memory footprint of the in-memory bitset in bytes. */
  get memoryBytes() {
    return this._bits ? this._bits.byteLength : 0;
  }
}

// ── Internal ────────────────────────────────────────────────────────────────

async function _decompress(uint8) {
  const ds = new DecompressionStream('gzip');
  const w  = ds.writable.getWriter();
  w.write(uint8); w.close();
  const chunks = []; const r = ds.readable.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
