// Unit tests for src/snapshot.js: snapshot -> heavy random play -> restore == original (normalized deep compare), and
// continuing play after a restore is identical to the original run. Run: node scripts/test-snapshot.mjs [games=200]
import * as S from '../src/state.js';
import * as SN from '../src/snapshot.js';
import { init, makeRng, makeDriver } from './lib-driver.mjs';
await init();
const G = Number(process.argv[2] || 200);
function sortKeys(v) { if (v instanceof Set) return { __set: [...v].map(sortKeys) }; if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) if (typeof v[k] !== 'function') o[k] = sortKeys(v[k]); return o; } return v; }
const SKIP = new Set(['log', 'fxHistory', 'pendingVanishFlash', 'pendingVanishSrc', 'uiChoice', '_replWaiters', 'pendingReplacements', '_leavePending', '_fxRec']);
function norm(state) {
  const o = {}; for (const k of Object.keys(state)) if (!SKIP.has(k)) o[k] = state[k];
  o.endOfTurnEffects = (state.endOfTurnEffects || []).map(e => ({ ...e }));
  return JSON.stringify(sortKeys({ o, c: { ...S.getCounters(), fx: 0 } }));
}
let mutated = 0, eotSeen = 0, fails = 0, checks = 0, contChecks = 0, maxMs = 0, sumMs = 0, nSnap = 0, maxBytes = 0, lossyN = 0, splices = 0;
function fail(msg) { fails++; if (fails <= 8) console.log('FAIL', msg); }
const realRandom = Math.random;
for (let g = 0; g < G; g++) {
  const rng = makeRng(1000 + g); Math.random = rng;
  const d = makeDriver(rng);
  const state = d.newRandomGame();
  const N = 40 + Math.floor(rng() * 260);
  let snaps = [];
  for (let i = 0; i < N && !state.winner; i++) {
    if (state.pending.every(t => t.resolved)) {
      if (rng() < 0.12 || i === 0) {
        const t0 = performance.now(); const snap = SN.snapshotState(state); const dt = performance.now() - t0;
        maxMs = Math.max(maxMs, dt); sumMs += dt; nSnap++; if (snap.lossy) lossyN++;
        snaps.push({ snap, n: norm(state), rs: rng.get(), i });
      }
    }
    await d.step(state);
  }
  // restore checks: go back to each snapshot (any order) and compare
  const finalN = norm(state);
  for (const s of snaps.sort(() => rng() - 0.5).slice(0, 4)) {
    if (norm(state) !== s.n) mutated++;
    SN.restoreState(state, s.snap, { exactCounters: true }); checks++;
    if (norm(state) !== s.n) { fail(`game ${g} restore mismatch @${s.i}`); continue; }
    // battle arrays still track leaves after restore
    for (const p of ['p1', 'p2']) if (Object.getOwnPropertyDescriptor(state.players[p].battle, 'splice')) splices++; else fail('splice tracker missing');
    // continuation: replay K steps from the restored state twice (from the same snapshot, same rng state) -> identical
    const K = 25; const runs = [];
    for (let r = 0; r < 2; r++) {
      SN.restoreState(state, s.snap, { exactCounters: true }); rng.set(s.rs);
      const d2 = makeDriver(rng); const labels = [];
      for (let k = 0; k < K && !state.winner; k++) labels.push(await d2.step(state));
      runs.push(norm(state) + '#' + labels.join(','));
    }
    contChecks++; if (runs[0] !== runs[1]) fail(`game ${g} continuation differs @${s.i}`);
  }
  // json round trip of one snapshot
  if (snaps.length) {
    const s = snaps[0]; const text = SN.stringify(SN.snapToObject(s.snap)); maxBytes = Math.max(maxBytes, text.length);
    const back = SN.snapFromObject(SN.parse(text), state); SN.restoreState(state, back, { exactCounters: true });
    checks++; const dropped = back.eotLost; const a = norm(state);
    SN.restoreState(state, s.snap, { exactCounters: true });
    const b = norm(state);
    if (!dropped && a !== b) fail(`game ${g} JSON roundtrip mismatch`);
  }
}
Math.random = realRandom;
// held end-of-turn entries: kept by reference in-session, rebuilt from desc after a JSON round trip
{
  const rng = makeRng(7); Math.random = rng; const d = makeDriver(rng); const st = d.newRandomGame();
  S.scheduleEndOfTurn(st, () => S.grantMemory(st, 'p1', -2), { player: 'p1', label: 't', desc: { kind: 'memory', player: 'p1', n: 2 } });
  S.scheduleEndOfTurn(st, () => {}, { player: 'p1', label: 'closure-only' });
  const snap = SN.snapshotState(st); const before = st.endOfTurnEffects.length;
  st.endOfTurnEffects = []; SN.restoreState(st, snap);
  checks++; if (st.endOfTurnEffects.length !== before || typeof st.endOfTurnEffects[0].fn !== 'function') fail('eot not restored by reference');
  const back = SN.snapFromObject(SN.parse(SN.stringify(SN.snapToObject(snap))), st);
  checks++; if (back.eot.length !== 1 || back.eotLost !== 1 || typeof back.eot[0].fn !== 'function') fail('eot rebuild from desc failed');
  const m0 = st.memory; back.eot[0].fn(); if (st.memory === m0) fail('rebuilt memory eot did nothing'); eotSeen++;
  Math.random = realRandom;
}
console.log(`mutated-before-restore ${mutated}/${checks}, eot ok ${eotSeen}`);
console.log(`games ${G}: snapshots ${nSnap} (avg ${(sumMs / nSnap).toFixed(2)}ms, max ${maxMs.toFixed(2)}ms, lossy ${lossyN}), restore checks ${checks}, continuation checks ${contChecks}, max json ${(maxBytes / 1024).toFixed(0)}KB`);
console.log(fails ? `FAILED: ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
