// Headless CPU-vs-CPU game core for the measurement rig (scripts/cpu-arena.mjs) and the self-play optimiser (scripts/cpu-evolve.mjs).
// Everything here runs INSIDE one node process (worker); scripts/arena-pool.mjs fans tasks out over child processes.
//
// Config spec (JSON-serialisable):  { level: 'easy'|'normal'|'hard'|'expert', search: null | { nodes, depth, samples, rootBeam, beam, rollout }, params: null | {partial params} }
//   level 'expert'  = hard logic + EXPERT.params (data/cpu-params.json) + EXPERT search, unless `params` overrides the params (optimiser candidates use level 'hard' + params).
//   search === undefined -> the level's default: easy/normal none; hard = SEARCH_HARD; expert = EXPERT.search with EXPERT.headlessNodes.
// Search budgets are NODE counts here (deterministic and machine independent); the wall-clock budget is what the browser uses (see --timing in cpu-arena.mjs).
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Cpu from '../src/cpu.js';
import '../src/cpusearch.js'; // registers Cpu.HOOKS.search
import { createSim } from '../src/cpusim.js';

let READY = false;
export async function init() {
  if (READY) return;
  global.fetch = async (url) => { const p = String(url).replace(/^\.\//, ''); if (!fs.existsSync(p)) return { ok: false, json: async () => { throw new Error('missing'); } }; return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) }; };
  await S.loadData();
  await Cpu.loadParams();
  Cpu.setRng(() => Math.random());
  READY = true;
}

// the default 'hard' (UI: search on, 900 ms) expressed as a node budget (docs/cpu-play-evolution.md, decision-time table)
export const SEARCH_HARD = { nodes: 36, depth: 4, samples: 2, rootBeam: 8, beam: 5 }; // measured: 900 ms wall-clock budget = ~36 nodes (avg depth ~1.5) uncontended, see docs

// ---------- seeded rng ----------
let RS = 1;
export function seedRng(s) { RS = (s >>> 0) || 1; }
export function srand() { RS = (RS + 0x6D2B79F5) >>> 0; let t = RS; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

// ---------- deck pool (deterministic) ----------
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
function coherentDeck(name, cards) {
  const cols = Math.random() < 0.5 ? [pick(COLORS)] : [...new Set([pick(COLORS), pick(COLORS)])];
  const ok = (c) => (c.colors || []).length > 0 && c.colors.every((x) => cols.includes(x)) && !c.isParallel && !c.isToken;
  const byLv = (lv) => cards.filter((c) => c.category === 'digimon' && c.level === lv && ok(c) && c.cost != null);
  const eggs = cards.filter((c) => c.category === 'digitama' && ok(c));
  const tamers = cards.filter((c) => c.category === 'tamer' && ok(c));
  const opts = cards.filter((c) => c.category === 'option' && ok(c));
  const main = {}, dig = {};
  const add = (target, c, max) => { const cur = target[c.id] || 0; if (cur >= Math.min(max, S.maxCopiesFor(c.id))) return false; target[c.id] = cur + 1; return true; };
  const fill = (pool, n) => { let tries = 0, got = 0; while (got < n && pool.length && tries++ < 400) if (add(main, pick(pool), 4)) got++; };
  if (!eggs.length) return null;
  for (let i = 0; i < 5; i++) add(dig, pick(eggs), 4);
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  fill(byLv(3), 14); fill(byLv(4), 11); fill(byLv(5), 8); fill(byLv(6), 3); fill(tamers, 4); fill(opts, 6);
  const any = [...byLv(3), ...byLv(4), ...byLv(5), ...opts];
  let guard = 0; while (total(main) < 50 && any.length && guard++ < 2000) add(main, pick(any), 4);
  if (total(main) !== 50 || total(dig) < 1) return null;
  const d = { name, main, digitama: dig };
  return S.deckLegality(d).ok ? d : null;
}
function starterDeck(st, all) {
  const isEgg = (c) => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2);
  const cs = all.filter((c) => c.id.startsWith(st + '-'));
  const main = {}, eggs = {};
  const tot = (m) => Object.values(m).reduce((a, b) => a + b, 0);
  for (const c of cs) { if (c.category === 'digitama') eggs[c.id] = 4; else if (c.level === 2 && c.category === 'digimon') eggs[c.id] = 2; }
  const body = cs.filter((c) => !isEgg(c));
  const add = (c, n) => { const lim = Math.max(1, S.maxCopiesFor(c.id) || 4); const cur = main[c.id] || 0; main[c.id] = Math.min(cur + n, lim); };
  let g = 0; while (tot(main) < 50 && body.length && g++ < 500) add(pick(body), Math.random() < 0.5 ? 2 : 1);
  if (tot(main) < 50) {
    const cols = [...new Set(cs.flatMap((c) => c.colors || []))];
    const pool = all.filter((c) => ['digimon', 'tamer', 'option'].includes(c.category) && !isEgg(c) && (c.colors || []).length && c.colors.every((x) => cols.includes(x)));
    g = 0; while (tot(main) < 50 && pool.length && g++ < 3000) add(pick(pool), 1);
  }
  while (tot(eggs) > 5) { const k = Object.keys(eggs).pop(); eggs[k]--; if (!eggs[k]) delete eggs[k]; }
  if (!tot(eggs) || tot(main) !== 50) return null;
  return { name: st, main, digitama: eggs };
}
let POOL = null;
// starter-based decks + colour-coherent legal decks: `train` (used by the optimiser) and a held-out `val` pool (never used for fitting)
export function deckPool() {
  if (POOL) return POOL;
  const real = Math.random; seedRng(20260921); Math.random = srand;
  try {
    const all = Object.values(S.CARDS).filter((c) => !c.isToken);
    const STs = [...new Set(all.map((c) => (c.id.match(/^(ST\d+)-/) || [])[1]).filter(Boolean))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    const starters = [];
    for (const st of STs) { let d = null, g = 0; while (!d && g++ < 6) { d = starterDeck(st, all); if (d && !S.deckLegality(d).ok) d = null; } if (d) starters.push(d); }
    const pickN = (arr, n) => { const out = []; const a = arr.slice(); while (out.length < n && a.length) out.push(a.splice(Math.floor(srand() * a.length), 1)[0]); return out; };
    const st = pickN(starters, 8);
    const coh = []; let g = 0;
    while (coh.length < 16 && g++ < 400) { const d = coherentDeck('C' + coh.length, all); if (d) coh.push(d); }
    const tr = [...st.slice(0, 5), ...coh.slice(0, 11)], va = [...st.slice(5), ...coh.slice(11)];
    POOL = { train: tr, val: va, all: [...tr, ...va] };
  } finally { Math.random = real; }
  return POOL;
}

// ---------- spec -> runtime config ----------
export function resolve(spec) {
  const level = spec.level;
  let cfgLevel = level, params = null, sopts = null;
  if (level === 'expert') { cfgLevel = 'hard'; params = spec.params ? Cpu.makeParams(spec.params) : Cpu.EXPERT.params; }
  else if (spec.params) params = Cpu.makeParams(spec.params);
  let search = spec.search;
  if (search === undefined) search = level === 'hard' ? SEARCH_HARD : level === 'expert' ? { ...Cpu.EXPERT.search, nodes: Cpu.EXPERT.headlessNodes } : null;
  if (search && search.wall) sopts = { budgetMs: search.budgetMs || 900, hardCapMs: search.hardCapMs || 2500, maxNodes: 1e9, depth: search.depth || 4, samples: search.samples || 2, sliceMs: 30, ...(search.rootBeam ? { rootBeam: search.rootBeam } : {}), ...(search.beam ? { beam: search.beam } : {}) }; // real wall-clock budget (what the browser uses)
  else if (search && cfgLevel === 'hard') sopts = { budgetMs: 1e9, hardCapMs: 1e9, maxNodes: search.nodes || 250, depth: search.depth || 4, samples: search.samples || 2, sliceMs: 1e9, ...(search.rootBeam ? { rootBeam: search.rootBeam } : {}), ...(search.beam ? { beam: search.beam } : {}), ...(search.rollout != null ? { rollout: search.rollout } : {}) };
  return { level: cfgLevel, params, sopts, banned: new Set() };
}

// ---------- one game ----------
const TURN_CAP = 90;
// -> { winner: 'p1'|'p2'|'draw'|null, turns, stall, err, ms:{p1,p2}, n:{p1,p2}, maxMs:{p1,p2} }
export async function playGame(deck1, deck2, spec1, spec2, seed, opts = {}) {
  const realRandom = Math.random;
  seedRng(seed); Math.random = srand;
  const cfgs = { p1: resolve(spec1), p2: resolve(spec2) };
  const stats = { actions: 0, attacks: 0, blocks: 0, counters: 0 };
  const errs = [];
  const state = S.newGame(JSON.parse(JSON.stringify(deck1)), JSON.parse(JSON.stringify(deck2)));
  const res = { winner: null, turns: 0, stall: false, err: false, ms: { p1: 0, p2: 0 }, n: { p1: 0, p2: 0 }, maxMs: { p1: 0, p2: 0 }, errs };
  const t0 = Date.now();
  const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: (w, e) => errs.push(w + ': ' + String(e && e.message).slice(0, 80)), stats, ...(opts.hooks ? { hooks: opts.hooks } : {}) });
  try {
    try {
      E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
      const first = E.coinFlip();
      for (const p of [first, S.opponentOf(first)]) if (Cpu.shouldMulligan(state, p, cfgs[p].level, cfgs[p].params)) E.mulligan(state, p);
      E.setSecurityStacks(state); E.beginGame(state, first);
    } catch (e) { errs.push('setup: ' + e.message); res.err = true; return res; }
    for (let t = 0; t < TURN_CAP && !state.winner; t++) {
      if (Date.now() - t0 > (opts.gameMs || 120000)) { res.stall = true; break; }
      try {
        const p = state.activePlayer, cfg = cfgs[p];
        cfg.banned = new Set();
        await sim.beginTurn(p);
        if (state.winner) break;
        await sim.mainLoop(p, async () => {
          const t1 = performance.now();
          let act = null;
          if (cfg.sopts) act = await Cpu.HOOKS.search(state, p, cfg, cfg.sopts);
          if (!act) act = Cpu.planMain(state, p, cfg);
          if (opts.onDecide) opts.onDecide(state, p, act, cfg); // measurement probe (scripts/measure-options.mjs)
          const dt = performance.now() - t1; if (opts.trace && cfg.sopts) opts.trace.push({ ms: dt, depth: act && act.search ? act.search.depth : 0, nodes: act && act.search ? act.search.nodes : 0, side: p });
          res.ms[p] += dt; res.n[p]++; if (dt > res.maxMs[p]) res.maxMs[p] = dt;
          return act;
        });
        res.turns = state.turnNumber;
      } catch (e) { errs.push('turn: ' + String(e && e.stack).split('\n').slice(0, 3).join(' | ')); res.err = true; return res; }
    }
    res.turns = state.turnNumber;
    if (!state.winner) res.stall = true; else res.winner = state.winner;
    return res;
  } finally { Math.random = realRandom; }
}

// one PAIR = the same two decks + the same seed, played in both seat orders.  A and B keep their deck within a pair (pair parity swaps which config gets which deck).
// task: { pair, seed, pool: 'train'|'val'|'all', a: spec, b: spec }  ->  { pair, r: [ {win:'A'|'B'|'draw'|null, ...}, ... ] }
export async function playPair(task) {
  await init();
  const dp = deckPool()[task.pool || 'train'];
  const gr = (() => { let s = (task.seed * 2654435761) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const x = Math.floor(gr() * dp.length); let y = Math.floor(gr() * (dp.length - 1)); if (y >= x) y++;
  const dA = dp[task.pair % 2 === 0 ? x : y], dB = dp[task.pair % 2 === 0 ? y : x];
  const out = [];
  for (const aFirst of [true, false]) {
    const r = await playGame(aFirst ? dA : dB, aFirst ? dB : dA, aFirst ? task.a : task.b, aFirst ? task.b : task.a, task.seed * 2 + (aFirst ? 0 : 1) + 17, task);
    const seatA = aFirst ? 'p1' : 'p2', seatB = aFirst ? 'p2' : 'p1';
    out.push({ win: r.winner == null ? null : r.winner === 'draw' ? 'draw' : r.winner === seatA ? 'A' : 'B', turns: r.turns, stall: r.stall, err: r.err, msA: r.ms[seatA], nA: r.n[seatA], msB: r.ms[seatB], nB: r.n[seatB], maxA: r.maxMs[seatA], maxB: r.maxMs[seatB], first: aFirst ? 'A' : 'B', errs: r.errs.slice(0, 3) });
  }
  return { pair: task.pair, r: out };
}
