// Save / load of the current game (localStorage slots, auto-save, JSON export/import). No DOM here except download/clipboard helpers.
// A save = the stable-point snapshot of src/snapshot.js serialized to JSON + the last log lines + display meta.
// Saving is only possible at a stable point (nothing unresolved); held end-of-turn effects are stored with a `desc` and rebuilt on load.
import * as S from './state.js';
import * as SN from './snapshot.js';

export const SLOTS = [1, 2, 3, 4, 5];
const KEY = (slot) => 'digimon_sim_save_v1_' + slot;
const LAST_KEY = 'digimon_sim_save_v1_last';

function storage() { try { return window.localStorage; } catch (e) { return null; } }

export function buildSave(state, name) {
  const snap = SN.snapshotState(state, '');
  const obj = SN.snapToObject(snap);
  const lost = (state.endOfTurnEffects || []).filter(e => !(e.desc && S.EOT_REBUILD[e.desc.kind])).length;
  return {
    format: 'digimon-sim-save', v: 1, name: name || '', savedAt: Date.now(),
    meta: { ...obj.meta, decks: [state.players.p1.deckName, state.players.p2.deckName], turn: state.turnNumber, active: state.activePlayer, firstPlayer: state.firstPlayer },
    snap: obj,
    log: state.log.slice(0, 300).map(e => ({ t: e.t, turn: e.turn, msg: e.msg })),
    lost,
  };
}
export function saveText(state, name) { return SN.stringify(buildSave(state, name)); }

// text -> new live state object (not yet bound to main.js). Throws on invalid data.
export function stateFromText(text) {
  const save = SN.parse(text);
  if (!save || save.format !== 'digimon-sim-save' || !save.snap) throw new Error('디지몬 시뮬레이터 세이브 파일이 아닙니다');
  const state = {};
  const snap = SN.snapFromObject(save.snap, state);
  SN.restoreState(state, snap);
  state.log = (save.log || []).map(e => ({ t: e.t || Date.now(), turn: e.turn, msg: e.msg }));
  state.fxHistory = [];
  S.log(state, `(불러오기) ${save.name ? `"${save.name}" ` : ''}턴 ${save.meta && save.meta.turn} 상태를 불러왔습니다` + (snap.eotLost ? ` — 예약 효과 ${snap.eotLost}개는 복원되지 않음` : ''));
  return { state, save, eotLost: snap.eotLost };
}

export function saveToSlot(state, slot, name) {
  const st = storage(); if (!st) return { ok: false, why: '브라우저 저장소를 사용할 수 없습니다' };
  try {
    const text = saveText(state, name);
    st.setItem(KEY(slot), text); st.setItem(LAST_KEY, String(slot));
    return { ok: true, bytes: text.length };
  } catch (e) { return { ok: false, why: '저장 실패 (저장소 용량 초과?): ' + (e && e.message) }; }
}
export function readSlot(slot) {
  const st = storage(); if (!st) return null;
  try { const t = st.getItem(KEY(slot)); return t || null; } catch (e) { return null; }
}
export function deleteSlot(slot) { const st = storage(); if (st) try { st.removeItem(KEY(slot)); } catch (e) { /* ignore */ } }
export function slotInfo(slot) {
  const t = readSlot(slot); if (!t) return null;
  try {
    // cheap: only parse the head part we need (whole parse is fine at this size)
    const o = SN.parse(t);
    return { slot, name: o.name || '', savedAt: o.savedAt, turn: o.meta && o.meta.turn, decks: o.meta && o.meta.decks, active: o.meta && o.meta.active, winner: o.meta && o.meta.winner, bytes: t.length };
  } catch (e) { return { slot, broken: true }; }
}
export function listSlots() { return [...SLOTS.map(slotInfo), slotInfo('auto')]; }
export function lastSlot() {
  const st = storage(); if (!st) return null;
  let cands = [];
  for (const s of [...SLOTS, 'auto']) { const i = slotInfo(s); if (i && !i.broken && !i.winner) cands.push(i); }
  cands.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return cands[0] || null;
}
export function autoSave(state) { return saveToSlot(state, 'auto', '자동 저장'); }

// ---- files / clipboard (browser only) ----
export function downloadText(filename, text, mime = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e2) { return false; }
  }
}
export function fmtTime(t) { if (!t) return '-'; const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; }
