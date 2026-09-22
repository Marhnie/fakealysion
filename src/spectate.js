// CPU-vs-CPU spectate mode (pure logic, browser + Node): plays a full headless game with the CPU decision layer controlling BOTH seats
// (same loop as scripts/cpu-hunt.mjs playGame) and records a timeline in the v2 replay format the replay viewer plays
// (entries { snap, dig, label, lines } — see snapshot.js TL / replay.js replayFileJSON).
//
// runSpectateGame({ deckA, deckB, levelA, levelB, seed?, maxTurns?, maxMs?, maxSteps?, searchMs?, onProgress?, signal? })
//   deckA/deckB : deck objects { name, main, digitama } or built-in deck keys (state.newGame accepts both)
//   levelA/B    : 'easy' | 'normal' | 'hard' | 'expert'   (hard / expert use the lookahead search with a per-decision time budget)
//   seed        : optional -> Math.random is replaced by a seeded generator for the duration of the game (reproducible)
//   onProgress  : ({ phase, turn, active, steps, actions, ms, list, done }) called at every recorded step (list = the growing timeline,
//                 so a viewer may start playing before the game is over)
//   signal      : { aborted } (AbortSignal or a plain object) -> the game stops at the next decision, the partial timeline is returned
// -> { list, ended: 'win'|'draw'|'turncap'|'timeout'|'cancelled'|'error', winner, turns, firstPlayer, decks, ms, actions, errors, meta }
import * as S from './state.js';
import * as E from './engine.js';
import * as Cpu from './cpu.js';
import * as SN from './snapshot.js';
import { createSim } from './cpusim.js';
import './cpusearch.js'; // registers Cpu.HOOKS.search (hard / expert lookahead)

export const SPECTATE_LEVELS = ['easy', 'normal', 'hard', 'expert'];
export const MAX_STEPS = SN.MAX_REPLAY;

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const macrotask = () => new Promise((res) => setTimeout(res, 0));

function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// halve the timeline (keep first + last; the log lines of a dropped step are merged into the next kept one)
export function thinTimeline(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (i % 2 === 1 && i < list.length - 1) { list[i + 1].lines = (list[i].lines || []).concat(list[i + 1].lines || []); continue; }
    out.push(list[i]);
  }
  list.length = 0; for (const e of out) list.push(e);
  return list;
}

// how long a viewer should show a step (ms at 1x): reads the log lines it contains
export function stepReadMs(entry, speed = 1) {
  const lines = (entry && entry.lines) || [];
  const chars = lines.reduce((a, l) => a + String(l).length, 0);
  const base = lines.length ? Math.min(5200, Math.max(1000, 700 + chars * 32)) : 450;
  return Math.round(base / (speed || 1));
}

function cfgFor(level) {
  const lc = Cpu.levelCfg(level);
  return { level: lc.level, params: lc.params, search: level === 'hard' || level === 'expert', banned: new Set(), name: level };
}

export async function runSpectateGame(o = {}) {
  const { deckA, deckB, levelA = 'normal', levelB = 'normal', seed = null, maxTurns = 60, maxMs = 300000, maxSteps = MAX_STEPS, onProgress, signal } = o;
  const t0 = nowMs();
  const errors = [];
  const list = [];
  const cfgs = { p1: cfgFor(levelA), p2: cfgFor(levelB) };
  const searchFor = (cfg) => cfg.name === 'expert'
    ? { ...Cpu.EXPERT.search, budgetMs: o.searchMs || 700, hardCapMs: Math.max(o.searchMs || 700, 1100) }
    : { budgetMs: o.searchMs || 450, hardCapMs: Math.max(o.searchMs || 450, 900), depth: 3, samples: 1 };
  const realRandom = Math.random;
  if (seed != null) Math.random = seededRandom(seed);
  let state = null, ended = 'error';
  let head = null, actions = 0, lastYield = nowMs();
  const aborted = () => !!(signal && signal.aborted);
  const yieldNow = async (force) => { if (force || nowMs() - lastYield > 14) { await macrotask(); lastYield = nowMs(); } };
  const newLines = () => { const out = []; for (const e of state.log) { if (e === head) break; out.push(e.msg); } return out.reverse(); };
  const progress = (phase, done) => { if (onProgress) { try { onProgress({ phase, turn: state.turnNumber, active: state.activePlayer, steps: list.length, actions, ms: nowMs() - t0, list, done: !!done }); } catch (e) { /* viewer glue must not break the sim */ } } };
  let lastDig = '';
  const record = (label, force) => {
    const dig = SN.digest(state);
    if (!force && dig === lastDig) { head = state.log[0] || null; return false; }
    const lines = newLines();
    const lab = label || lines[0] || '';
    const snap = SN.snapshotState(state, lab);
    head = state.log[0] || null; lastDig = dig;
    list.push({ snap, dig, label: lab, lines });
    if (list.length > maxSteps) thinTimeline(list);
    return true;
  };
  try {
    state = S.newGame(deckA, deckB);
    const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: (w, e) => { errors.push(w + ': ' + String(e && e.message).slice(0, 120)); } });
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
    const first = E.coinFlip();
    for (const p of [first, S.opponentOf(first)]) if (Cpu.shouldMulligan(state, p, cfgs[p].level, cfgs[p].params)) E.mulligan(state, p);
    E.setSecurityStacks(state); E.beginGame(state, first);
    state.firstPlayer = first;
    head = state.log[0] || null; // "game start" is the timeline's first step: everything logged so far belongs to it
    record('게임 시작', true); progress('start');
    ended = 'turncap';
    for (let t = 0; t < maxTurns + 5 && !state.winner; t++) {
      if (aborted()) { ended = 'cancelled'; break; }
      if (nowMs() - t0 > maxMs) { ended = 'timeout'; break; }
      if (state.turnNumber > maxTurns) { ended = 'turncap'; break; }
      const p = state.activePlayer, cfg = cfgs[p];
      cfg.banned = new Set();
      await sim.beginTurn(p);
      record(`턴 ${state.turnNumber} 시작 (${p})`); progress('turn');
      if (state.winner) break;
      let acts = 0;
      const sopts = { ...searchFor(cfg), shouldAbort: aborted };
      await sim.mainLoop(p, async () => {
        record(); progress('act');
        await yieldNow(false);
        if (state.winner || aborted() || nowMs() - t0 > maxMs) return { type: 'pass' };
        acts++; actions++;
        let act = null;
        if (cfg.search && Cpu.HOOKS.search) { try { act = await Cpu.HOOKS.search(state, p, cfg, sopts); } catch (e) { errors.push('search: ' + String(e && e.message).slice(0, 100)); } }
        if (!act || !act.type) act = Cpu.planMain(state, p, cfg);
        if (!act || !act.type) act = { type: 'pass' };
        return act;
      });
      record(); progress('turnEnd');
      await yieldNow(true);
    }
    if (state.winner) ended = state.winner === 'draw' ? 'draw' : 'win';
    else if (aborted()) ended = 'cancelled';
  } catch (e) {
    errors.push('fatal: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
    ended = 'error';
  } finally {
    if (seed != null) Math.random = realRandom;
  }
  if (state) { try { record(state.winner ? (state.winner === 'draw' ? '무승부' : state.winner + ' 승리') : '종료', true); } catch (e) { /* ignore */ } }
  const res = {
    list, ended, winner: (state && state.winner) || null, turns: state ? state.turnNumber : 0, firstPlayer: state ? state.firstPlayer : null,
    decks: state ? [state.players.p1.deckName, state.players.p2.deckName] : [], ms: nowMs() - t0, actions, errors,
    levels: [levelA, levelB],
  };
  res.meta = { decks: res.decks, winner: res.winner, firstPlayer: res.firstPlayer, turns: res.turns, exportedAt: Date.now(), levels: res.levels, ended };
  if (state) progress('done', true);
  return res;
}

// replay.js replayFileJSON wants a state-like object (firstPlayer / winner / turnNumber)
export function spectateFileText(res, RP) { return RP.replayFileJSON({ firstPlayer: res.firstPlayer, winner: res.winner, turnNumber: res.turns }, res.list); }
