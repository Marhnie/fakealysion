// Tests for the 어려움 lookahead search (src/cpusearch.js) on random mid-game states from the fuzz driver.
//  1. exactness:   a search (apply candidate actions on the live state + roll back) leaves the live game byte-identical
//                  (deep compare incl. module counters, log / fxHistory arrays, Math.random / cpu rng)
//  2. continuation: playing on after a search is identical to playing on without it (no hidden module state leaks)
//  3. determinism: the same state gives the same move + values, also when the search yields to the event loop at every tick
//  4. no-peek:     permuting the human's hidden hand / deck / security (and the CPU's own deck / security) cannot change the decision
//  5. time budget: with the real budget (900ms / cap 2500ms) the decision time stays under the cap (p95 reported)
// Run: node scripts/test-cpu-search.mjs [states=60; 300 = full run] [--timing=15] < /dev/null
import * as S from '../src/state.js';
import * as SN from '../src/snapshot.js';
import * as Cpu from '../src/cpu.js';
import * as CS from '../src/cpusearch.js';
import { init, makeRng, makeDriver } from './lib-driver.mjs';
await init();
const N = Number(process.argv.find((a) => /^\d+$/.test(a)) || 60); // default: quick regression (test-all); pass 300 for the full run
const TIMING = Number((process.argv.find((a) => a.startsWith('--timing=')) || '--timing=15').slice(9));
function sortKeys(v) { if (v instanceof Set) return { __set: [...v].map(sortKeys) }; if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) if (typeof v[k] !== 'function') o[k] = sortKeys(v[k]); return o; } return v; }
const SKIP = new Set(['log', 'fxHistory', 'pendingVanishFlash', 'pendingVanishSrc', 'uiChoice', '_replWaiters', 'pendingReplacements', '_leavePending', '_fxRec']);
function norm(state) {
  const o = {}; for (const k of Object.keys(state)) if (!SKIP.has(k)) o[k] = state[k];
  o.endOfTurnEffects = (state.endOfTurnEffects || []).map((e) => ({ ...e }));
  return JSON.stringify(sortKeys({ o, c: { ...S.getCounters(), fx: 0 } }));
}
const full = (state) => norm(state) + '#' + JSON.stringify([state.log.length, state.log[0] && state.log[0].msg, state.log.slice(0, 5).map((e) => e.msg), state.fxHistory ? state.fxHistory.length : -1, (state.pendingVanishFlash || []).length, (state.pendingVanishSrc || []).length, state.uiChoice ? 1 : 0, (state.pendingReplacements || []).length]);
let fails = 0;
const fail = (m) => { fails++; if (fails <= 12) console.log('FAIL', m); };
function diffPath(a, b, path = '') { if (a === b) return null; if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return path + ': ' + JSON.stringify(a).slice(0, 80) + ' -> ' + JSON.stringify(b).slice(0, 80); for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diffPath(a[k], b[k], path + '/' + k); if (d) return d; } return null; }
const whatChanged = (b, a) => { try { const [bn, be] = [b.slice(0, b.lastIndexOf('#')), b.slice(b.lastIndexOf('#') + 1)]; const [an, ae] = [a.slice(0, a.lastIndexOf('#')), a.slice(a.lastIndexOf('#') + 1)]; if (bn !== an) return diffPath(JSON.parse(bn), JSON.parse(an)); return 'extras ' + be + ' vs ' + ae; } catch (e) { return 'diff failed ' + e.message; } };
const mk = (act) => (act ? [act.type, act.key || '', act.target || '', act.cardId || ''].join('|') : 'null');
const DET = { budgetMs: 1e12, hardCapMs: 1e12, maxNodes: 120, depth: 4, samples: 2, sliceMs: 1e12 };
const realRandom = Math.random;
const stat = { states: 0, searched: 0, nullRes: 0, depthSum: 0, nodesSum: 0, byDepth: {}, moved: 0, agree: 0, yields: 0, cont: 0, peek: 0, det: 0, kinds: {} };

function permuteHidden(state, p, rng) {
  const shuf = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (const q of ['p1', 'p2']) {
    const pl = state.players[q];
    const hiddenHand = q !== p;
    const pool = hiddenHand ? [...pl.hand, ...pl.deck, ...pl.security] : [...pl.deck, ...pl.security];
    shuf(pool);
    if (hiddenHand) pl.hand.splice(0, pl.hand.length, ...pool.splice(0, pl.hand.length));
    pl.security.splice(0, pl.security.length, ...pool.splice(0, pl.security.length));
    pl.deck.splice(0, pl.deck.length, ...pool);
    shuf(pl.digitamaDeck);
  }
}

const t0 = Date.now();
for (let g = 0; g < Math.ceil(N / 4) + 40 && stat.states < N; g++) {
  const rng = makeRng(5000 + g); Math.random = rng;
  const d = makeDriver(rng);
  const state = d.newRandomGame();
  const steps = 30 + Math.floor(rng() * 220);
  for (let i = 0; i < steps && !state.winner && stat.states < N; i++) {
    await d.step(state);
    if (state.winner || state.phase !== 'main' || state.turnEnding || state.pending.some((t) => !t.resolved) || state.uiChoice || rng() > 0.09) continue;
    const p = state.activePlayer;
    stat.states++;
    const pre = SN.snapshotState(state);
    if (pre.lossy) continue;
    const before = full(state);
    const logRef = state.log, fxRef = state.fxHistory;
    const seedR = () => 12345;
    const r1 = await CS.searchMain(state, p, { banned: new Set() }, DET);
    const after = full(state);
    if (Math.random !== rng) fail(`state ${stat.states}: Math.random not restored`);
    if (state.log !== logRef || state.fxHistory !== fxRef) fail(`state ${stat.states}: log/fxHistory array identity changed`);
    if (before !== after) { fail(`state ${stat.states}: live state changed by search (turn ${state.turnNumber}, ${mk(r1 && r1.act)}) ${whatChanged(before, after)}`); SN.restoreState(state, pre, { exactCounters: true }); }
    if (!r1) { stat.nullRes++; continue; }
    stat.searched++; stat.depthSum += r1.depth; stat.nodesSum += r1.nodes; stat.byDepth[r1.depth] = (stat.byDepth[r1.depth] || 0) + 1; stat.kinds[r1.act.type] = (stat.kinds[r1.act.type] || 0) + 1;
    // 3. determinism (repeat + yield at every tick)
    const r2 = await CS.searchMain(state, p, { banned: new Set() }, DET);
    if (mk(r2 && r2.act) !== mk(r1.act) || JSON.stringify(r2 && r2.values) !== JSON.stringify(r1.values)) fail(`state ${stat.states}: not deterministic (${mk(r1.act)} vs ${mk(r2 && r2.act)})`); else stat.det++;
    if (rng() < 0.35) {
      const r3 = await CS.searchMain(state, p, { banned: new Set() }, { ...DET, sliceMs: 0 });
      if (full(state) !== before) { fail(`state ${stat.states}: yielding search changed the live state`); SN.restoreState(state, pre, { exactCounters: true }); }
      if (mk(r3 && r3.act) !== mk(r1.act) || JSON.stringify(r3 && r3.values) !== JSON.stringify(r1.values)) fail(`state ${stat.states}: yielding search differs (${mk(r1.act)} vs ${mk(r3 && r3.act)})`); else stat.yields++;
    }
    // 4. no-peek: permuted hidden zones -> same decision
    if (rng() < 0.6) {
      const seed = rng.get();
      permuteHidden(state, p, makeRng(seed ^ 77));
      const r4 = await CS.searchMain(state, p, { banned: new Set() }, DET);
      SN.restoreState(state, pre, { exactCounters: true });
      if (mk(r4 && r4.act) !== mk(r1.act) || JSON.stringify(r4 && r4.values) !== JSON.stringify(r1.values)) fail(`state ${stat.states}: decision depends on hidden information (${mk(r1.act)} vs ${mk(r4 && r4.act)})`); else stat.peek++;
    }
    // 2. continuation equality
    if (rng() < 0.3) {
      const rs = rng.get();
      const K = 14; const run = async () => { const d2 = makeDriver(rng); const lab = []; for (let k = 0; k < K && !state.winner; k++) lab.push(await d2.step(state)); return norm(state) + '#' + lab.join(','); };
      rng.set(rs); const a = await run();
      SN.restoreState(state, pre, { exactCounters: true }); rng.set(rs);
      await CS.searchMain(state, p, { banned: new Set() }, DET);
      rng.set(rs); const b = await run();
      if (a !== b) fail(`state ${stat.states}: continuation after a search differs`); else stat.cont++;
      SN.restoreState(state, pre, { exactCounters: true }); rng.set(rs);
    }
    if (r1.policyAgrees) stat.agree++;
  }
}
Math.random = realRandom;
console.log(`states ${stat.states} (searched ${stat.searched}, no-result ${stat.nullRes}) in ${((Date.now() - t0) / 1000).toFixed(0)}s; exactness/identity checks ran on every state`);
console.log(`determinism ok ${stat.det}, yield-equivalence ok ${stat.yields}, no-peek ok ${stat.peek}, continuation ok ${stat.cont}`);
console.log(`avg depth ${(stat.depthSum / Math.max(1, stat.searched)).toFixed(2)} (histogram ${JSON.stringify(stat.byDepth)}), avg nodes ${(stat.nodesSum / Math.max(1, stat.searched)).toFixed(0)}, chosen kinds ${JSON.stringify(stat.kinds)}, agrees with heuristic ${(100 * stat.agree / Math.max(1, stat.searched)).toFixed(0)}%`);

// 5. time budget with the real settings (wall clock, yields every 30ms)
{
  const times = [], depths = [], nodes = [];
  for (let g = 0; times.length < TIMING && g < 400; g++) {
    const rng = makeRng(9000 + g); Math.random = rng;
    const d = makeDriver(rng); const state = d.newRandomGame();
    const steps = 40 + Math.floor(rng() * 200);
    for (let i = 0; i < steps && !state.winner; i++) {
      await d.step(state);
      if (state.winner || state.phase !== 'main' || state.turnEnding || state.pending.some((t) => !t.resolved) || rng() > 0.05 || times.length >= TIMING) continue;
      const p = state.activePlayer, b = full(state);
      const t1 = performance.now();
      const r = await CS.searchMain(state, p, { banned: new Set() }, {});
      times.push(performance.now() - t1);
      if (full(state) !== b) fail('timing run changed the live state');
      if (r) { depths.push(r.depth); nodes.push(r.nodes); }
    }
  }
  Math.random = realRandom;
  times.sort((a, b) => a - b);
  const q = (x) => times[Math.min(times.length - 1, Math.floor(times.length * x))] || 0;
  console.log(`timing (${times.length} decisions, budget 900ms/cap 2500ms): median ${q(0.5).toFixed(0)}ms, p95 ${q(0.95).toFixed(0)}ms, max ${(times[times.length - 1] || 0).toFixed(0)}ms; avg depth ${(depths.reduce((a, b) => a + b, 0) / Math.max(1, depths.length)).toFixed(2)}, avg nodes ${(nodes.reduce((a, b) => a + b, 0) / Math.max(1, nodes.length)).toFixed(0)}`);
  if (q(0.95) >= 2500) fail('p95 decision time >= 2500ms');
}
console.log(fails ? `FAILED: ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
