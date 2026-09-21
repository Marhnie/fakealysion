// Measurement harness (measurement only — no engine/CPU source is modified).
// Plays full CPU-vs-CPU games through the real engine (state.js/engine.js/effects.js + cpu.js decision layer, via cpusim.js) with
// per-seat POLICY OVERRIDES implemented as wrappers around the exported CPU functions (see docs/measure-empirical.md §방법).
//   * Math.random is replaced by a seeded PRNG for every game (the engine shuffles / coin flips via Math.random) -> reproducible by seed.
//   * per-seat TUNE overrides: Cpu.TUNE is a module-global; cfgOf(p) (called right before every planBreeding/decideBlock/decideCounter)
//     and our own planMain wrapper both install the calling seat's TUNE first (everything is synchronous) => per-seat knobs.
import * as fs from 'fs';
import * as S from '../../src/state.js';
import * as E from '../../src/engine.js';
import * as Cpu from '../../src/cpu.js';
import { createSim } from '../../src/cpusim.js';

global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(new URL('../../' + url.replace(/^\.\//, ''), import.meta.url), 'utf8')) });
let inited = false;
export async function init() { if (inited) return; inited = true; await S.loadData(); Cpu.setRng(() => Math.random()); }

export function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hashSeed(...xs) { let h = 2166136261 >>> 0; for (const x of xs) for (const ch of String(x)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
export const seedMath = (seed) => { Math.random = mulberry(seed); };

// ---------------- decks ----------------
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
let POOLS = null;
function pools() {
  if (POOLS) return POOLS;
  const cards = Object.values(S.CARDS).filter((c) => !c.isToken && !c.isParallel);
  POOLS = { cards };
  return POOLS;
}
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const sumv = (o) => Object.values(o).reduce((a, b) => a + b, 0);
export const DEFAULT_COMP = { eggs: 5, lv3: 14, lv4: 11, lv5: 8, lv6: 3, tamers: 4, opts: 6 };
const CP = new Map();
function colorPools(cc) {
  const key = [...cc].sort().join('+'); let r = CP.get(key); if (r) return r;
  const ok = (c) => (c.colors || []).length > 0 && c.colors.every((x) => cc.includes(x));
  const cards = pools().cards; r = { lv: {}, eggs: cards.filter((c) => c.category === 'digitama' && ok(c)), tamers: cards.filter((c) => c.category === 'tamer' && ok(c)), opts: cards.filter((c) => c.category === 'option' && ok(c)) };
  for (const c of cards) if (c.category === 'digimon' && ok(c) && c.cost != null) (r.lv[c.level] ||= []).push(c);
  CP.set(key, r); return r;
}
// colour-coherent legal deck (same generator family as scripts/test-cpu.mjs coherentDeck) with tunable composition.
export function genDeck(name, comp = {}, cols = null) {
  const cm = { ...DEFAULT_COMP, ...comp };
  const { cards } = pools();
  for (let attempt = 0; attempt < 60; attempt++) {
    const cc = cols || (Math.random() < 0.5 ? [pick(COLORS)] : [...new Set([pick(COLORS), pick(COLORS)])]);
    const cp = colorPools(cc), byLv = (lv) => cp.lv[lv] || [], eggs = cp.eggs, tamers = cp.tamers, opts = cp.opts;
    if (!eggs.length || !byLv(3).length || !byLv(4).length) continue;
    const main = {}, dig = {};
    const add = (t, c, max) => { const cur = t[c.id] || 0; if (cur >= Math.min(max, S.maxCopiesFor(c.id))) return false; t[c.id] = cur + 1; return true; };
    const fill = (pool, n) => { let tries = 0, got = 0; while (got < n && pool.length && tries++ < 500) if (add(main, pick(pool), 4)) got++; };
    let g = 0; while (sumv(dig) < cm.eggs && g++ < 200) add(dig, pick(eggs), 4);
    fill(byLv(3), cm.lv3); fill(byLv(4), cm.lv4); fill(byLv(5), cm.lv5); fill(byLv(6), cm.lv6); fill(tamers, cm.tamers); fill(opts, cm.opts);
    const any = [...byLv(3), ...byLv(4), ...byLv(5), ...opts];
    g = 0; while (sumv(main) < 50 && any.length && g++ < 3000) add(main, pick(any), 4);
    while (sumv(main) > 50) { const k = pick(Object.keys(main)); main[k]--; if (!main[k]) delete main[k]; }
    if (sumv(main) !== 50 || sumv(dig) < 1) continue;
    const d = { name, main, digitama: dig, cols: cc };
    if (S.deckLegality(d).ok) return d;
  }
  return null;
}
// random composition (for the regression experiment)
export function randomComp() {
  const r = (a, b) => a + rnd(b - a + 1);
  return { eggs: r(3, 5), lv3: r(6, 22), lv4: r(4, 16), lv5: r(0, 12), lv6: r(0, 6), tamers: r(0, 8), opts: r(0, 12) };
}
const KW = { blocker: /[《≪]블로커[》≫]/, jam: /[《≪]재밍[》≫]/, recovery: /[《≪]리커버리/, pierce: /[《≪]관통[》≫]/, rush: /[《≪]속공[》≫]/, reboot: /[《≪]재기동[》≫]/, secatk: /시큐리티\s*어택/ };
const kwOf = (c) => { const t = (c.effectKo || '') + '\n' + (c.inheritedKo || ''); const o = {}; for (const k of Object.keys(KW)) o[k] = KW[k].test(t) ? 1 : 0; return o; };
const KWC = {};
export function cardKw(id) { return (KWC[id] ||= kwOf(S.card(id))); }
export function deckFeatures(d) {
  const f = { eggs: sumv(d.digitama), lv3: 0, lv4: 0, lv5: 0, lv6: 0, lv7: 0, tamers: 0, opts: 0, blocker: 0, jam: 0, recovery: 0, pierce: 0, rush: 0, reboot: 0, secatk: 0, costSum: 0, dpSum: 0, digimon: 0, cheapLv3: 0, eggLv3free: 0 };
  for (const [id, q] of Object.entries(d.main)) {
    const c = S.card(id);
    if (c.category === 'digimon') { f['lv' + c.level] = (f['lv' + c.level] || 0) + q; f.digimon += q; f.costSum += (c.cost || 0) * q; f.dpSum += (c.dp || 0) * q; if (c.level === 3 && (c.cost || 0) <= 3) f.cheapLv3 += q; }
    else if (c.category === 'tamer') f.tamers += q; else if (c.category === 'option') f.opts += q;
    const k = cardKw(id); for (const kk of Object.keys(k)) f[kk] += k[kk] * q;
  }
  f.avgCost = f.digimon ? f.costSum / f.digimon : 0; f.avgDp = f.digimon ? f.dpSum / f.digimon : 0;
  return f;
}
// frozen pseudo-starter decks: data/decks.json is empty, so an "ST##" deck = that set's cards (digitama x4 / Lv2 x2 as breeding, rest random 1-2 copies,
// topped up with same-colour cards to a legal 50) built ONCE with a fixed seed.  NOT the real preconstructed lists.
export function starterDecks() {
  const saved = Math.random; Math.random = mulberry(424242);
  const all = Object.values(S.CARDS).filter((c) => !c.isToken);
  const isEgg = (c) => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2);
  const mainPool = all.filter((c) => ['digimon', 'tamer', 'option'].includes(c.category) && !isEgg(c));
  const STS = [...new Set(all.map((c) => (c.id.match(/^(ST\d+)-/) || [])[1]).filter(Boolean))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  const out = [];
  for (const st of STS) {
    const cs = all.filter((c) => c.id.startsWith(st + '-') && !c.isParallel);
    const main = {}, eggs = {};
    for (const c of cs) { if (c.category === 'digitama') eggs[c.id] = 4; else if (c.level === 2 && c.category === 'digimon') eggs[c.id] = 2; }
    const body = cs.filter((c) => !isEgg(c) && ['digimon', 'tamer', 'option'].includes(c.category));
    let g = 0; while (sumv(main) < 50 && body.length && g++ < 500) { const c = pick(body); const cur = main[c.id] || 0; const add = Math.random() < 0.5 ? 2 : 1; if (cur < Math.min(4, S.maxCopiesFor(c.id))) main[c.id] = Math.min(cur + add, Math.min(4, S.maxCopiesFor(c.id))); }
    if (sumv(main) < 50) { const cols = [...new Set(cs.flatMap((c) => c.colors || []))]; const pool = mainPool.filter((c) => (c.colors || []).length && c.colors.every((x) => cols.includes(x))); g = 0; while (sumv(main) < 50 && pool.length && g++ < 3000) { const c = pick(pool); const cur = main[c.id] || 0; if (cur < Math.min(4, S.maxCopiesFor(c.id))) main[c.id] = cur + 1; } }
    if (!sumv(eggs)) continue;
    while (sumv(eggs) > 5) { const k = Object.keys(eggs).pop(); eggs[k]--; if (!eggs[k]) delete eggs[k]; }
    const d = { name: st, main, digitama: eggs };
    if (S.deckLegality(d).ok) out.push(d);
  }
  Math.random = saved;
  return out;
}

// ---------------- policies ----------------
// Policy (per seat): { level:'hard', mull:'cpu'|'keep'|'noLv3'|'cost3'|'always'|'lv3or4', hatchFrom:1, moveMinLv:3, noHatch:false, tune:{...}, atk:'base'|'player'|'digi', giftBias }
export const BASE_POL = { level: 'hard', mull: 'cpu', hatchFrom: 1, moveMinLv: 3, noHatch: false, tune: {}, atk: 'base' };
function mulliganDecision(state, p, pol) {
  const hand = state.players[p].hand.map((id) => S.card(id));
  const lv3 = hand.filter((c) => c.category === 'digimon' && c.level === 3);
  const cheap = lv3.filter((c) => (c.cost || 0) <= 3);
  switch (pol.mull) {
    case 'keep': return false;
    case 'always': return true;
    case 'noLv3': return lv3.length === 0;
    case 'cost3': return cheap.length === 0;
    case 'lv3or4': return !hand.some((c) => c.category === 'digimon' && (c.level === 3 || c.level === 4) && (c.cost || 0) <= 4);
    default: return Cpu.shouldMulligan(state, p, pol.level);
  }
}
const memOf = (state, p) => (p === 'p1' ? state.memory : -state.memory);
const TUNE0 = { ...Cpu.TUNE };
const lvOf = (st) => { const c = S.card(st.cardId); return c.category === 'digimon' || c.category === 'digitama' ? (c.level || 0) : 0; };

// ---------------- one game ----------------
// spec: { seed, deck:{p1,p2}, first:'p1'|'p2', pol:{p1,p2}, turnCap, timeMs }
export async function playGame(spec) {
  seedMath(spec.seed);
  const pols = { p1: { ...BASE_POL, ...spec.pol.p1 }, p2: { ...BASE_POL, ...spec.pol.p2 } };
  const cfgs = { p1: { level: pols.p1.level, banned: new Set() }, p2: { level: pols.p2.level, banned: new Set() } };
  const applyTune = (p) => { Object.assign(Cpu.TUNE, TUNE0, pols[p].tune || {}); };
  const state = S.newGame(spec.deck.p1, spec.deck.p2);
  const stats = { actions: 0, attacks: 0, blocks: 0, counters: 0 };
  const T = { acts: { p1: {}, p2: {} }, cost: { p1: {}, p2: {} }, connectP: { p1: 0, p2: 0 }, attDigi: { p1: 0, p2: 0 }, blocks: { p1: 0, p2: 0 }, counters: { p1: 0, p2: 0 }, attackDecl: { p1: 0, p2: 0 } };
  const hooks = {
    attackDeclared: ({ p, target }) => { T.attackDecl[p]++; if (target !== 'PLAYER') T.attDigi[p]++; },
    connect: ({ p, pa }) => { if (pa.targetKind === 'player') T.connectP[p]++; },
    blockBefore: ({ op }) => { T.blocks[op]++; },
    counter: ({ op }) => { T.counters[op]++; },
  };
  const sim = createSim(state, { cfgOf: (p) => { applyTune(p); return cfgs[p]; }, onError: () => { errs++; }, stats, hooks });
  let errs = 0;
  const rec = { seed: spec.seed, first: spec.first, mull: { p1: 0, p2: 0 }, hand: { p1: [], p2: [] }, turns: [], own: { p1: { lv4: 0, lv5: 0, lv6: 0, hatchT: 0, moveT: 0, tamerMax: 0, boardMax: 0 }, p2: { lv4: 0, lv5: 0, lv6: 0, hatchT: 0, moveT: 0, tamerMax: 0, boardMax: 0 } } };
  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
    const first = spec.first || E.coinFlip();
    for (const p of [first, S.opponentOf(first)]) if (mulliganDecision(state, p, pols[p])) { E.mulligan(state, p); rec.mull[p] = 1; }
    rec.hand.p1 = state.players.p1.hand.slice(); rec.hand.p2 = state.players.p2.hand.slice();
    E.setSecurityStacks(state);
    const hc = spec.handicap; // {seat, kind}: resource handicap for the exchange-rate experiment
    if (hc) { const hp = state.players[hc.seat]; if (hc.kind === 'sec-1') hp.trash.push(hp.security.shift()); else if (hc.kind === 'sec+1') hp.security.unshift(hp.deck.shift()); else if (hc.kind === 'hand+1') hp.hand.push(hp.deck.shift()); else if (hc.kind === 'hand-1') hp.trash.push(hp.hand.splice(Math.floor(Math.random() * hp.hand.length), 1)[0]); else if (hc.kind === 'deck-5') for (let z = 0; z < 5; z++) hp.trash.push(hp.deck.shift()); }
    E.beginGame(state, first);
    if (hc && hc.kind.startsWith('mem+')) state.memory = (hc.seat === 'p1' ? 1 : -1) * Number(hc.kind.slice(4));
  } catch (e) { return { err: 'setup ' + e.message, seed: spec.seed }; }
  const ownIdx = { p1: 0, p2: 0 };
  const TURN_CAP = spec.turnCap || 90, t0 = Date.now(), TIME = spec.timeMs || 40000;
  let stall = false;
  for (let t = 0; t < TURN_CAP && !state.winner; t++) {
    if (Date.now() - t0 > TIME) { stall = true; break; }
    const p = state.activePlayer, op = S.opponentOf(p), pol = pols[p], cfg = cfgs[p], pl = state.players[p];
    ownIdx[p]++;
    try {
      // --- unsuspend / draw / breeding (policy-controlled breeding)
      applyTune(p);
      let g = 0;
      while ((state.phase === 'unsuspend' || state.phase === 'draw') && g++ < 6) { E.nextPhase(state); await sim.drain(); if (state.winner) break; }
      if (state.winner) break;
      if (state.phase === 'breeding') {
        let b = Cpu.planBreeding(state, p, cfg);
        if (b.type === 'hatch' && (pol.noHatch || ownIdx[p] < pol.hatchFrom)) b = { type: 'skipBreeding' };
        if (b.type === 'move' && lvOf(pl.raising) < pol.moveMinLv && pl.digitamaDeck.length > 0) b = { type: 'skipBreeding' };
        if (b.type === 'hatch') { S.hatchDigitama(state, p); if (!rec.own[p].hatchT) rec.own[p].hatchT = ownIdx[p]; }
        else if (b.type === 'move') { S.moveRaisingToBattle(state, p); if (!rec.own[p].moveT) rec.own[p].moveT = ownIdx[p]; }
        await sim.drain(); E.nextPhase(state); await sim.drain();
      }
      if (state.winner) break;
      // --- main phase
      let lastPass = false, memBefore = 0, spent = 0;
      const a0 = stats.actions;
      await sim.mainLoop(p, async () => {
        applyTune(p);
        memBefore = memOf(state, p);
        let act = Cpu.planMain(state, p, cfg);
        if (act.type === 'attack' && pol.atk !== 'base') act = retarget(state, p, act, pol.atk);
        if (pol.pref && (act.type === 'play' || act.type === 'evolve')) act = preferKind(state, p, act, pol.pref, cfg);
        T.acts[p][act.type] = (T.acts[p][act.type] || 0) + 1; T.cost[p][act.type] = (T.cost[p][act.type] || 0) + (act.cost || 0);
        lastPass = act.type === 'pass';
        return act;
      });
      const opl = state.players[op];
      const all = [pl.raising, ...pl.battle].filter(Boolean);
      const mxLv = Math.max(0, ...all.map(lvOf));
      const o = rec.own[p];
      if (mxLv >= 4 && !o.lv4) o.lv4 = ownIdx[p]; if (mxLv >= 5 && !o.lv5) o.lv5 = ownIdx[p]; if (mxLv >= 6 && !o.lv6) o.lv6 = ownIdx[p];
      const tam = pl.battle.filter((s) => S.card(s.cardId).category === 'tamer').length;
      if (tam > o.tamerMax) o.tamerMax = tam;
      const bd = pl.battle.filter((s) => S.card(s.cardId).category === 'digimon').length;
      if (bd > o.boardMax) o.boardMax = bd;
      // turn record: [p(0/1), passed, memLeftBeforeLastDecision, giftToOpp, secMe, secOpp, maxLvMe, digimonBoardMe, tamersMe, handMe, digimonBoardOpp, actionsThisTurn]
      rec.turns.push([p === 'p1' ? 0 : 1, lastPass ? 1 : 0, memBefore, state.winner ? 0 : memOf(state, op), pl.security.length, opl.security.length, mxLv, bd, tam, pl.hand.length, opl.battle.filter((s) => S.card(s.cardId).category === 'digimon').length, stats.actions - a0]);
    } catch (e) { return { err: 'turn ' + e.message + ' ' + String(e.stack).split('\n')[1], seed: spec.seed }; }
  }
  const lastLog = state.log.slice(0, 8).map((e) => e.msg).join(' | ');
  let end = 'stall';
  if (state.winner === 'draw') end = 'loop'; else if (state.winner) end = /덱아웃/.test(lastLog) ? 'deckout' : /시큐리티 0에서 피격/.test(lastLog) ? 'security' : /투항/.test(lastLog) ? 'surrender' : 'other';
  rec.winner = state.winner; rec.end = end; rec.turnNumber = state.turnNumber; rec.actions = stats.actions; rec.attacks = stats.attacks; rec.T = T; rec.errs = errs; rec.stall = stall && !state.winner;
  rec.secEnd = { p1: state.players.p1.security.length, p2: state.players.p2.security.length };
  rec.deckEnd = { p1: state.players.p1.deck.length, p2: state.players.p2.deck.length };
  return rec;
}

// evolve-vs-play preference wrapper (variants pref:'evolve' / pref:'play')
function preferKind(state, p, act, pref, cfg) {
  const want = pref === 'evolve' ? 'evolve' : 'play';
  if (act.type === want) return act;
  const mem = memOf(state, p), banned = cfg.banned || new Set();
  const alt = Cpu.enumerateActions(state, p).filter((a) => a.type === want && !banned.has(a.key) && a.cost <= mem && a.score > 1.2).sort((a, b) => b.score - a.score)[0];
  return alt || act;
}
// attack-target override wrapper (variants A1 'player' / A2 'digi')
function retarget(state, p, act, mode) {
  const op = S.opponentOf(p);
  const canP = (() => { try { return S.canAttackPlayer(state, p, act.uid); } catch (e) { return true; } })();
  if (mode === 'player') { if (canP) return { ...act, target: 'PLAYER' }; return act; }
  if (mode === 'digi') {
    const st = state.players[p].battle.find((s) => s.uid === act.uid);
    if (!st) return act;
    let tg = []; try { tg = S.legalDigimonTargets(state, p, act.uid); } catch (e) { /* */ }
    const myDp = Cpu.HX.dpOf(state, p, st);
    const opts = tg.map((u) => state.players[op].battle.find((s) => s.uid === u)).filter(Boolean).filter((t) => Cpu.HX.dpOf(state, op, t) < myDp).sort((a, b) => Cpu.HX.stackValue(state, op, b) - Cpu.HX.stackValue(state, op, a));
    if (opts.length) return { ...act, target: opts[0].uid };
    return act;
  }
  return act;
}

// ---------------- stats ----------------
export function wilson(k, n, z = 1.959964) {
  if (!n) return [0, 0, 0];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [p, (c - h) / d, (c + h) / d];
}
export const pct = (x) => (100 * x).toFixed(1) + '%';
export const fmtCI = (k, n) => { const [p, lo, hi] = wilson(k, n); return `${pct(p)} [${pct(lo)}, ${pct(hi)}] (n=${n})`; };
// two-proportion difference (a vs b) with Wald 95% CI
export function diffCI(k1, n1, k2, n2) { const p1 = k1 / n1, p2 = k2 / n2, se = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2); return [p1 - p2, p1 - p2 - 1.96 * se, p1 - p2 + 1.96 * se]; }
