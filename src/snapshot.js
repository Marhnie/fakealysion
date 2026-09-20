// Game-state snapshots + undo/redo timeline + replay recorder (pure logic, no DOM; used by main.js via a few hooks).
//
// Design
//  * A snapshot is a structuredClone of the game state minus the "live" keys (log/fxHistory/UI toasts/replacement waiters).
//    Held end-of-turn entries (closures) are kept by reference in snap.eot (their `desc` makes them rebuildable from JSON).
//  * restoreState() mutates the live state object IN PLACE (so main.js' `state`, the module-level S7_BOUND pointer and
//    every captured `state` in closures stay valid) and re-installs the battle-array splice tracker.
//  * The timeline records STABLE states only (nothing unresolved: no pending effect, choice, attack). An action's effect
//    prompts are therefore part of the action that caused them: undo goes back to the last stable point before it.
import * as S from './state.js';

export const MAX_UNDO = 50;      // how far back undo can reach
export const MAX_REPLAY = 600;   // recorded steps kept for the replay viewer

// keys of the state object that are NOT part of a snapshot (presentation / transient); kept as-is on restore
const KEEP = new Set(['log', 'fxHistory', 'pendingVanishFlash', 'pendingVanishSrc', 'uiChoice', '_replWaiters', 'pendingReplacements', '_leavePending', '_fxRec']);

function stripFns(o) { const c = {}; for (const k of Object.keys(o)) if (typeof o[k] !== 'function') c[k] = o[k]; return c; }
// fallback deep copy (functions dropped, cycles/sharing kept) for state shapes structuredClone rejects
function slowClone(o, seen = new Map()) {
  if (o === null || typeof o !== 'object') return o;
  if (seen.has(o)) return seen.get(o);
  let c;
  if (o instanceof Set) { c = new Set(); seen.set(o, c); for (const v of o) c.add(slowClone(v, seen)); return c; }
  if (o instanceof Map) { c = new Map(); seen.set(o, c); for (const [k, v] of o) c.set(k, slowClone(v, seen)); return c; }
  c = Array.isArray(o) ? [] : {}; seen.set(o, c);
  for (const k of Object.keys(o)) { if (typeof o[k] === 'function') continue; c[k] = slowClone(o[k], seen); }
  return c;
}
function cloneData(rest) {
  try { return { data: structuredClone(rest), lossy: false }; } catch (e) { return { data: slowClone(rest), lossy: true }; }
}
function dataOf(state) {
  const rest = {};
  for (const k of Object.keys(state)) if (!KEEP.has(k) && k !== 'endOfTurnEffects') rest[k] = state[k];
  if (Array.isArray(rest.pending)) rest.pending = rest.pending.map(stripFns);
  return rest;
}

// cheap structural fingerprint: used to skip timeline entries when nothing really changed
export function digest(state) {
  const parts = [state.turnNumber, state.phase, state.activePlayer, state.memory, state.winner || '', state.pending.length, state.breedingActionTaken ? 1 : 0, (state.endOfTurnEffects || []).length];
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    parts.push('|', pl.hand.join(','), pl.deck.length, pl.trash.length, pl.security.length, pl.digitamaDeck.length, pl.memoryLocks.length);
    for (const st of [pl.raising, ...pl.battle]) {
      if (!st) { parts.push('-'); continue; }
      parts.push(st.uid, st.cardId, st.suspended ? 1 : 0, st.sources.length, (st.linkCards || []).length, st.tempDP || 0, Object.keys(st.keywords || {}).length);
    }
  }
  return parts.join(';');
}

export function snapshotState(state, label) {
  const { data, lossy } = cloneData(dataOf(state));
  return {
    v: 1, data, lossy,
    eot: (state.endOfTurnEffects || []).map(e => ({ ...e })),
    counters: S.getCounters(),
    meta: { t: Date.now(), turn: state.turnNumber, phase: state.phase, active: state.activePlayer, memory: state.memory, winner: state.winner || null, label: label || '', decks: [state.players.p1.deckName, state.players.p2.deckName] },
  };
}

export function restoreState(state, snap, opts = {}) {
  const data = snap.lossy ? slowClone(snap.data) : structuredClone(snap.data);
  for (const k of Object.keys(state)) if (!KEEP.has(k)) delete state[k];
  Object.assign(state, data);
  state.endOfTurnEffects = (snap.eot || []).map(e => ({ ...e }));
  state.uiChoice = null; state.pendingReplacements = []; state._replWaiters = []; state._leavePending = []; state._fxRec = null;
  if (!state.log) state.log = [];
  if (!state.fxHistory) state.fxHistory = [];
  S.setCounters(snap.counters, !!opts.exactCounters);
  S.rebindState(state);
  return state;
}

// Why is a snapshot/undo unavailable right now?  ui = { pendingAttack, atkQueued } supplied by main.js (attack flags live there).
export function unstableReason(state, ui = {}) {
  if (!state) return '게임이 없습니다';
  if (state.phase === 'setup') return '게임 시작 전(멀리건 중)에는 사용할 수 없습니다';
  if (state.uiChoice) return '선택 창이 열려 있어 지금은 할 수 없습니다 (선택을 마친 뒤 사용하세요)';
  if (state.pendingReplacements && state.pendingReplacements.length) return '대체 효과(회피/세이브 등) 선택 대기 중입니다';
  if (state.pending.some(t => !t.resolved)) return '해결 중인 효과가 남아 있어 지금은 할 수 없습니다';
  if (ui.pendingAttack || ui.atkQueued) return '어택 진행 중에는 할 수 없습니다';
  if (state.turnEnding) return '턴 종료 처리 중에는 할 수 없습니다';
  return '';
}

// ---------- serialization (save files / export) ----------
function enc(k, v) { if (v instanceof Set) return { __set: [...v] }; if (v instanceof Map) return { __map: [...v] }; return v; }
function dec(k, v) { if (v && typeof v === 'object') { if (Array.isArray(v.__set)) return new Set(v.__set); if (Array.isArray(v.__map)) return new Map(v.__map); } return v; }
export function snapToObject(snap) {
  return { v: 1, data: snap.data, eot: (snap.eot || []).map(e => { const { fn, ...r } = e; return r; }), counters: snap.counters, meta: snap.meta };
}
export function stringify(obj, pretty) { return JSON.stringify(obj, enc, pretty ? 1 : 0); }
export function parse(text) { return JSON.parse(text, dec); }
// snapshot object from a parsed save; closures of held end-of-turn entries are rebuilt from their desc (unknown kinds are dropped: snap.eotLost)
export function snapFromObject(o, state) {
  if (!o || !o.data || !o.data.players) throw new Error('세이브 데이터가 올바르지 않습니다');
  const snap = { v: 1, data: o.data, lossy: false, eot: [], counters: o.counters, meta: o.meta || {}, eotLost: 0 };
  for (const e of o.eot || []) {
    const mk = e.desc && S.EOT_REBUILD[e.desc.kind];
    let fn = null; try { fn = mk ? mk(state, e.desc, e) : null; } catch (er) { fn = null; }
    if (fn) snap.eot.push({ ...e, fn }); else snap.eotLost++;
  }
  return snap;
}

// ---------- undo / redo timeline (also the replay recording) ----------
// entries: { snap, dig, label, lines:[msg…] (log lines the action produced, oldest first) }
export const TL = { list: [], cur: -1, owner: null, head: null, listeners: [] };
function notify() { for (const f of TL.listeners) try { f(); } catch (e) { /* ignore */ } }
export function onChange(f) { TL.listeners.push(f); }
export function resetTimeline(state) { TL.list = []; TL.cur = -1; TL.owner = state || null; TL.head = (state && state.log && state.log[0]) || null; notify(); }

function newLines(state) {
  const out = [];
  for (const e of state.log) { if (e === TL.head) break; out.push(e.msg); }
  return out.reverse();
}
// Call at the end of every render. `reason` = unstableReason(); records the current state when it is stable and changed.
export function sync(state, reason, force = false, label) {
  if (!state) return false;
  if (TL.owner !== state) resetTimeline(state);
  if (reason) return false;
  const dig = digest(state);
  const last = TL.list[TL.cur];
  if (last && last.dig === dig && !force) { TL.head = state.log[0] || null; return false; }
  const lines = newLines(state);
  const lab = label || lines[0] || (last ? '' : '게임 시작');
  const snap = snapshotState(state, lab);
  TL.head = state.log[0] || null;
  TL.list.length = TL.cur + 1;      // a new action discards the redo branch
  TL.list.push({ snap, dig, label: lab, lines });
  TL.cur = TL.list.length - 1;
  while (TL.list.length > MAX_REPLAY) { TL.list.shift(); TL.cur--; }
  notify();
  return true;
}
function floorIdx() { return Math.max(0, TL.list.length - 1 - MAX_UNDO); }
export function canUndo() { return TL.owner && TL.cur > floorIdx(); }
export function canRedo() { return TL.owner && TL.cur >= 0 && TL.cur < TL.list.length - 1; }
export function undoDepth() { return TL.cur - floorIdx(); }
export function redoDepth() { return TL.list.length - 1 - TL.cur; }
function goto(state, i, tag) {
  restoreState(state, TL.list[i].snap);
  TL.cur = i;
  S.log(state, tag);
  TL.head = state.log[0] || null;
  notify();
}
export function undo(state) {
  if (!state || TL.owner !== state) return { ok: false, why: '되돌릴 기록이 없습니다' };
  if (!canUndo()) return { ok: false, why: '더 이상 되돌릴 수 없습니다' };
  const from = TL.list[TL.cur];
  goto(state, TL.cur - 1, `(되돌림) ${from.label || '직전 행동'} 이전 상태로`);
  return { ok: true };
}
export function redo(state) {
  if (!state || TL.owner !== state) return { ok: false, why: '다시 실행할 기록이 없습니다' };
  if (!canRedo()) return { ok: false, why: '다시 실행할 기록이 없습니다' };
  const to = TL.list[TL.cur + 1];
  goto(state, TL.cur + 1, `(다시 실행) ${to.label || '행동'}`);
  return { ok: true };
}
// jump to any recorded index (replay viewer applies snapshots to a private scratch state instead — see replay.js)
