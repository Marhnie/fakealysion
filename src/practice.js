// Practice-mode tooling UI: undo/redo, save/load, export/import, replay viewer, cheat drawer, restart-hand.
// Logic lives in snapshot.js / savegame.js / replay.js; this module is the DOM glue and is wired from main.js with init(api):
//   api = { getState, setState(state), render, resetSel, uiFlags() -> {pendingAttack, atkQueued}, restartHand() }
import * as S from './state.js';
import * as SN from './snapshot.js';
import * as SG from './savegame.js';
import * as RP from './replay.js';
import { stepReadMs } from './spectate.js'; // autoplay: how long a step is shown (reads its log lines)

let api = null;
const h = (tag, attrs = {}, children = []) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'onClick') el.addEventListener('click', v);
    else if (k === 'className') el.className = v;
    else if (typeof v === 'boolean') el[k] = v;
    else if (/^on[a-z]/.test(k) && typeof v === 'function') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) { if (c == null || c === false) continue; el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  return el;
};

const P = { modal: null, modalKind: null, armed: null, msg: '', cheatOpen: false, lastAutoTurn: null, autoFor: null, replay: null, live: null, btns: [], importText: '', saveName: '' };
const cheat = { p: 'p1', from: 'hand', idx: 0, to: 'hand', pos: 'top', target: 0, cardId: '', stack: 0, mem: 0 };

export function init(a) {
  api = a;
  try { window.__pr = { SN, SG, RP, P, cheat }; } catch (e) { /* debug handle only */ }
  SN.onChange(updateButtons);
  document.addEventListener('keydown', (e) => {
    if (!api.getState() || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!P.replay || e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); replayGo(P.replay.idx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); replayGo(P.replay.idx - 1); }
    else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); replayToggle(); }
    else if (e.key === 'Escape') { replayExit(false); }
  });
  document.addEventListener('keyup', (e) => { if (P.replay && (e.key === ' ' || e.code === 'Space') && !(e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))) e.preventDefault(); }); // a focused bar button must not also 'click' on Space
}
export const isReplay = () => !!P.replay;
function ST() { return api.getState(); }
function reason() { const s = ST(); return SN.unstableReason(s, api.uiFlags()); }
function toast(msg) {
  P.msg = msg; const el = document.getElementById('pr-toast') || document.body.appendChild(h('div', { id: 'pr-toast', className: 'pr-toast' }));
  el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- undo / redo ----------
export function doUndo() {
  const s = ST(); if (!s || P.replay || api.uiFlags().netLocked) return;
  const why = reason(); if (why) { toast('되돌리기 불가: ' + why); return; }
  SN.sync(s, '');
  const r = SN.undo(s, cpuAccept());
  if (!r.ok) { toast(r.why); return; }
  api.resetSel(); api.render();
}
export function doRedo() {
  const s = ST(); if (!s || P.replay || api.uiFlags().netLocked) return;
  const why = reason(); if (why) { toast('다시 실행 불가: ' + why); return; }
  const r = SN.redo(s, cpuAccept());
  if (!r.ok) { toast(r.why); return; }
  api.resetSel(); api.render();
}
const cpuAccept = () => (api.uiFlags().cpuOn ? (e) => e.snap.meta.active === 'p1' : null);
function undoTitle() {
  const why = reason();
  if (why) return '되돌리기 불가 — ' + why;
  if (!SN.canUndo()) return '되돌릴 기록이 없습니다';
  const cur = SN.TL.list[SN.TL.cur];
  return `되돌리기 (Ctrl+Z) — "${(cur && cur.label) || '직전 행동'}" 이전으로 · ${SN.undoDepth()}단계 가능`;
}
function redoTitle() {
  const why = reason();
  if (why) return '다시 실행 불가 — ' + why;
  if (!SN.canRedo()) return '다시 실행할 기록이 없습니다';
  const nx = SN.TL.list[SN.TL.cur + 1];
  return `다시 실행 (Ctrl+Shift+Z / Ctrl+Y) — "${(nx && nx.label) || '행동'}" · ${SN.redoDepth()}단계 가능`;
}
function updateButtons() {
  P.btns = P.btns.filter(b => b.el.isConnected);
  const s = ST(); if (!s) return;
  for (const b of P.btns) {
    if (b.kind === 'undo') { const off = !!reason() || !SN.canUndo(); b.el.classList.toggle('pr-off', !!reason()); b.el.disabled = off; b.el.title = undoTitle(); }
    if (b.kind === 'redo') { const off = !!reason() || !SN.canRedo(); b.el.classList.toggle('pr-off', !!reason()); b.el.disabled = off; b.el.title = redoTitle(); }
  }
}
function regBtn(kind, el) { P.btns.push({ kind, el }); return el; }

// buttons placed in the top bar (main.js renderTopbar)
export function topbarButtons() {
  P.btns = [];
  const undo = regBtn('undo', h('button', { className: 'pr-btn', onClick: doUndo }, '↶ 되돌리기'));
  const redo = regBtn('redo', h('button', { className: 'pr-btn', onClick: doRedo }, '↷ 다시'));
  const save = h('button', { className: 'pr-btn', title: '저장 / 불러오기 / 내보내기', onClick: () => openModal('save') }, ['💾', h('span', { className: 'pr-lbl' }, ' 저장·불러오기')]);
  const rep = h('button', { className: 'pr-btn', title: '지금까지의 대전을 한 스텝씩 되돌아보기', onClick: replayEnter }, ['▶', h('span', { className: 'pr-lbl' }, ' 리플레이')]);
  const rehand = h('button', { className: 'pr-btn', title: '같은 덱으로 새로 셔플해 시작 핸드부터 다시 (혼자 연습용)', onClick: () => openModal('restart') }, ['🎲', h('span', { className: 'pr-lbl' }, ' 시작 핸드 다시')]);
  const ch = h('button', { className: 'pr-btn' + (P.cheatOpen ? ' on' : ''), title: '연습용 치트: 카드 이동 / 메모리 설정 (기본 접힘)', onClick: () => { P.cheatOpen = !P.cheatOpen; api.render(); } }, ['🛠', h('span', { className: 'pr-lbl' }, ' 핸드 조작')]);
  // 온라인 대전: 되돌리기/저장/리플레이/시작 핸드 다시/핸드 조작은 한쪽 화면의 상태만 바꾸거나 상대 게임을 망가뜨리므로 숨긴다
  const wrap = h('span', { className: 'pr-group' }, api.uiFlags().netLocked ? [] : [undo, redo, save, rep, rehand, ch]);
  setTimeout(updateButtons, 0);
  return wrap;
}

// ---------- after every render ----------
export function afterRender() {
  const s = ST();
  if (!s || P.replay) { renderCheat(); return; }
  const why = reason();
  SN.sync(s, why);
  // auto-save once per turn (first stable render of a new turn) into the 'auto' slot
  if (P.autoFor !== s) { P.autoFor = s; P.lastAutoTurn = null; }
  if (!why && !s.winner && P.lastAutoTurn !== `${s.turnNumber}${s.activePlayer}`) { const r = SG.autoSave(s); if (r.ok) { P.lastAutoTurn = `${s.turnNumber}${s.activePlayer}`; P.lastAutoAt = Date.now(); P.lastAutoDig = SN.digest(s); } }
  // long-game playtest: a reload / crash in the middle of a turn used to fall back to the START of that turn (all its actions lost) -> also refresh the auto slot at a stable point at most every 4 s when the position changed (a save is ~1 ms)
  else if (!why && !s.winner && Date.now() - (P.lastAutoAt || 0) > 4000) { const dg = SN.digest(s); if (dg !== P.lastAutoDig) { const r = SG.autoSave(s); if (r.ok) { P.lastAutoAt = Date.now(); P.lastAutoDig = dg; } } }
  updateButtons();
  renderCheat();
  if (P.modal && P.modalKind === 'save') fillSaveModal();
}
export function newGameStarted() { P.autoFor = null; P.lastAutoTurn = null; SN.resetTimeline(null); }

// ---------- modal shell ----------
function closeModal() { if (P.modal) P.modal.remove(); P.modal = null; P.modalKind = null; P.armed = null; }
function openModal(kind) {
  closeModal(); P.modalKind = kind;
  const box = h('div', { className: 'pr-panel' });
  P.modal = h('div', { className: 'pr-modal', onClick: (e) => { if (e.target === P.modal) closeModal(); } }, [box]);
  document.body.appendChild(P.modal);
  if (kind === 'save') fillSaveModal(); else if (kind === 'restart') fillRestartModal();
}
function fillRestartModal() {
  const box = P.modal.firstChild; box.replaceChildren(
    h('h3', {}, '🎲 시작 핸드 다시 뽑기'),
    h('p', {}, '같은 덱으로 새로 셔플하고 오프닝 핸드/멀리건부터 다시 시작합니다. 현재 진행 상황은 사라집니다 (먼저 💾 저장해 두면 되돌릴 수 있어요).'),
    h('div', { className: 'pr-row' }, [
      h('button', { className: 'primary', onClick: () => { closeModal(); api.restartHand(); } }, '다시 뽑기'),
      h('button', { onClick: closeModal }, '취소'),
    ]));
}

// ---------- save / load modal ----------
function fmtSlot(i) {
  if (!i) return '(비어 있음)';
  if (i.broken) return '(손상된 데이터)';
  return `${i.name ? i.name + ' · ' : ''}${SG.fmtTime(i.savedAt)} · 턴 ${i.turn} · ${(i.decks || []).join(' vs ')}${i.winner ? ' · 종료' : ''}`;
}
function loadText(text, label) {
  try {
    if (/"format"\s*:\s*"digimon-sim-replay"/.test(text.slice(0, 400))) { loadReplayText(text, label); return; }
    const { state, eotLost } = SG.stateFromText(text);
    P.autoFor = null; SN.resetTimeline(null);
    api.setState(state); api.resetSel(); closeModal(); api.render();
    if (eotLost) toast(`불러옴 (예약 효과 ${eotLost}개는 복원 안 됨)`); else toast('불러오기 완료' + (label ? ': ' + label : ''));
  } catch (e) { P.msg = '불러오기 실패: ' + (e && e.message); fillSaveModal(); }
}
function fillSaveModal() {
  if (!P.modal || P.modalKind !== 'save') return;
  const s = ST(); const why = s ? reason() : '진행 중인 게임이 없습니다';
  const box = P.modal.firstChild;
  const active = s && !s.winner;
  const nameIn = h('input', { className: 'pr-in', placeholder: '저장 이름 (선택)', value: P.saveName, oninput: (e) => { P.saveName = e.target.value; } });
  const rows = [];
  for (const slot of [...SG.SLOTS, 'auto']) {
    const info = SG.slotInfo(slot); const isAuto = slot === 'auto';
    const arm = (k, label, fn, cls) => h('button', { className: cls || '', onClick: () => { if (P.armed === k) { P.armed = null; fn(); } else { P.armed = k; fillSaveModal(); } } }, P.armed === k ? '정말?' : label);
    rows.push(h('div', { className: 'pr-slot' }, [
      h('b', {}, isAuto ? '자동' : `슬롯 ${slot}`),
      h('span', { className: 'pr-slot-meta' }, fmtSlot(info)),
      !isAuto && h('button', { disabled: !!why || !s, title: why || '현재 게임을 이 슬롯에 저장', onClick: () => {
        if (info && P.armed !== 's' + slot) { P.armed = 's' + slot; fillSaveModal(); return; }
        P.armed = null; const r = SG.saveToSlot(s, slot, P.saveName); P.msg = r.ok ? `슬롯 ${slot}에 저장했습니다` : r.why; fillSaveModal();
      } }, P.armed === 's' + slot ? '덮어쓰기?' : '저장'),
      h('button', { disabled: !info || info.broken, onClick: () => { const t = SG.readSlot(slot); if (!t) return; if (active && P.armed !== 'l' + slot) { P.armed = 'l' + slot; fillSaveModal(); return; } P.armed = null; loadText(t, isAuto ? '자동 저장' : `슬롯 ${slot}`); } }, P.armed === 'l' + slot ? '현재 게임 버리고 불러오기?' : '불러오기'),
      !isAuto && info && arm('d' + slot, '삭제', () => { SG.deleteSlot(slot); P.msg = `슬롯 ${slot}을 비웠습니다`; fillSaveModal(); }),
    ]));
  }
  const ta = h('textarea', { className: 'pr-ta', placeholder: '내보낸 JSON 텍스트를 여기에 붙여넣기', value: P.importText, oninput: (e) => { P.importText = e.target.value; } });
  const file = h('input', { type: 'file', accept: '.json,application/json,text/plain', onchange: async (e) => { const f = e.target.files && e.target.files[0]; if (f) { try { loadText(await f.text(), f.name); } catch (er) { P.msg = '파일 읽기 실패'; fillSaveModal(); } } } });
  box.replaceChildren(...[
    h('div', { className: 'pr-head' }, [h('h3', {}, '💾 저장 · 📂 불러오기'), h('button', { onClick: closeModal }, '✕')]),
    why && s ? h('div', { className: 'pr-warn' }, '지금은 저장할 수 없습니다: ' + why) : null,
    P.msg ? h('div', { className: 'pr-msg' }, P.msg) : null,
    nameIn,
    h('div', { className: 'pr-slots' }, rows),
    h('h4', {}, '내보내기 / 가져오기'),
    h('div', { className: 'pr-row' }, [
      h('button', { disabled: !!why || !s, title: why, onClick: () => { SG.downloadText(`digimon-save-t${s.turnNumber}.json`, SG.saveText(s, P.saveName)); P.msg = '파일로 내보냈습니다'; fillSaveModal(); } }, '⬇ 게임 JSON 파일'),
      h('button', { disabled: !!why || !s, title: why, onClick: async () => { const ok = await SG.copyText(SG.saveText(s, P.saveName)); P.msg = ok ? '게임 JSON을 클립보드에 복사했습니다' : '복사 실패 — 아래 텍스트를 직접 복사하세요'; fillSaveModal(); } }, '📋 클립보드로 복사'),
      h('button', { disabled: !s, onClick: () => { SG.downloadText('digimon-log.txt', RP.logText(s), 'text/plain'); P.msg = '읽기 쉬운 로그(.txt)를 내보냈습니다'; fillSaveModal(); } }, '⬇ 로그 텍스트(턴별)'),
      h('button', { disabled: !s, onClick: () => { SG.downloadText('digimon-replay.json', RP.logJSON(s)); P.msg = '리플레이 JSON을 내보냈습니다'; fillSaveModal(); } }, '⬇ 로그 JSON'),
      h('button', { disabled: !s, onClick: async () => { const ok = await SG.copyText(RP.logText(s)); P.msg = ok ? '로그 텍스트를 복사했습니다' : '복사 실패'; fillSaveModal(); } }, '📋 로그 복사'),
    ]),
    h('div', { className: 'pr-row' }, [h('span', {}, '파일 불러오기:'), file]),
    ta,
    h('div', { className: 'pr-row' }, [h('button', { className: 'primary', disabled: !P.importText.trim(), onClick: () => loadText(P.importText.trim(), '붙여넣은 텍스트') }, '붙여넣은 텍스트에서 불러오기')]),
  ].filter(Boolean));
}

// start screen: "continue last game" + open the save dialog
export function startScreenExtras() {
  const last = SG.lastSlot();
  const kids = [];
  if (last) kids.push(h('button', { className: 'primary', title: fmtSlot(last), onClick: () => { const t = SG.readSlot(last.slot); if (t) loadText(t, ''); } }, `▶ 마지막 게임 이어하기 (${last.slot === 'auto' ? '자동' : '슬롯 ' + last.slot} · 턴 ${last.turn})`));
  kids.push(h('button', { onClick: () => openModal('save') }, '📂 저장한 게임 불러오기'));
  const rf = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: async (e) => { const f = e.target.files && e.target.files[0]; if (f) { try { loadReplayText(await f.text(), f.name); } catch (er) { toast('파일 읽기 실패'); } } e.target.value = ''; } });
  kids.push(h('button', { title: '대전 종료 후 저장한 리플레이 파일을 불러와 처음부터 다시 봅니다', onClick: () => rf.click() }, '🎞 리플레이 불러오기'), rf);
  return h('div', { className: 'pr-start' }, kids);
}

// ---------- replay viewer ----------
function replayEnter() {
  const live = ST(); if (!live || P.replay) return;
  if (!reason()) SN.sync(live, '');
  const list = SN.TL.list.slice();
  if (list.length < 1) { toast('기록된 스텝이 없습니다'); return; }
  P.live = live;
  P.replay = { list, idx: list.length - 1, scratch: {} };
  closeModal();
  document.body.classList.add('pr-replay');
  replayGo(P.replay.idx);
}
// 대전 종료 후 저장: 모든 스텝의 스냅샷을 담은 리플레이 파일(.json)을 내려받는다
export function saveReplayFile() {
  const live = ST(); if (!live) { toast('저장할 게임이 없습니다'); return false; }
  try { if (!reason()) SN.sync(live, '', true); } catch (e) { /* ignore */ }
  if (!SN.TL.list.length) { toast('기록된 스텝이 없습니다'); return false; }
  try {
    const text = RP.replayFileJSON(live);
    const w = live.winner ? (live.winner === 'draw' ? 'draw' : live.winner + '-win') : 'game';
    SG.downloadText(`digimon-replay-t${live.turnNumber}-${w}.json`, text);
    toast(`리플레이를 저장했습니다 (${SN.TL.list.length}스텝, ${(text.length / 1048576).toFixed(1)}MB) — 시작 화면의 "리플레이 불러오기"로 다시 볼 수 있습니다`);
    return true;
  } catch (e) { toast('리플레이 저장 실패: ' + (e && e.message)); return false; }
}
// 저장한 리플레이 파일을 열어 처음부터 재생 (진행 중인 게임 없이도 가능)
export function loadReplayText(text, label) {
  try {
    const { list, meta } = RP.parseReplayFile(text);
    if (openReplayList(list, label, { meta })) toast('리플레이를 불러왔습니다' + (label ? ': ' + label : '') + ` (${list.length}스텝)`);
  } catch (e) { P.msg = '리플레이 불러오기 실패: ' + (e && e.message); toast(P.msg); fillSaveModal(); }
}
// open the replay viewer on a timeline list [{snap,label,lines,dig}] (a loaded file, or a CPU-vs-CPU spectate game).
// opts: { autoplay, standalone (default: no live game), meta, startIdx, live: true (the list is still growing), onExit(resumed) }
export function openReplayList(list, label, opts = {}) {
  if (P.replay || !list || !list.length) return false;
  P.live = ST() || null;
  P.replay = { list, idx: opts.startIdx || 0, scratch: {}, standalone: opts.standalone != null ? !!opts.standalone : !P.live, meta: opts.meta || null, playing: false, speed: P.rpSpeed || 1, timer: null, growing: !!opts.live, growInfo: '', onExit: opts.onExit || null, label: label || '' };
  closeModal();
  document.body.classList.add('pr-replay');
  replayGo(P.replay.idx);
  if (opts.autoplay) replayPlay();
  return true;
}
// spectate glue: the simulation feeds the (growing) list; done=true ends the growth and lets autoplay stop at the last step
export function replayLiveUpdate(info) {
  const R = P.replay; if (!R || !R.growing) return;
  R.growInfo = (info && info.text) || '';
  if (info && info.meta) R.meta = info.meta;
  if (info && info.done) { R.growing = false; R.growInfo = ''; }
  if (!info || info.done || (R.tick = (R.tick || 0) + 1) % 3 === 0) renderReplayBar(); // bar refresh is throttled while the sim runs
  if (R.playing && !R.timer) replayTick();
}
function replayClearTimer() { const R = P.replay; if (R && R.timer) { clearTimeout(R.timer); R.timer = null; } }
function replayPause() { const R = P.replay; if (!R) return; R.playing = false; replayClearTimer(); renderReplayBar(); }
function replayPlay() {
  const R = P.replay; if (!R) return;
  R.playing = true; replayClearTimer();
  if (R.idx >= R.list.length - 1 && !R.growing) replayGo(0, true); else renderReplayBar(); // finished -> play again from the top
  replayTick();
}
function replayToggle() { const R = P.replay; if (!R) return; if (R.playing) replayPause(); else replayPlay(); }
function replayTick() {
  const R = P.replay; if (!R || !R.playing) return;
  replayClearTimer();
  if (R.idx >= R.list.length - 1) {
    if (R.growing) { R.timer = setTimeout(() => { R.timer = null; replayTick(); }, 350); return; } // wait for the simulation to get ahead
    R.playing = false; renderReplayBar(); return; // end of the replay: stop
  }
  R.timer = setTimeout(() => { R.timer = null; if (P.replay !== R || !R.playing) return; replayGo(R.idx + 1, true); replayTick(); }, stepReadMs(R.list[R.idx + 1], R.speed));
}
function replaySetSpeed(v) { const R = P.replay; if (!R) return; R.speed = v; P.rpSpeed = v; if (R.playing) { replayClearTimer(); replayTick(); } }
function replaySave() {
  const R = P.replay; if (!R) return;
  try {
    const m = R.meta || {};
    const text = RP.replayFileJSON({ firstPlayer: m.firstPlayer, winner: m.winner, turnNumber: m.turns }, R.list);
    const w = m.winner ? (m.winner === 'draw' ? 'draw' : m.winner + '-win') : 'game';
    SG.downloadText(`digimon-replay-t${m.turns || ''}-${w}.json`, text);
    toast(`리플레이를 저장했습니다 (${R.list.length}스텝, ${(text.length / 1048576).toFixed(1)}MB)`);
  } catch (e) { toast('리플레이 저장 실패: ' + (e && e.message)); }
}
function replayGo(i, fromAuto) {
  const R = P.replay; if (!R) return;
  if (!fromAuto && R.playing) { R.playing = false; replayClearTimer(); } // any manual navigation pauses autoplay
  i = Math.max(0, Math.min(R.list.length - 1, i)); R.idx = i;
  SN.restoreState(R.scratch, R.list[i].snap);
  const lines = []; for (let k = 0; k <= i; k++) for (const m of R.list[k].lines || []) lines.push({ t: 0, turn: R.list[k].snap.meta.turn, msg: m });
  R.scratch.log = lines.reverse().slice(0, 300); R.scratch.fxHistory = [];
  api.setState(R.scratch); api.resetSel(); api.render(); renderReplayBar();
}
function replayExit(resumeHere) {
  const R = P.replay; if (!R) return;
  replayClearTimer(); R.playing = false; R.growing = false;
  if (R.onExit) { try { R.onExit(!!resumeHere); } catch (e) { /* ignore */ } }
  const live = P.live; const standalone = !!R.standalone; P.replay = null; P.live = null;
  document.body.classList.remove('pr-replay');
  const bar = document.getElementById('pr-replay-bar'); if (bar) bar.remove();
  if (standalone) { SN.resetTimeline(null); api.setState(null); api.resetSel(); api.render(); toast('리플레이를 종료했습니다'); return; }
  if (resumeHere) {
    SN.restoreState(live, R.list[R.idx].snap);
    SN.TL.list = R.list; SN.TL.cur = R.idx; SN.TL.owner = live; SN.TL.head = null;
    S.log(live, `(리플레이) 스텝 ${R.idx + 1}에서 이어서 진행`); SN.TL.head = live.log[0] || null;
  } else S.rebindState(live);
  api.setState(live); api.resetSel(); api.render(); toast(resumeHere ? '해당 시점에서 이어서 진행합니다' : '리플레이를 종료했습니다');
}
function replayContinueStandalone() {
  const R = P.replay; if (!R) return;
  replayClearTimer(); R.playing = false; R.growing = false;
  if (R.onExit) { try { R.onExit(true); } catch (e) { /* ignore */ } }
  const live = {}; SN.restoreState(live, R.list[R.idx].snap); live.log = R.scratch.log || []; live.fxHistory = [];
  P.replay = null; P.live = null; document.body.classList.remove('pr-replay');
  const bar = document.getElementById('pr-replay-bar'); if (bar) bar.remove();
  SN.resetTimeline(null); api.setState(live); api.resetSel(); api.render(); toast('해당 스텝에서 이어서 진행합니다');
}
function renderReplayBar() {
  const R = P.replay; if (!R) return;
  let bar = document.getElementById('pr-replay-bar'); if (!bar) bar = document.body.appendChild(h('div', { id: 'pr-replay-bar', className: 'pr-replay-bar' }));
  const last = R.list.length - 1;
  const e = R.list[Math.min(R.idx, last)];
  const spd = h('select', { className: 'pr-rp-speed', title: '자동 재생 속도', onchange: (ev) => replaySetSpeed(Number(ev.target.value)) }, [0.5, 1, 2, 4].map((v) => h('option', { value: v }, v + 'x')));
  spd.value = String(R.speed);
  let slider = bar.querySelector('input[type=range]'); // kept across renders so dragging it is not interrupted
  if (!slider) slider = h('input', { type: 'range', min: 0, max: Math.max(0, last), value: R.idx, oninput: (ev) => replayGo(Number(ev.target.value)) });
  slider.max = String(Math.max(0, last)); slider.value = String(R.idx);
  const m = R.meta || {};
  const result = !R.growing && m.winner ? ` · 결과: ${m.winner === 'draw' ? '무승부' : m.winner.toUpperCase() + ' 승리'}` : '';
  bar.replaceChildren(
    h('div', { className: 'pr-rp-top' }, [
      h('b', { className: 'pr-rp-tag' }, R.playing ? '▶ 재생 중' : '⏸ 리플레이'),
      h('button', { className: 'pr-rp-play' + (R.playing ? ' on' : ''), title: '재생 / 일시정지 (Space)', onClick: replayToggle }, R.playing ? '⏸' : '▶'),
      spd,
      h('button', { disabled: R.idx <= 0, title: '처음', onClick: () => replayGo(0) }, '⏮'),
      h('button', { disabled: R.idx <= 0, title: '이전 스텝 (←)', onClick: () => replayGo(R.idx - 1) }, '◀'),
      h('button', { disabled: R.idx >= last, title: '다음 스텝 (→)', onClick: () => replayGo(R.idx + 1) }, '▶'),
      h('button', { disabled: R.idx >= last, title: '마지막', onClick: () => replayGo(last) }, '⏭'),
      h('span', { className: 'pr-rp-title' }, RP.stepTitle(R.list, Math.min(R.idx, last)) + result + (R.growing ? ` · ⏳ ${R.growInfo || '시뮬레이션 중…'}` : '')),
      R.standalone && (m.turns != null || m.decks) ? h('button', { title: '이 리플레이를 파일로 저장', onClick: replaySave }, '💾') : null,
      R.standalone ? h('button', { title: '이 스텝의 상태로 새 게임처럼 이어서 진행', onClick: () => replayContinueStandalone() }, '이어하기') : h('button', { title: '이 시점 상태로 게임을 이어서 진행', onClick: () => replayExit(true) }, '여기서 이어하기'),
      h('button', { className: 'primary', onClick: () => replayExit(false) }, '종료'),
    ]),
    slider,
    h('div', { className: 'pr-rp-lines' }, (e.lines && e.lines.length ? e.lines : [e.label || '(변화 없음)']).map(l => h('div', {}, l))),
  );
}
export function replayBarRefresh() { if (P.replay) renderReplayBar(); }

// ---------- cheat drawer ----------
const ZONES = [['hand', '패'], ['deck', '덱'], ['trash', '트래시'], ['security', '시큐리티'], ['digitamaDeck', '디지타마 덱'], ['raising', '육성 에어리어'], ['battle', '배틀 에어리어']];
const zoneLabel = (z) => (ZONES.find(x => x[0] === z) || [0, z])[1];
function cname(id) { try { return S.card(id).nameKo; } catch (e) { return id; } }
function zoneCards(s, p, z) {
  const pl = s.players[p];
  if (z === 'raising') return pl.raising ? [{ label: `${cname(pl.raising.cardId)} (+진화원 ${pl.raising.sources.length})` }] : [];
  if (z === 'battle') return pl.battle.map(st => ({ label: `${cname(st.cardId)} (+진화원 ${st.sources.length})${st.suspended ? ' [레스트]' : ''}` }));
  return pl[z].map((id, i) => ({ label: `${i + 1}. ${cname(id)} (${id})` }));
}
function logCheat(s, msg) { S.log(s, `(연습용 치트) ${msg}`); }
function takeFrom(s, p, z, i) { // -> [cardIds] removed from the zone (a stack yields its top card + sources + links)
  const pl = s.players[p];
  if (z === 'raising') { const st = pl.raising; if (!st) return null; pl.raising = null; return { ids: [st.cardId, ...st.sources, ...(st.linkCards || []).map(l => l.cardId)], stack: st }; }
  if (z === 'battle') { const st = pl.battle[i]; if (!st) return null; pl.battle.splice(i, 1); if (s._leavePending) s._leavePending.length = 0; return { ids: [st.cardId, ...st.sources, ...(st.linkCards || []).map(l => l.cardId)], stack: st }; }
  const id = pl[z].splice(i, 1)[0]; return id ? { ids: [id] } : null;
}
function putInto(s, p, z, ids, pos, target) {
  const pl = s.players[p];
  if (z === 'battle') { const st = S.cheatMakeStack(s, ids[0]); pl.battle.push(st); for (const id of ids.slice(1)) pl.hand.push(id); return ids.length > 1 ? '(첫 장만 배틀 에어리어, 나머지는 패로)' : ''; }
  if (z === 'raising') { if (pl.raising) { pl.hand.push(...ids); return '(육성 에어리어가 차 있어 패로)'; } pl.raising = S.cheatMakeStack(s, ids[0]); for (const id of ids.slice(1)) pl.hand.push(id); return ''; }
  if (z === 'sources') { const st = pl.battle[target] || pl.raising; if (!st) { pl.hand.push(...ids); return '(대상 스택 없음 → 패로)'; } st.sources.push(...ids); return ''; }
  if (pos === 'top') { if (z === 'hand') pl.hand.push(...ids); else pl[z].unshift(...ids); } else pl[z].push(...ids);
  return '';
}
function cheatDo(fn) { const s = ST(); if (!s) return; try { fn(s); } catch (e) { toast('치트 실패: ' + (e && e.message)); } if (s._leavePending) s._leavePending.length = 0; api.resetSel(); api.render(); }
function renderCheat() {
  let box = document.getElementById('pr-cheat');
  const s = ST();
  if (!P.cheatOpen || !s || P.replay) { if (box) box.remove(); return; }
  if (!box) box = document.body.appendChild(h('div', { id: 'pr-cheat', className: 'pr-cheat' }));
  const p = cheat.p, pl = s.players[p];
  const sel = (opts, val, on) => { const el = h('select', {}, opts.map(([v, l]) => h('option', { value: v }, l))); el.value = String(val); el.onchange = () => { on(el.value); renderCheat(); }; return el; };
  const fromCards = zoneCards(s, p, cheat.from);
  if (cheat.idx >= fromCards.length) cheat.idx = Math.max(0, fromCards.length - 1);
  const stacks = pl.battle.map((st, i) => [i, `${i + 1}. ${cname(st.cardId)}`]);
  const stackSel = (val, on) => sel(stacks.length ? stacks : [[0, '(배틀 스택 없음)']], Math.min(val, Math.max(0, stacks.length - 1)), on);
  const toZones = [...ZONES, ['sources', '진화원(아래 스택 아래)']];
  const idIn = h('input', { className: 'pr-in', list: 'pr-card-ids', placeholder: '카드 번호 (예: BT1-010)', value: cheat.cardId, oninput: (e) => { cheat.cardId = e.target.value; } });
  box.replaceChildren(
    h('div', { className: 'pr-head' }, [h('b', {}, '🛠 핸드 조작 — 연습용 치트'), h('button', { onClick: () => { P.cheatOpen = false; api.render(); } }, '✕')]),
    h('div', { className: 'pr-warn' }, '연습용 치트입니다. 실제 룰/효과 처리 없이 상태만 바꾸며 로그에 기록되고 되돌리기가 가능합니다.'),
    h('div', { className: 'pr-row' }, [h('span', {}, '대상'), ...['p1', 'p2'].map(q => h('button', { className: cheat.p === q ? 'primary' : '', onClick: () => { cheat.p = q; cheat.idx = 0; renderCheat(); } }, q.toUpperCase()))]),
    h('h4', {}, '카드 이동'),
    h('div', { className: 'pr-row' }, [h('span', {}, '어디서'), sel(ZONES, cheat.from, v => { cheat.from = v; cheat.idx = 0; }), sel(fromCards.length ? fromCards.map((c, i) => [i, c.label]) : [[0, '(없음)']], cheat.idx, v => { cheat.idx = Number(v); })]),
    h('div', { className: 'pr-row' }, [h('span', {}, '어디로'), sel(toZones, cheat.to, v => { cheat.to = v; }), sel([['top', '맨 위'], ['bottom', '맨 아래']], cheat.pos, v => { cheat.pos = v; }), cheat.to === 'sources' ? stackSel(cheat.target, v => { cheat.target = Number(v); }) : null]),
    h('div', { className: 'pr-row' }, [h('button', { className: 'primary', disabled: !fromCards.length, onClick: () => cheatDo(st => {
      const got = takeFrom(st, p, cheat.from, cheat.idx); if (!got) return;
      const note = putInto(st, p, cheat.to, got.ids, cheat.pos, cheat.target);
      logCheat(st, `${p} ${got.ids.map(cname).join(', ')}: ${zoneLabel(cheat.from)} → ${cheat.to === 'sources' ? '진화원' : zoneLabel(cheat.to)} ${note}`);
    }) }, '이동')]),
    h('h4', {}, '카드 생성'),
    h('div', { className: 'pr-row' }, [idIn, sel(toZones.filter(z => z[0] !== 'sources'), cheat.to, v => { cheat.to = v; }), h('button', { onClick: () => cheatDo(st => {
      const id = cheat.cardId.trim().toUpperCase(); if (!S.CARDS[id]) throw new Error('없는 카드 번호: ' + id);
      const note = putInto(st, p, cheat.to === 'sources' ? 'hand' : cheat.to, [id], cheat.pos, 0); logCheat(st, `${p} ${cname(id)} (${id}) 생성 → ${zoneLabel(cheat.to)} ${note}`);
    }) }, '생성')]),
    h('h4', {}, '메모리'),
    h('div', { className: 'pr-row' }, [
      h('span', {}, `현재 ${s.memory > 0 ? '+' : ''}${s.memory} (+ = P1 쪽)`),
      h('input', { className: 'pr-num', type: 'number', min: -10, max: 10, value: cheat.mem, oninput: (e) => { cheat.mem = Number(e.target.value); } }),
      h('button', { onClick: () => cheatDo(st => { const v = Math.max(-10, Math.min(10, Math.round(cheat.mem || 0))); logCheat(st, `메모리 ${st.memory} → ${v}`); st.memory = v; }) }, '설정'),
      h('button', { onClick: () => cheatDo(st => { const v = Math.min(10, st.memory + 1); logCheat(st, `메모리 ${st.memory} → ${v}`); st.memory = v; }) }, '+1'),
      h('button', { onClick: () => cheatDo(st => { const v = Math.max(-10, st.memory - 1); logCheat(st, `메모리 ${st.memory} → ${v}`); st.memory = v; }) }, '−1'),
    ]),
    h('h4', {}, '스택 수정 (배틀 에어리어)'),
    h('div', { className: 'pr-row' }, [stackSel(cheat.stack, v => { cheat.stack = Number(v); }),
      h('button', { disabled: !stacks.length, onClick: () => cheatDo(st => { const t = st.players[p].battle[cheat.stack]; if (t) { t.tempDP = (t.tempDP || 0) + 1000; logCheat(st, `${p} ${cname(t.cardId)} DP +1000 (임시)`); } }) }, 'DP +1000'),
      h('button', { disabled: !stacks.length, onClick: () => cheatDo(st => { const t = st.players[p].battle[cheat.stack]; if (t) { t.tempDP = (t.tempDP || 0) - 1000; logCheat(st, `${p} ${cname(t.cardId)} DP −1000 (임시)`); } }) }, 'DP −1000'),
      h('button', { disabled: !stacks.length, onClick: () => cheatDo(st => { const t = st.players[p].battle[cheat.stack]; if (t) { t.suspended = !t.suspended; logCheat(st, `${p} ${cname(t.cardId)} ${t.suspended ? '레스트' : '액티브'}로 전환`); } }) }, '레스트 토글'),
      h('button', { disabled: !stacks.length, onClick: () => cheatDo(st => { const t = st.players[p].battle[cheat.stack]; if (t && t.sources.length) { const id = t.sources.pop(); st.players[p].trash.push(id); logCheat(st, `${p} ${cname(t.cardId)}의 진화원 ${cname(id)} 제거 → 트래시`); } }) }, '진화원 1장 제거'),
      h('button', { disabled: !stacks.length, onClick: () => cheatDo(st => { const t = st.players[p].battle[cheat.stack]; if (t) { t.attacksThisTurn = 0; t.attackEligibleTurn = 0; logCheat(st, `${p} ${cname(t.cardId)} 공격 가능 상태로`); } }) }, '즉시 공격 가능'),
    ]),
    h('datalist', { id: 'pr-card-ids' }, []),
  );
}
