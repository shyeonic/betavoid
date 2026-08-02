const keyCache = new Map();

export async function createServerDeterministicRandom(secret, context) {
  const normalizedSecret = String(secret || "");
  if (!normalizedSecret) throw new Error("WORLD_ENTROPY_SECRET is required.");
  let keyPromise = keyCache.get(normalizedSecret);
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(normalizedSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    keyCache.set(normalizedSecret, keyPromise);
  }
  const signature = await crypto.subtle.sign(
    "HMAC",
    await keyPromise,
    new TextEncoder().encode(String(context || ""))
  );
  const words = new Uint32Array(signature);
  let value = 0;
  for (const word of words) value = (value ^ word) >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
