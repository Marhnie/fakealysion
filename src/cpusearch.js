// Lookahead search for the 어려움 CPU ("4수 앞을 읽는다").
//
// What a "ply" is: one CPU decision (play / evolve / option / jogress / training / 【메인】 ability / attack-with-target / pass).
// An attack is atomic: the block, counter, security checks and battle are resolved completely before the position is evaluated
// (quiescence).  After the CPU ends its turn (pass, or the memory crossed to the opponent's side) the opponent's WHOLE next turn is
// played out by the opponent policy (cpu.js planMain, level hard) and counts as one ply; then the CPU's next turn continues to
// branch.  Depth 4 therefore reads e.g. "A, B, pass, (opponent turn)" or "A, pass, (opponent turn), C".
//
// Mechanics: candidate actions are applied on the LIVE game state through the same rule functions the real game uses
// (src/cpusim.js) and rolled back with src/snapshot.js.  Hidden information is determinized (see determinize): the CPU never reads
// the human's hand / deck order / security; it samples them from the multiset of the cards it cannot see.  The search never throws
// into the game: every failure returns null (the caller falls back to the heuristic planMain) and the live state is restored.
import * as S from './state.js';
import * as SN from './snapshot.js';
import * as Cpu from './cpu.js';
import { createSim } from './cpusim.js';

const { stackValue, handCardValue, lethalPlan, canDeclareAttack, isDigi } = Cpu.HX;
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const card = (id) => S.card(id);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// tunables (settings / self-play calibration)
export const SEARCH = {
  enabled: true, depth: 4, budgetMs: 900, hardCapMs: 2500, maxNodes: 6000, sliceMs: 30,
  rootBeam: 8, beam: 5, samples: 2, prior: 0.6, logLine: false,
  rollout: 2, // leaf completion: 0 = static eval, 1 = finish my turn with the heuristic policy, 2 = + the opponent's next turn
};
// evaluation weights (tuned by scripts/test-cpu-search.mjs self-play)
export const W = {
  sec: 1.0, oppSec: 1.15, board: 1.0, oppBoard: 1.0, hand: 0.4, oppHand: 0.4, handBase: 0.7, mem: 0.45, raising: 0.8, threat: 1.0, lethal: 60, deckLow: 25, ready: 0.25,
};
const SEC_VAL = [0, 2.6, 5, 7.2, 9.2, 11, 12.6, 14, 15.2, 16.4, 17.5, 18.5];
const secVal = (n) => SEC_VAL[Math.min(n, SEC_VAL.length - 1)] + (n >= SEC_VAL.length ? (n - SEC_VAL.length + 1) : 0);
const WIN = 100000;

function mulberry32(seed) { let a = seed >>> 0; const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; f.seed = (x) => { a = x >>> 0; }; return f; }
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const stackKey = (st) => card(st.cardId).id + ':' + (st.suspended ? 1 : 0) + ':' + (st.sources ? st.sources.length : 0) + ':' + (st.tempDP || 0) + ':' + (st.attackEligibleTurn || 0);

// ---------- information hygiene ----------
// Everything the CPU (player p) can legitimately see: public zones + its own hand.  The seed of the sampling derives from it only.
export function visibleKey(state, p) {
  const o = opp(p);
  const side = (q, own) => {
    const pl = state.players[q];
    return [own ? pl.hand.slice().sort().join(',') : pl.hand.length, pl.deck.length, pl.security.length, pl.digitamaDeck.length, pl.trash.slice().sort().join(','), pl.raising ? stackKey(pl.raising) : '-', pl.battle.map(stackKey).sort().join('/')].join(';');
  };
  return [state.turnNumber, state.phase, state.activePlayer, state.memory, side(p, true), side(o, false)].join('|');
}
// Replace every card the CPU cannot see by a random draw from the multiset of unseen cards (canonical order + seeded shuffle, so the
// result depends ONLY on that multiset and the seed).  Human: hand + deck + security are one pool; CPU: deck + security (own hand known).
// Both digitama decks are re-ordered as well.  Permuting hidden zones of the live state therefore cannot change the outcome.
export function determinize(state, p, rng) {
  const shuf = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (const q of ['p1', 'p2']) {
    const pl = state.players[q];
    const own = q === p;
    const pool = own ? [...pl.deck, ...pl.security] : [...pl.hand, ...pl.deck, ...pl.security];
    pool.sort();
    shuf(pool);
    const nHand = own ? 0 : pl.hand.length, nSec = pl.security.length;
    if (!own) pl.hand.splice(0, pl.hand.length, ...pool.splice(0, nHand));
    pl.security.splice(0, pl.security.length, ...pool.splice(0, nSec));
    pl.deck.splice(0, pl.deck.length, ...pool);
    const eggs = pl.digitamaDeck.slice().sort(); shuf(eggs); pl.digitamaDeck.splice(0, pl.digitamaDeck.length, ...eggs);
  }
}

// ---------- evaluation (from p's point of view) ----------
function memFor(state, p) { return p === 'p1' ? state.memory : -state.memory; }
export function evaluate(state, p) {
  const o = opp(p);
  if (state.winner) return state.winner === p ? WIN : state.winner === o ? -WIN : 0;
  const me = state.players[p], op = state.players[o];
  const myTurn = state.activePlayer === p;
  let v = W.sec * secVal(me.security.length) - W.oppSec * secVal(op.security.length);
  const boardVal = (q, pl) => { let s = 0; for (const st of pl.battle) s += stackValue(state, q, st); if (pl.raising) s += W.raising + (card(pl.raising.cardId).level || 0) * 0.25; return s; };
  v += W.board * boardVal(p, me) - W.oppBoard * boardVal(o, op);
  const handVal = (pl) => pl.hand.reduce((s, id) => s + W.handBase + handCardValue(id) * W.hand, 0);
  v += handVal(me) * 0.9;
  v -= op.hand.length * (W.handBase + 2.2 * W.oppHand);
  // tempo: memory left on my side is worth actions when I still move; memory on the opponent's side is their tempo
  const mem = memFor(state, p);
  v += W.mem * (myTurn ? Math.max(mem, -3) : mem);
  // potential to hurt: my ready attackers vs their open blockers / security; theirs vs mine (only when the opponent turn is not simulated)
  const myAtk = me.battle.filter((s) => isDigi(s) && canDeclareAttack(state, p, s)).length;
  if (myTurn) {
    v += W.ready * myAtk;
    try { if (lethalPlan(state, p).lethal) v += W.lethal; } catch (e) { /* ignore */ }
  } else {
    // opponent to move next (leaf right after my turn ended): what can they do to me?
    const opAtk = op.battle.filter((s) => isDigi(s)).length;
    const myBl = me.battle.filter((s) => isDigi(s) && !s.suspended && Cpu.HX.hasKw(state, p, s, '블로커')).length;
    const through = Math.max(0, opAtk - myBl);
    if (through > me.security.length) v -= W.lethal * 0.5 * W.threat; else v -= W.threat * Math.min(through, me.security.length) * 1.1;
    const omem = -mem; // their available memory
    v -= 0.15 * Math.max(0, omem);
  }
  if (me.deck.length <= 1) v -= W.deckLow;
  if (op.deck.length <= 1) v += W.deckLow;
  return v;
}

// ---------- action generation ----------
function genAttacks(state, p) {
  const out = [];
  let base = [];
  try { base = Cpu.attackCandidates(state, p, { level: 'hard' }); } catch (e) { base = []; }
  const seen = new Set();
  for (const a of base) { const k = a.uid + '>' + a.target; seen.add(k); out.push({ ...a, key: 'atk:' + a.uid }); }
  const o = opp(p), opl = state.players[o];
  for (const st of state.players[p].battle) {
    if (!canDeclareAttack(state, p, st)) continue;
    const bestScore = (base.find((b) => b.uid === st.uid) || { score: 0 }).score;
    const aDP = Cpu.HX.dpOf(state, p, st);
    let canPlayer = true; try { canPlayer = S.canAttackPlayer(state, p, st.uid); } catch (e) { /* ignore */ }
    if (canPlayer && !seen.has(st.uid + '>PLAYER')) { out.push({ type: 'attack', uid: st.uid, target: 'PLAYER', score: bestScore - 1, key: 'atk:' + st.uid }); seen.add(st.uid + '>PLAYER'); }
    let targets = []; try { targets = S.legalDigimonTargets(state, p, st.uid); } catch (e) { targets = []; }
    const tl = targets.map((u) => opl.battle.find((s) => s.uid === u) || (opl.raising && opl.raising.uid === u ? opl.raising : null)).filter(Boolean)
      .map((t) => ({ t, dp: Cpu.HX.dpOf(state, o, t), val: stackValue(state, o, t) })).filter((x) => x.dp <= aDP).sort((a, b) => b.val - a.val).slice(0, 2);
    for (const x of tl) { const k = st.uid + '>' + x.t.uid; if (seen.has(k)) continue; seen.add(k); out.push({ type: 'attack', uid: st.uid, target: x.t.uid, score: bestScore - 1.5 + x.val * 0.05, key: 'atk:' + st.uid }); }
  }
  return out;
}
export function genActions(state, p, beam, banned) {
  const ban = banned || new Set();
  let acts = [];
  try { acts = Cpu.enumerateActions(state, p).filter((a) => !ban.has(a.key)); } catch (e) { acts = []; }
  let atks = []; try { atks = genAttacks(state, p).filter((a) => !ban.has(a.key)); } catch (e) { atks = []; }
  const all = [...acts, ...atks].sort((a, b) => b.score - a.score);
  const list = all.slice(0, Math.max(1, beam - 1));
  list.push({ type: 'pass', score: -99, key: 'pass' });
  return list;
}
const sameAct = (a, b) => !!(a && b && a.type === b.type && (a.type === 'pass' || (a.key === b.key && a.target === b.target)));
export function actLabel(a) {
  try {
    switch (a.type) {
      case 'pass': return '패스';
      case 'play': return card(a.cardId).nameKo + ' 등장';
      case 'option': return card(a.cardId).nameKo + ' 사용';
      case 'evolve': return card(a.cardId).nameKo + ' 진화';
      case 'jogress': return card(a.cardId).nameKo + ' 조그레스';
      case 'attack': return '어택→' + (a.target === 'PLAYER' ? '시큐리티' : '디지몬');
      case 'train': return '트레이닝';
      case 'main': return '메인효과';
      default: return a.type;
    }
  } catch (e) { return a.type; }
}
function hashState(state, p) {
  const side = (q) => { const pl = state.players[q]; return [pl.hand.slice().sort().join(','), pl.deck.length, pl.security.length, pl.trash.length, pl.raising ? stackKey(pl.raising) : '-', pl.battle.map(stackKey).sort().join('/')].join(';'); };
  return [state.turnNumber, state.phase, state.activePlayer, state.memory, state.winner || '', side('p1'), side('p2')].join('|');
}

const ABORT = { abort: true };
const macrotask = () => new Promise((res) => { if (typeof setTimeout === 'function') setTimeout(res, 0); else res(); });

// ---------- the search ----------
// opts: { budgetMs, hardCapMs, maxNodes, depth, samples, seed, onProgress(info), shouldAbort() }
// -> { act, depth, nodes, ms, line, values } | null
export async function searchMain(state, p, cfg = {}, opts = {}) {
  const O = { ...SEARCH, ...opts };
  if (!state || state.winner || state.phase !== 'main' || state.activePlayer !== p || state.turnEnding || state.uiChoice) return null;
  if (state.pending.some((t) => !t.resolved) || (state.pendingReplacements && state.pendingReplacements.length) || state.attackCtx) return null;
  const banned = cfg.banned || new Set();
  const t0 = now();
  const ctx = { state, p, nodes: 0, t0, lastYield: t0, yields: 0, tt: new Map(), maxDepthSeen: 0 };
  let baseSnap = null, restored = false;
  const realRandom = Math.random, realRng = Cpu.getRng();
  const keep = { log: state.log, fxHistory: state.fxHistory, pendingVanishFlash: state.pendingVanishFlash, pendingVanishSrc: state.pendingVanishSrc };
  let curRng = null;
  const enter = () => { state.log = []; state.fxHistory = []; state.pendingVanishFlash = []; state.pendingVanishSrc = []; Math.random = curRng; Cpu.setRng(curRng); };
  const leave = () => { state.log = keep.log; state.fxHistory = keep.fxHistory; state.pendingVanishFlash = keep.pendingVanishFlash; if (keep.pendingVanishSrc === undefined) delete state.pendingVanishSrc; else state.pendingVanishSrc = keep.pendingVanishSrc; Math.random = realRandom; Cpu.setRng(realRng); };
  const restore = (snap) => { SN.restoreState(state, snap, { exactCounters: true }); state.log = []; state.fxHistory = []; state.pendingVanishFlash = []; state.pendingVanishSrc = []; };
  let baseDigest = '';
  try {
    baseSnap = SN.snapshotState(state);
    if (baseSnap.lossy) return null;
    baseDigest = visibleKey(state, p) + '#' + state.players[p].hand.join(',') + '#' + state.players.p1.deck.length + state.players.p2.deck.length;
    const seed0 = O.seed != null ? O.seed : strHash(visibleKey(state, p));
    curRng = mulberry32(seed0 ^ 0x9e3779b9);
    const R = mulberry32(seed0); // the ONE generator behind Math.random / cpu noise inside the search; re-seeded at fixed points (common random numbers across candidates)
    const cpuCfg = { level: 'hard', banned: new Set() }, oppCfg = { level: 'hard', banned: new Set() };
    const sim = createSim(state, { cfgOf: (q) => (q === p ? cpuCfg : oppCfg), onError: () => {} });

    // the heuristic move (prior) — computed on the live, undeterminized state exactly as the caller would
    let policy = null;
    try { Cpu.setRng(mulberry32(seed0 ^ 0x51ed270b)); policy = Cpu.planMain(state, p, { level: 'hard', banned: new Set(banned) }); } catch (e) { policy = null; } finally { Cpu.setRng(realRng); }
    if (policy && policy.type === 'attack' && policy.lethal) return { act: policy, depth: 0, nodes: 0, ms: 0, line: '확정 승리', values: [] };
    const rootActs = genActions(state, p, O.rootBeam, banned);
    if (policy && !rootActs.some((a) => sameAct(a, policy))) rootActs.splice(Math.max(0, rootActs.length - 1), 0, policy);
    if (rootActs.length <= 1) return policy ? { act: policy, depth: 0, nodes: 0, ms: 0, line: '', values: [] } : null;

    // determinized roots (K samples)
    const K = Math.max(1, O.samples);
    const roots = [];
    for (let k = 0; k < K; k++) {
      curRng = mulberry32(seed0 + 7919 * (k + 1));
      restore(baseSnap); enter();
      determinize(state, p, curRng);
      roots.push(SN.snapshotState(state));
    }
    restore(baseSnap);
    const budget = Math.min(O.budgetMs, O.hardCapMs);
    const timeUp = () => now() - t0 > O.hardCapMs;
    const softUp = () => now() - t0 > budget;

    async function tick() {
      if (O.shouldAbort && O.shouldAbort()) throw ABORT;
      if (timeUp() || ctx.nodes > O.maxNodes) throw ABORT;
      if (now() - ctx.lastYield < O.sliceMs) return;
      const cur = SN.snapshotState(state);
      restore(baseSnap); leave();
      ctx.yields++;
      if (O.onProgress) { try { O.onProgress({ depth: ctx.curDepth, nodes: ctx.nodes, ms: now() - t0, best: ctx.bestLabel }); } catch (e) { /* ignore */ } }
      await macrotask();
      if (O.shouldAbort && O.shouldAbort()) throw ABORT;
      const chk = visibleKey(state, p) + '#' + state.players[p].hand.join(',') + '#' + state.players.p1.deck.length + state.players.p2.deck.length;
      if (chk !== baseDigest || state.winner || state.activePlayer !== p) throw ABORT; // the game moved on while we were thinking
      curRng = R; enter(); restore(cur);
      ctx.lastYield = now();
    }

    async function playOppTurn() {
      const o = opp(p);
      await sim.beginTurn(o);
      if (state.winner) return;
      oppCfg.banned = new Set();
      R.seed(strHash(hashState(state, p)) ^ seed0);
      await sim.mainLoop(o, () => Cpu.planMain(state, o, oppCfg), 14);
      await sim.drain();
    }

    // depth horizon: finish the turn(s) with the heuristic policy so that leaves are comparable (end of my turn / after their reply)
    async function leaf() {
      if (O.rollout >= 1 && !state.winner) {
        if (state.activePlayer === p && state.phase === 'main' && !state.turnEnding) { cpuCfg.banned = new Set(); R.seed(strHash(hashState(state, p)) ^ seed0 ^ 0x2545F491); await sim.mainLoop(p, () => Cpu.planMain(state, p, cpuCfg), 12); }
        if (O.rollout >= 2 && !state.winner && state.activePlayer !== p) { await tick(); await playOppTurn(); if (!state.winner && state.activePlayer === p && state.phase === 'unsuspend') await sim.beginTurn(p); }
      }
      return evaluate(state, p);
    }

    // value of the position for p, `rem` plies left.  The live state must be at a stable point (nothing pending).
    async function value(rem, top) {
      if (state.winner) return [evaluate(state, p) + (state.winner === p ? rem : -rem), []];
      if (rem <= 0) return [await leaf(), []];
      if (state.activePlayer !== p) {
        await tick();
        await playOppTurn();
        if (state.winner) return [evaluate(state, p) + (state.winner === p ? rem : -rem), []];
        rem -= 1;
        if (rem <= 0) return [await leaf(), ['(상대 턴)']];
        await sim.beginTurn(p);
        if (state.winner) return [evaluate(state, p), []];
        if (state.phase !== 'main' || state.activePlayer !== p) return [evaluate(state, p), []];
        const [v, l] = await value(rem, false);
        return [v, ['(상대 턴)', ...l]];
      }
      if (state.phase !== 'main' || state.turnEnding) return [evaluate(state, p), []];
      const key = hashState(state, p) + '#' + rem;
      const hit = ctx.tt.get(key);
      if (hit) return hit;
      const acts = top ? top : genActions(state, p, O.beam);
      const snap = SN.snapshotState(state);
      await tick();
      let best = -Infinity, bestLine = [];
      for (let i = 0; i < acts.length; i++) {
        const a = acts[i];
        ctx.nodes++;
        if (i > 0) restore(snap);
        cpuCfg.banned = new Set();
        let v, line;
        try {
          await sim.applyMain(p, a);
          [v, line] = await value(rem - 1, null);
        } catch (e) { if (e === ABORT) throw e; v = -Infinity; line = []; }
        if (v > best) { best = v; bestLine = [actLabel(a), ...line]; }
      }
      const res = [best === -Infinity ? evaluate(state, p) : best, bestLine];
      if (!top) ctx.tt.set(key, res);
      return res;
    }

    // iterative deepening over the root candidates, averaged over the K determinized roots
    const maxD = Math.max(1, O.depth);
    let result = null;
    for (let d = 1; d <= maxD; d++) {
      ctx.curDepth = d; ctx.tt = new Map();
      const sums = rootActs.map(() => 0), lines = rootActs.map(() => []);
      try {
        for (let k = 0; k < K; k++) {
          curRng = R;
          restore(roots[k]); enter();
          for (let i = 0; i < rootActs.length; i++) {
            const a = rootActs[i];
            ctx.nodes++;
            if (i > 0) restore(roots[k]);
            cpuCfg.banned = new Set(); R.seed(seed0 + 104729 * (k + 1));
            let v = -Infinity, line = [];
            const before = ctx.nodes;
            try {
              await sim.applyMain(p, a);
              [v, line] = await value(d - 1, null);
            } catch (e) { if (e === ABORT) throw e; v = -Infinity; }
            if (v === -Infinity) v = -WIN / 2;
            sums[i] += v / K; if (k === 0) lines[i] = [actLabel(a), ...line];
            void before;
          }
          restore(baseSnap); leave(); curRng = null;
        }
      } catch (e) { if (e !== ABORT) throw e; break; }
      // depth d complete
      let bi = 0, bv = -Infinity;
      const vals = rootActs.map((a, i) => { const adj = sums[i] + (sameAct(a, policy) ? O.prior : 0); if (adj > bv) { bv = adj; bi = i; } return adj; });
      result = { act: rootActs[bi], depth: d, nodes: ctx.nodes, values: vals, line: lines[bi].join(' → '), policyAgrees: sameAct(rootActs[bi], policy) };
      ctx.bestLabel = actLabel(rootActs[bi]);
      if (softUp() || ctx.nodes > O.maxNodes) break;
      // extrapolate: an iteration that cost more than half the remaining budget will not finish
      const spent = now() - t0; const lastCost = spent - (ctx.lastIterEnd || 0); ctx.lastIterEnd = spent;
      if (spent + lastCost * 2.5 > budget) break;
    }
    if (result) { result.ms = now() - t0; result.yields = ctx.yields; }
    return result;
  } catch (e) {
    if (e !== ABORT) { try { console.warn('[CPU search] failed, falling back', e); } catch (e2) { /* ignore */ } }
    return null;
  } finally {
    try {
      if (baseSnap) { if (state.log !== keep.log) leave(); restore(baseSnap); }
      state.log = keep.log; state.fxHistory = keep.fxHistory; state.pendingVanishFlash = keep.pendingVanishFlash;
      if (keep.pendingVanishSrc === undefined) delete state.pendingVanishSrc; else state.pendingVanishSrc = keep.pendingVanishSrc;
    } catch (e) { /* ignore */ }
    Math.random = realRandom; Cpu.setRng(realRng);
    restored = true; void restored;
  }
}

// plug into the UI driver / headless tests
Cpu.HOOKS.search = async (state, p, cfg, opts) => {
  if (!SEARCH.enabled) return null;
  const r = await searchMain(state, p, cfg, opts);
  if (!r) return null;
  const act = { ...r.act, search: { depth: r.depth, nodes: r.nodes, ms: r.ms, line: r.line, agrees: r.policyAgrees } };
  return act;
};
