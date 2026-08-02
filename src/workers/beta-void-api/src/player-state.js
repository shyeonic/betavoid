const PLAYER_STATE_SCHEMA_VERSION = 1;
const DEFAULT_SHIP_ID = "ship_01";
const DEFAULT_SHIP_CARGO_CAPACITY = 1000;
const MAX_PLAYER_STATE_BYTES = 256 * 1024;
const MAX_ASSET_RECORDS = 2000;
const MAX_MINING_ITEM_GAIN = 1_000_000;
const ASSET_REASONS = new Set(["fitting"]);
const CONSERVED_REASONS = new Set(["fitting"]);
const DEFAULT_FITTINGS = [
  { slotType: "weapon", slotId: "weapon_slot_special", itemId: "weapon_ex_beta_cascade" },
  { slotType: "weapon", slotId: "weapon_slot_wing", itemId: "weapon_pulse_service_m" },
  { slotType: "weapon", slotId: "weapon_slot_sub", itemId: "weapon_autocannon_precision_s" },
  { slotType: "shield", slotId: "shield_slot_01", itemId: "shield_aegis_military_m" }
];

export async function getOrCreatePlayerState(db, auth, profile) {
  const existing = await selectPlayerState(db, auth.uid);
  if (existing) return normalizePlayerStateRow(existing, profile);

  const now = Date.now();
  const assets = createDefaultPlayerAssets(profile, now);
  const [, selected] = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO character_states (
        firebase_uid,
        character_id,
        schema_version,
        assets_revision,
        ship_revision,
        assets_json,
        ship_state_json,
        docking_json,
        last_reason,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 1, 0, ?, NULL, NULL, 'bootstrap', ?, ?)
    `).bind(
      auth.uid,
      profile.character_id,
      PLAYER_STATE_SCHEMA_VERSION,
      JSON.stringify(assets),
      now,
      now
    ),
    selectPlayerStateStatement(db, auth.uid)
  ]);

  const row = selected?.results?.[0];
  if (!row) throw playerStateError(500, "PLAYER_STATE_UNAVAILABLE", "Player state unavailable.");
  return normalizePlayerStateRow(row, profile);
}

export async function commitPlayerAssets(db, auth, profile, body) {
  const current = await getOrCreatePlayerState(db, auth, profile);
  const expectedRevision = Number(body?.expected_revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw playerStateError(400, "PLAYER_REVISION_INVALID", "A valid assets revision is required.");
  }

  const reason = String(body?.reason || "");
  if (!ASSET_REASONS.has(reason)) {
    throw playerStateError(400, "PLAYER_MUTATION_INVALID", "Unsupported player asset mutation.");
  }

  const now = Date.now();
  const docking = null;
  const assets = normalizePlayerAssets(body?.assets, current.assets, profile, docking, now);
  validateAssetTransition(current, { assets, docking }, reason);

  const assetsJson = JSON.stringify(assets);
  const dockingJson = docking ? JSON.stringify(docking) : null;
  if (byteLength(assetsJson) + byteLength(dockingJson || "") > MAX_PLAYER_STATE_BYTES) {
    throw playerStateError(413, "PLAYER_STATE_TOO_LARGE", "Player state is too large.");
  }

  const result = await db.prepare(`
    UPDATE character_states
    SET
      assets_json = ?,
      docking_json = ?,
      assets_revision = assets_revision + 1,
      last_reason = ?,
      updated_at = ?
    WHERE firebase_uid = ? AND assets_revision = ?
  `).bind(assetsJson, dockingJson, reason, now, auth.uid, expectedRevision).run();

  if (Number(result?.meta?.changes) !== 1) {
    throw playerStateError(409, "PLAYER_STATE_CONFLICT", "Player assets changed in another session.");
  }

  return normalizePlayerStateRow(await selectPlayerState(db, auth.uid), profile);
}

function createDefaultPlayerAssets(profile, createdAt) {
  const characterId = profile.character_id;
  const activeShipUid = `ship-${characterId}-${DEFAULT_SHIP_ID}-001`;
  const activeShipStorageId = `storage-${activeShipUid}-active`;
  const cargoStorageId = `storage-${activeShipUid}-cargo`;
  return {
    character_id: characterId,
    profile: {
      character_id: characterId,
      display_name: profile.display_name || "Pilot",
      portrait_id: "portrait_01",
      sic: 0,
      playtime_sec: 0,
      skill_nodes: {},
      achievements: {},
      blueprint_ids: [],
      active_ship_uid: activeShipUid,
      selected_ship_id: DEFAULT_SHIP_ID,
      created_at: createdAt,
      updated_at: createdAt
    },
    storageLocations: [
      {
        storage_id: activeShipStorageId,
        storage_type: "active_ship",
        owner_character_id: characterId,
        world_object_id: null,
        parent_item_uid: null,
        capacity: null,
        created_at: createdAt,
        updated_at: createdAt
      },
      {
        storage_id: cargoStorageId,
        storage_type: "ship_cargo",
        owner_character_id: characterId,
        world_object_id: null,
        parent_item_uid: activeShipUid,
        capacity: DEFAULT_SHIP_CARGO_CAPACITY,
        created_at: createdAt,
        updated_at: createdAt
      }
    ],
    quantityItems: [],
    uniqueItems: [
      {
        item_uid: activeShipUid,
        item_id: DEFAULT_SHIP_ID,
        kind: "ship",
        owner_character_id: characterId,
        storage_id: activeShipStorageId,
        parent_item_uid: null,
        seed: null,
        fixed_options: {},
        created_at: createdAt,
        updated_at: createdAt
      }
    ],
    slotAssignments: DEFAULT_FITTINGS.map(({ slotType, slotId, itemId }) => ({
      assignment_id: `${activeShipUid}:${slotType}:${slotId}`,
      owner_item_uid: activeShipUid,
      slot_type: slotType,
      slot_id: slotId,
      item_id: itemId,
      item_uid: null,
      kind: slotType,
      item_identity: "quantity",
      quantity: 1,
      location_type: "ship_slot",
      created_at: createdAt,
      updated_at: createdAt
    }))
  };
}

function normalizePlayerAssets(value, currentAssets, profile, docking, now) {
  if (!value || typeof value !== "object") {
    throw playerStateError(400, "PLAYER_ASSETS_INVALID", "Player assets must be an object.");
  }

  const characterId = profile.character_id;
  const currentProfile = currentAssets?.profile || {};
  const activeShipUid = safeId(currentProfile.active_ship_uid, "active ship");
  const storageLocations = normalizeArray(value.storageLocations, "storage locations", normalizeStorage);
  const storageIds = new Set(storageLocations.map((record) => record.storage_id));
  const quantityItems = normalizeArray(value.quantityItems, "quantity items", (record) => {
    const item = normalizeQuantityItem(record);
    if (!storageIds.has(item.storage_id)) {
      throw playerStateError(400, "PLAYER_ASSETS_INVALID", "Quantity item storage is not owned by the character.");
    }
    return item;
  });
  const uniqueItems = normalizeArray(value.uniqueItems, "unique items", (record) => {
    const item = normalizeUniqueItem(record, characterId);
    if (item.storage_id !== null && !storageIds.has(item.storage_id)) {
      throw playerStateError(400, "PLAYER_ASSETS_INVALID", "Unique item storage is not owned by the character.");
    }
    return item;
  });
  const uniqueIds = new Set(uniqueItems.map((record) => record.item_uid));
  const slotAssignments = normalizeArray(value.slotAssignments, "slot assignments", (record) => {
    const assignment = normalizeSlotAssignment(record);
    if (!uniqueIds.has(assignment.owner_item_uid)) {
      throw playerStateError(400, "PLAYER_ASSETS_INVALID", "Slot owner is not owned by the character.");
    }
    return assignment;
  });

  storageLocations.forEach((storage) => {
    storage.owner_character_id = characterId;
    storage.updated_at = now;
  });
  uniqueItems.forEach((item) => {
    item.owner_character_id = characterId;
    item.updated_at = now;
  });
  quantityItems.forEach((item) => { item.updated_at = now; });
  slotAssignments.forEach((assignment) => { assignment.updated_at = now; });

  const activeShipPresent = uniqueIds.has(activeShipUid);
  if ((!docking && !activeShipPresent) || (docking && activeShipPresent)) {
    throw playerStateError(400, "PLAYER_ASSETS_INVALID", "Active ship custody is inconsistent.");
  }

  return {
    character_id: characterId,
    profile: {
      ...currentProfile,
      character_id: characterId,
      display_name: profile.display_name || currentProfile.display_name || "Pilot",
      active_ship_uid: activeShipUid,
      selected_ship_id: safeId(currentProfile.selected_ship_id || DEFAULT_SHIP_ID, "selected ship"),
      updated_at: now
    },
    storageLocations,
    quantityItems,
    uniqueItems,
    slotAssignments
  };

  function normalizeStorage(record) {
    return {
      storage_id: safeId(record?.storage_id, "storage"),
      storage_type: safeText(record?.storage_type, 64, "storage type"),
      owner_character_id: characterId,
      world_object_id: optionalId(record?.world_object_id),
      parent_item_uid: optionalId(record?.parent_item_uid),
      capacity: nullableNonnegativeNumber(record?.capacity),
      created_at: validTimestamp(record?.created_at, now),
      updated_at: now
    };
  }
}

function normalizeQuantityItem(record) {
  const quantity = Number(record?.quantity);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1e12) {
    throw playerStateError(400, "PLAYER_ASSETS_INVALID", "Item quantity is invalid.");
  }
  return {
    entry_id: safeId(record?.entry_id, "quantity item"),
    storage_id: safeId(record?.storage_id, "quantity storage"),
    item_id: safeId(record?.item_id, "item"),
    kind: safeText(record?.kind || "item", 64, "item kind"),
    quantity,
    created_at: validTimestamp(record?.created_at, Date.now()),
    updated_at: Date.now()
  };
}

function normalizeUniqueItem(record, characterId) {
  return {
    item_uid: safeId(record?.item_uid, "unique item"),
    item_id: safeId(record?.item_id, "item"),
    kind: safeText(record?.kind || "item", 64, "item kind"),
    owner_character_id: characterId,
    storage_id: optionalId(record?.storage_id),
    parent_item_uid: optionalId(record?.parent_item_uid),
    seed: record?.seed == null ? null : safeText(record.seed, 256, "item seed"),
    fixed_options: normalizePlainObject(record?.fixed_options),
    created_at: validTimestamp(record?.created_at, Date.now()),
    updated_at: Date.now()
  };
}

function normalizeSlotAssignment(record) {
  const itemUid = optionalId(record?.item_uid);
  return {
    assignment_id: safeId(record?.assignment_id, "slot assignment"),
    owner_item_uid: safeId(record?.owner_item_uid, "slot owner"),
    slot_type: safeText(record?.slot_type, 64, "slot type"),
    slot_id: safeId(record?.slot_id, "slot"),
    item_id: safeId(record?.item_id, "item"),
    item_uid: itemUid,
    kind: safeText(record?.kind || record?.slot_type || "item", 64, "slot item kind"),
    item_identity: itemUid ? "unique" : "quantity",
    quantity: 1,
    location_type: "ship_slot",
    created_at: validTimestamp(record?.created_at, Date.now()),
    updated_at: Date.now()
  };
}

function normalizeDocking(value, activeShipUid, characterId) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || !value.entry || typeof value.entry !== "object") {
    throw playerStateError(400, "PLAYER_DOCKING_INVALID", "Docking state is invalid.");
  }
  const entry = value.entry;
  const shipUid = safeId(entry.ship_uid, "docked ship");
  if (shipUid !== activeShipUid || entry.owner_character_id !== characterId) {
    throw playerStateError(400, "PLAYER_DOCKING_INVALID", "Docked ship ownership is invalid.");
  }
  const cargo = {};
  for (const [itemId, quantityValue] of Object.entries(normalizePlainObject(entry.cargo))) {
    const quantity = Number(quantityValue);
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1e12) {
      throw playerStateError(400, "PLAYER_DOCKING_INVALID", "Docked cargo quantity is invalid.");
    }
    if (quantity > 0) cargo[safeId(itemId, "cargo item")] = quantity;
  }

  return {
    station_id: safeId(value.station_id, "station"),
    entry: {
      ship_uid: shipUid,
      ship_id: safeId(entry.ship_id, "ship"),
      kind: "ship",
      owner_character_id: characterId,
      seed: entry.seed == null ? null : safeText(entry.seed, 256, "ship seed"),
      fixed_options: normalizePlainObject(entry.fixed_options),
      dock_slot: clampInteger(entry.dock_slot, 0, 10000),
      docked_at: validTimestamp(entry.docked_at, Date.now()),
      cargo,
      cargo_unique: normalizeArray(entry.cargo_unique, "docked unique cargo", (item) => ({
        item_uid: safeId(item?.item_uid, "docked unique item"),
        item_id: safeId(item?.item_id, "item"),
        kind: safeText(item?.kind || "item", 64, "item kind"),
        seed: item?.seed == null ? null : safeText(item.seed, 256, "item seed"),
        fixed_options: normalizePlainObject(item?.fixed_options)
      })),
      fittings: normalizeArray(entry.fittings, "docked fittings", (item) => ({
        slot_type: safeText(item?.slot_type, 64, "slot type"),
        slot_id: safeId(item?.slot_id, "slot"),
        item_id: safeId(item?.item_id, "item"),
        item_uid: optionalId(item?.item_uid),
        kind: safeText(item?.kind || item?.slot_type || "item", 64, "item kind"),
        item_identity: item?.item_uid ? "unique" : "quantity",
        quantity: 1
      }))
    }
  };
}

function validateAssetTransition(current, next, reason) {
  const before = buildItemLedger(current.assets, current.docking);
  const after = buildItemLedger(next.assets, next.docking);
  if (CONSERVED_REASONS.has(reason) && !sameLedger(before, after)) {
    throw playerStateError(400, "PLAYER_ASSET_CONSERVATION_FAILED", "Player asset totals changed unexpectedly.");
  }
  if ((reason === "mining" || reason === "trade") && !sameLedgerKind(before, after, "unique:")) {
    throw playerStateError(400, "PLAYER_ASSET_CONSERVATION_FAILED", "Unique player assets changed unexpectedly.");
  }
  if (reason === "mining") {
    let itemGain = 0;
    for (const [key, quantity] of before) {
      if ((after.get(key) || 0) < quantity) {
        throw playerStateError(400, "PLAYER_ASSET_CONSERVATION_FAILED", "Mining cannot remove player assets.");
      }
    }
    for (const [key, quantity] of after) {
      if (key.startsWith("item:")) itemGain += Math.max(0, quantity - (before.get(key) || 0));
    }
    if (itemGain > MAX_MINING_ITEM_GAIN) {
      throw playerStateError(400, "PLAYER_ASSET_CONSERVATION_FAILED", "Mining asset gain is too large.");
    }
  }
}

function buildItemLedger(assets, docking) {
  const ledger = new Map();
  const add = (key, quantity = 1) => ledger.set(key, (ledger.get(key) || 0) + Number(quantity || 0));
  (assets?.quantityItems || []).forEach((item) => add(`item:${item.item_id}`, item.quantity));
  (assets?.uniqueItems || []).forEach((item) => add(`unique:${item.item_uid}:${item.item_id}`, 1));
  (assets?.slotAssignments || []).forEach((item) => {
    if (!item.item_uid) add(`item:${item.item_id}`, 1);
  });
  const entry = docking?.entry;
  if (entry) {
    add(`unique:${entry.ship_uid}:${entry.ship_id}`, 1);
    Object.entries(entry.cargo || {}).forEach(([itemId, quantity]) => add(`item:${itemId}`, quantity));
    (entry.cargo_unique || []).forEach((item) => add(`unique:${item.item_uid}:${item.item_id}`, 1));
    (entry.fittings || []).forEach((item) => {
      add(item.item_uid ? `unique:${item.item_uid}:${item.item_id}` : `item:${item.item_id}`, 1);
    });
  }
  return ledger;
}

function sameLedger(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (Math.abs((right.get(key) || 0) - value) > 1e-9) return false;
  }
  return true;
}

function sameLedgerKind(left, right, prefix) {
  const leftEntries = [...left].filter(([key]) => key.startsWith(prefix));
  const rightEntries = [...right].filter(([key]) => key.startsWith(prefix));
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value]) => Math.abs((right.get(key) || 0) - value) <= 1e-9);
}

export function normalizePlayerStateRow(row, profile) {
  const assets = parseJsonObject(row.assets_json, "PLAYER_STATE_CORRUPT");
  assets.character_id = profile.character_id;
  assets.profile = {
    ...(assets.profile || {}),
    character_id: profile.character_id,
    display_name: profile.display_name || assets.profile?.display_name || "Pilot",
    updated_at: Math.max(Number(assets.profile?.updated_at) || 0, Number(profile.updated_at) || 0)
  };
  return {
    character_id: profile.character_id,
    schema_version: Number(row.schema_version),
    assets_revision: Number(row.assets_revision),
    ship_revision: Number(row.ship_revision),
    assets,
    ship_state: row.ship_state_json ? parseJsonObject(row.ship_state_json, "PLAYER_STATE_CORRUPT") : null,
    docking: null,
    updated_at: Number(row.updated_at)
  };
}

function selectPlayerState(db, firebaseUid) {
  return selectPlayerStateStatement(db, firebaseUid).first();
}

function selectPlayerStateStatement(db, firebaseUid) {
  return db.prepare(`
    SELECT
      firebase_uid,
      character_id,
      schema_version,
      assets_revision,
      ship_revision,
      assets_json,
      ship_state_json,
      docking_json,
      last_reason,
      created_at,
      updated_at
    FROM character_states
    WHERE firebase_uid = ?
  `).bind(firebaseUid);
}

function normalizeArray(value, label, mapper) {
  if (!Array.isArray(value)) {
    throw playerStateError(400, "PLAYER_ASSETS_INVALID", `${label} must be an array.`);
  }
  if (value.length > MAX_ASSET_RECORDS) {
    throw playerStateError(413, "PLAYER_STATE_TOO_LARGE", `${label} contains too many records.`);
  }
  const records = value.map(mapper);
  const ids = new Set();
  for (const record of records) {
    const id = record.storage_id || record.entry_id || record.item_uid || record.assignment_id;
    if (id && ids.has(id)) throw playerStateError(400, "PLAYER_ASSETS_INVALID", `${label} contains duplicate records.`);
    if (id) ids.add(id);
  }
  return records;
}

function normalizePlainObject(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw playerStateError(400, "PLAYER_ASSETS_INVALID", "Expected an object.");
  }
  return { ...value };
}

function safeId(value, label) {
  return safeText(value, 160, label);
}

function optionalId(value) {
  return value == null || value === "" ? null : safeId(value, "identifier");
}

function safeText(value, maxLength, label) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f]/.test(text)) {
    throw playerStateError(400, "PLAYER_ASSETS_INVALID", `${label} is invalid.`);
  }
  return text;
}

function nullableNonnegativeNumber(value) {
  if (value == null) return null;
  return finiteNumber(value, 0, 1e12);
}

function finiteNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, number));
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));
}

function validTimestamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseJsonObject(value, code) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw playerStateError(500, code, "Stored player state is invalid.");
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function playerStateError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
