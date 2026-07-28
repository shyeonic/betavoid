import { WorldDataManager } from "../js/WorldDataManager.js";

// Bare instance: exercise the pure settlement core without IndexedDB.
const wdm = Object.create(WorldDataManager.prototype);
wdm.itemDefinitions = {
  item_001: { id: "item_001", kind: "resource", mass: 1 },
  item_002: { id: "item_002", kind: "resource", mass: 1.5 }
};

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function check(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}  ${detail}`); }
}

function node(extra = {}) {
  return {
    resource_instance_id: "RES-1", resource_id: "rss_001", produces_item_id: "item_001",
    current_amount: 100, total_capacity: 100, base_yield_per_sec: 5,
    node_type: "PERMANENT", expiry_time: null,
    epoch_start_at: null, amount_at_epoch_start: 100, active_gather_ids: [],
    ...extra
  };
}
function log(id, actor, startMs, rate, storageId = "cargo", item = "item_001") {
  return {
    id, actor_id: actor, type: "gathering", status: "active",
    target_node_id: "RES-1", produces_item_id: item, target_storage_id: storageId,
    start_at: startMs, epoch_settled_anchor: startMs,
    yield_snapshot: { base_yield_per_sec: rate, gather_rate_mult: 1, effective_yield_per_sec: rate },
    settled_yield: 0, planned_yield: 0, planned_end_at: null
  };
}
function build(n, logs, qty = [], storages = [{ storage_id: "cargo", capacity: null }]) {
  return wdm._buildNodeState(n, logs, qty, storages, n.resource_instance_id);
}
const qtyTotal = (state, storageId, item) => {
  const e = state.qtyMap.get(`qty-${storageId}-${item}`);
  return e ? e.quantity : 0;
};

console.log("\n[1] Single miner, 4s @ 5/s -> 20 gathered, node 80");
{
  const s = build(node(), [log("A", "p1", 0, 5)]);
  s.node.epoch_start_at = 0;
  wdm._simulateGathering(s, 4000);
  check("gathered 20", approx(qtyTotal(s, "cargo", "item_001"), 20));
  check("node 80", approx(s.node.current_amount, 80));
  check("A settled 20", approx(s.logs.get("A").settled_yield, 20));
}

console.log("\n[2] Contention (doc example): A solo t0..10s, B joins t10s");
{
  const s = build(node(), [log("A", "p1", 0, 5)]);
  s.node.epoch_start_at = 0;
  // settle A to t=10s (what startGathering(B) does first)
  wdm._simulateGathering(s, 10000);
  check("A gathered 50 by t10", approx(s.logs.get("A").settled_yield, 50));
  check("node 50 at t10", approx(s.node.current_amount, 50));
  // add B, reset epoch (mirrors startGathering mutate)
  s.logs.set("B", log("B", "p2", 10000, 5));
  s.node.epoch_start_at = 10000;
  s.node.amount_at_epoch_start = s.node.current_amount;
  wdm._replanGathering(s);
  check("A planned_yield 75", approx(s.logs.get("A").planned_yield, 75), `got ${s.logs.get("A").planned_yield}`);
  check("A planned_end 15000", s.logs.get("A").planned_end_at === 15000, `got ${s.logs.get("A").planned_end_at}`);
  check("B planned_yield 25", approx(s.logs.get("B").planned_yield, 25));
  check("B planned_end 15000", s.logs.get("B").planned_end_at === 15000);
}

console.log("\n[3] Exhaust split is proportional and conserves node amount");
{
  // node 90, A rate 5, B rate 10 from t0 -> exhaust at 90/15 = 6s.
  // Distinct actors -> distinct cargo storages (real multiplayer case).
  const s = build(
    node({ current_amount: 90, amount_at_epoch_start: 90 }),
    [log("A", "p1", 0, 5, "cargoA"), log("B", "p2", 0, 10, "cargoB")],
    [],
    [{ storage_id: "cargoA", capacity: null }, { storage_id: "cargoB", capacity: null }]
  );
  s.node.epoch_start_at = 0;
  wdm._simulateGathering(s, 100000); // far past exhaust
  const a = s.logs.get("A").settled_yield;
  const b = s.logs.get("B").settled_yield;
  check("A gets 30", approx(a, 30), `got ${a}`);
  check("B gets 60", approx(b, 60), `got ${b}`);
  check("sum == 90 (conserved)", approx(a + b, 90));
  check("node deleted on depletion", s.nodeDeleted === true);
  check("both completed", s.logs.get("A").status === "completed" && s.logs.get("B").status === "completed");
}

console.log("\n[4] Cargo cap: capacity 30 (mass1), rate 5 -> full at 6s, capped at 30");
{
  const s = build(
    node(),
    [log("A", "p1", 0, 5)],
    [],
    [{ storage_id: "cargo", capacity: 30 }]
  );
  s.node.epoch_start_at = 0;
  wdm._simulateGathering(s, 100000);
  check("gathered capped at 30", approx(qtyTotal(s, "cargo", "item_001"), 30), `got ${qtyTotal(s, "cargo", "item_001")}`);
  check("A completed (cargo full)", s.logs.get("A").status === "completed");
  check("node 70 remaining", approx(s.node.current_amount, 70));
}

console.log("\n[4b] Cargo cap with mass 1.5 item_002, capacity 30 -> 20 units max");
{
  const s = build(
    node({ produces_item_id: "item_002" }),
    [log("A", "p1", 0, 5, "cargo", "item_002")],
    [],
    [{ storage_id: "cargo", capacity: 30 }]
  );
  s.node.epoch_start_at = 0;
  wdm._simulateGathering(s, 100000);
  check("gathered capped at 20 units", approx(qtyTotal(s, "cargo", "item_002"), 20), `got ${qtyTotal(s, "cargo", "item_002")}`);
}

console.log("\n[5] Idempotent re-derive: settling to same now twice = no double count");
{
  const logs = [log("A", "p1", 0, 5)];
  const s1 = build(node(), logs.map((l) => ({ ...l })));
  s1.node.epoch_start_at = 0;
  wdm._simulateGathering(s1, 4000);
  const first = qtyTotal(s1, "cargo", "item_001");
  // persist back: node + log carry forward, re-derive to same 4000
  const carriedLog = { ...s1.logs.get("A") };
  const s2 = build({ ...s1.node }, [carriedLog]);
  wdm._simulateGathering(s2, 4000); // epoch_start now 4000, no time elapsed
  const second = qtyTotal(s2, "cargo", "item_001");
  check("no extra gather on re-derive", approx(second, 0), `delta ${second}`);
  check("settled stays 20", approx(carriedLog.settled_yield, 20));
  check("first was 20", approx(first, 20));
}

console.log("\n[6] Whole units only: 1 per 30s, stop at 28s -> 0, 30s -> 1, 60s -> 2");
{
  const rate = 1 / 30;
  const run = (ms) => {
    const s = build(node({ current_amount: 100, amount_at_epoch_start: 100 }), [log("A", "p1", 0, rate)]);
    s.node.epoch_start_at = 0;
    wdm._simulateGathering(s, ms);
    return s;
  };
  let s = run(28000);
  check("28s -> 0 reward", s.logs.get("A").settled_yield === 0, `got ${s.logs.get("A").settled_yield}`);
  check("28s node untouched (100)", s.node.current_amount === 100, `got ${s.node.current_amount}`);
  check("28s inventory empty", qtyTotal(s, "cargo", "item_001") === 0);
  s = run(30000);
  check("30s -> 1 unit", s.logs.get("A").settled_yield === 1, `got ${s.logs.get("A").settled_yield}`);
  check("30s node 99", s.node.current_amount === 99, `got ${s.node.current_amount}`);
  s = run(60000);
  check("60s -> 2 units", s.logs.get("A").settled_yield === 2, `got ${s.logs.get("A").settled_yield}`);
}

console.log("\n[7] Whole-unit credit keeps node integer under contention");
{
  const s = build(node({ current_amount: 100, amount_at_epoch_start: 100 }),
    [log("A", "p1", 0, 1.4, "cargoA"), log("B", "p2", 0, 1.4, "cargoB")],
    [], [{ storage_id: "cargoA", capacity: null }, { storage_id: "cargoB", capacity: null }]);
  s.node.epoch_start_at = 0;
  wdm._simulateGathering(s, 10000); // each accrues 14.0 -> 14 whole units
  const a = s.logs.get("A").settled_yield, b = s.logs.get("B").settled_yield;
  check("A integer 14", a === 14, `got ${a}`);
  check("B integer 14", b === 14, `got ${b}`);
  check("node integer 72", s.node.current_amount === 72, `got ${s.node.current_amount}`);
  check("conserved (100-14-14=72)", 100 - a - b === s.node.current_amount);
}

console.log("\n[8] Configured test rate 0.1/s (1 per 10s): 9s->0, 10s->1, 25s->2");
{
  const run = (ms) => {
    const s = build(node({ current_amount: 100, amount_at_epoch_start: 100 }), [log("A", "p1", 0, 0.1)]);
    s.node.epoch_start_at = 0;
    wdm._simulateGathering(s, ms);
    return s.logs.get("A").settled_yield;
  };
  check("9s -> 0", run(9000) === 0, `got ${run(9000)}`);
  check("10s -> 1", run(10000) === 1, `got ${run(10000)}`);
  check("25s -> 2", run(25000) === 2, `got ${run(25000)}`);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
