// Headless CPU-vs-CPU test: plays full games through the real engine (state.js / engine.js / effects.js scripts) with the
// src/cpu.js decision layer choosing every action, block, counter and prompt answer for BOTH players.
// Asserts: no exceptions, no stalls (turn cap), and reports win rates between levels (seats + decks swapped every other game).
//
// Run from the repo root:  node scripts/test-cpu.mjs [gamesPerMatchup=40; 300 = full run] [--only=hard-easy] [--tune=hardThrA:-2,…] [--random-decks] < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
import * as Cpu from '../src/cpu.js';
import * as CpuSearch from '../src/cpusearch.js';
import { createSim } from '../src/cpusim.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) || 40); // default: quick regression (test-all); pass 300 for the full calibration run
const RANDOM_DECKS = process.argv.includes('--random-decks');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const TURN_CAP = 90;
const argv = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
// search options for hard4: deterministic node budget instead of wall-clock (--nodes=250 --depth=4 --samples=2 --w=oppSec:1.3,prior:0.5)
const SOPTS = { budgetMs: 1e9, hardCapMs: 1e9, maxNodes: Number(argv('nodes', 250)), depth: Number(argv('depth', 4)), samples: Number(argv('samples', 2)), sliceMs: 1e9 };
if (argv('budget', '')) Object.assign(SOPTS, { budgetMs: Number(argv('budget')), hardCapMs: Number(argv('hardcap', 2500)), maxNodes: 1e9, sliceMs: 30 }); // real wall-clock budget (what the browser uses)
const TIME_CAP_MS = Number(argv('cap', 25000));
for (const kv of argv('w', '').split(',').filter(Boolean)) { const [k, v] = kv.split(':'); if (k in CpuSearch.W) CpuSearch.W[k] = Number(v); else if (k in CpuSearch.SEARCH) CpuSearch.SEARCH[k] = Number(v); else console.log('unknown w key', k); }
for (const kv of ((process.argv.find((a) => a.startsWith('--tune=')) || '').slice(7).split(',')).filter(Boolean)) { const [k, v] = kv.split(':'); if (k in Cpu.TUNE) Cpu.TUNE[k] = Number(v); else console.log('unknown tune key', k); } // e.g. --tune=hardReserve:0,hardThrA:0.2
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const cards = Object.values(S.CARDS);
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];

// ---------- deck generators ----------
function coherentDeck(name) {
  const cols = Math.random() < 0.5 ? [pick(COLORS)] : [...new Set([pick(COLORS), pick(COLORS)])];
  const ok = (c) => (c.colors || []).length > 0 && c.colors.every((x) => cols.includes(x)) && !c.isParallel;
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
const mainPool = cards.filter((c) => ['digimon', 'tamer', 'option'].includes(c.category));
const eggPool = cards.filter((c) => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2));
function randomDeck(name) { // soak.mjs style: NOT color-coherent, NOT copy-limited (robustness)
  const main = {}, dig = {};
  for (let i = 0; i < 50; i++) { const c = pick(mainPool); main[c.id] = (main[c.id] || 0) + 1; }
  for (let i = 0; i < 5; i++) { const c = pick(eggPool); dig[c.id] = (dig[c.id] || 0) + 1; }
  return { name, main, digitama: dig };
}
function makeDeck(name) { if (RANDOM_DECKS) return randomDeck(name); let d = null, g = 0; while (!d && g++ < 50) d = coherentDeck(name); return d || randomDeck(name); }

// ---------- error bookkeeping ----------
const errors = {};
function note(where, e) {
  const k = where + ': ' + String(e && e.message).slice(0, 100);
  errors[k] = errors[k] || { n: 0, stack: String(e && e.stack).split('\n').slice(0, 4).join(' | ') };
  errors[k].n++;
}

// ---------- headless game driver ----------
// level names: easy | normal | hard (heuristic) | hard4 (= hard + lookahead search, src/cpusearch.js)
const parseLv = (name) => (name === 'hard4' ? { level: 'hard', search: true } : { level: name, search: false });
const SEARCH_STATS = { n: 0, depth: 0, nodes: 0, ms: 0, ms95: [], fallback: 0, agree: 0 };
async function playGame(deckP1, deckP2, lv, gameNo) {
  const cfgs = { p1: { ...parseLv(lv.p1), banned: new Set() }, p2: { ...parseLv(lv.p2), banned: new Set() } };
  const state = S.newGame(deckP1, deckP2);
  const stats = { actions: 0, attacks: 0, blocks: 0, counters: 0, turns: 0 };
  const t0 = Date.now();
  const timeUp = () => Date.now() - t0 > TIME_CAP_MS;
  const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: note, stats });
  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
    const first = E.coinFlip();
    for (const p of [first, S.opponentOf(first)]) if (Cpu.shouldMulligan(state, p, cfgs[p].level)) E.mulligan(state, p);
    E.setSecurityStacks(state); E.beginGame(state, first);
  } catch (e) { note('setup', e); return { winner: null, stats, err: true }; }
  for (let t = 0; t < TURN_CAP && !state.winner; t++) {
    if (timeUp()) { note('stall', new Error('game exceeded wall clock cap')); return { winner: null, stats: { ...stats, turns: state.turnNumber }, stall: true }; }
    try {
      const p = state.activePlayer;
      const cfg = cfgs[p];
      cfg.banned = new Set();
      await sim.beginTurn(p);
      if (state.winner) break;
      await sim.mainLoop(p, async () => {
        if (cfg.search) {
          const t1 = performance.now();
          const act = await Cpu.HOOKS.search(state, p, cfg, SOPTS);
          const dt = performance.now() - t1;
          if (act) { SEARCH_STATS.n++; SEARCH_STATS.depth += act.search.depth; SEARCH_STATS.nodes += act.search.nodes; SEARCH_STATS.ms += dt; SEARCH_STATS.ms95.push(dt); if (act.search.agrees) SEARCH_STATS.agree++; return act; }
          SEARCH_STATS.fallback++;
        }
        return Cpu.planMain(state, p, cfg);
      });
      stats.turns = state.turnNumber;
    } catch (e) { note('turn', e); return { winner: null, stats, err: true }; }
  }
  if (!state.winner) return { winner: null, stats: { ...stats, turns: state.turnNumber }, stall: true };
  return { winner: state.winner, stats: { ...stats, turns: state.turnNumber }, turnsEnd: state.turnNumber };
}

// ---------- matchups ----------
async function matchup(hi, lo, n) {
  const res = { hiWins: 0, loWins: 0, draws: 0, stalls: 0, errs: 0, turns: 0, games: 0, ms: 0 };
  const t0 = Date.now();
  for (let g = 0; g < n; g += 2) {
    const dA = makeDeck('A'), dB = makeDeck('B');
    for (let k = 0; k < 2 && g + k < n; k++) {
      const lv = k === 0 ? { p1: hi, p2: lo } : { p1: lo, p2: hi };
      const r = await playGame(dA, dB, lv, g + k);
      res.games++;
      if (r.err) { res.errs++; continue; }
      res.turns += r.stats.turns || 0;
      if (r.stall) { res.stalls++; continue; }
      if (r.winner === 'draw') { res.draws++; continue; }
      const hiSeat = k === 0 ? 'p1' : 'p2';
      if (r.winner === hiSeat) res.hiWins++; else res.loWins++;
    }
  }
  res.ms = Date.now() - t0;
  return res;
}
const fmt = (hi, lo, r) => `${hi} vs ${lo}: ${r.hiWins}-${r.loWins}  (games ${r.games}, draws ${r.draws}, stalls ${r.stalls}, errs ${r.errs}, avg turns ${(r.turns / Math.max(1, r.games)).toFixed(1)}, ${(r.ms / 1000).toFixed(1)}s)  ${hi} win-rate ${(100 * r.hiWins / Math.max(1, r.hiWins + r.loWins)).toFixed(1)}%`;

const plan = ONLY ? [ONLY.split('-')] : [['hard', 'easy'], ['normal', 'easy'], ['hard', 'normal'], ['easy', 'easy'], ['normal', 'normal'], ['hard', 'hard']];
let fail = 0;
console.log(`CPU-vs-CPU headless test: ${N} games per matchup, ${RANDOM_DECKS ? 'random (soak-style) decks' : 'color-coherent legal decks'}`);
for (const [hi, lo] of plan) {
  const r = await matchup(hi, lo, N);
  console.log(fmt(hi, lo, r));
  const decided = r.hiWins + r.loWins;
  if (r.errs || r.stalls > Math.max(2, r.games * 0.02)) { fail++; console.log('  FAIL: errors/stalls above tolerance'); }
  if (hi !== lo && ['easy'].includes(lo) && decided > 20 && r.hiWins / decided < 0.6) { fail++; console.log(`  FAIL: ${hi} should beat ${lo} > 60%`); }
  if (hi === 'hard' && lo === 'normal' && decided > 20 && r.hiWins / decided < 0.5) console.log('  WARN: hard did not beat normal (not a failure: same heuristic core, small edge)');
}
if (SEARCH_STATS.n || SEARCH_STATS.fallback) { const ms = SEARCH_STATS.ms95.sort((a, b) => a - b); console.log(`search: ${SEARCH_STATS.n} decisions, avg depth ${(SEARCH_STATS.depth / Math.max(1, SEARCH_STATS.n)).toFixed(2)}, avg nodes ${(SEARCH_STATS.nodes / Math.max(1, SEARCH_STATS.n)).toFixed(0)}, avg ${(SEARCH_STATS.ms / Math.max(1, SEARCH_STATS.n)).toFixed(0)}ms, p95 ${(ms[Math.floor(ms.length * 0.95)] || 0).toFixed(0)}ms, agree-with-heuristic ${(100 * SEARCH_STATS.agree / Math.max(1, SEARCH_STATS.n)).toFixed(0)}%, fallbacks ${SEARCH_STATS.fallback}`); }
const keys = Object.keys(errors);
console.log('distinct errors:', keys.length);
for (const k of keys.sort((a, b) => errors[b].n - errors[a].n).slice(0, 20)) console.log(errors[k].n, k, '\n     ', errors[k].stack);
console.log(fail || keys.length ? 'RESULT: PROBLEMS' : 'RESULT: OK');
process.exit(fail || keys.length ? 1 : 0);
